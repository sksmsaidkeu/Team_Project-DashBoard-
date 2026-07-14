"""구직자 지원(APPLY) 로그 합성 생성 스크립트 (2차 테스트 피드백 4번).

seed_jobseekers.py로 만든 합성 구직자 중 일부가 실제로 회사 공고에 지원한 것처럼
interaction_logs(action_type='APPLY')를 추가한다. 그래야 기업 탭의
GET /company/job-postings/{id}/applicants 에서 지원자가 실제로 보인다.

지원 대상 공고 선정 규칙:
  - job_postings.status='active'인 공고만 대상으로 한다.
  - 구직자의 desired_position_category_id와 company_profiles.position_category_id가
    일치하는 공고를 우선 사용한다(직무 일치). 없으면 아무 active 공고나 사용한다.

idempotent: 이미 같은 (actor_user_id, target_job_posting_id, action_type='APPLY') 로그가 있으면
다시 추가하지 않는다. 이 스크립트를 재실행해도 중복 지원 로그가 쌓이지 않는다.

사용법:
    cd backend
    python scripts/seed_applications.py             # seeker*@seed.local 중 지원 이력이 없는 20명 선정
    python scripts/seed_applications.py 30           # 지원자 수 지정
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

SUPABASE_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

DEFAULT_APPLICANT_COUNT = 20


def sb_get(table, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=SUPABASE_HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_insert(table, row, return_repr=False):
    headers = {**SUPABASE_HEADERS}
    if return_repr:
        headers["Prefer"] = "return=representation"
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, json=row, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"insert {table} 실패: {r.status_code} {r.text} payload={row}")
    return r.json()[0] if return_repr else None


def load_auth_email_map():
    """user_id -> email (lower) 맵. seeker*@seed.local 계정만 지원자 후보로 쓴다."""
    mapping = {}
    page = 1
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=SUPABASE_HEADERS,
            params={"page": page, "per_page": 1000},
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        users = body.get("users", body) if isinstance(body, dict) else body
        if not users:
            break
        for u in users:
            if u.get("email"):
                mapping[u["id"]] = u["email"].lower()
        if len(users) < 1000:
            break
        page += 1
    return mapping


def main():
    target = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_APPLICANT_COUNT
    print(f"=== 구직자 지원(APPLY) 로그 합성 생성 (목표 {target}명) ===")

    email_by_user_id = load_auth_email_map()

    jobseekers = sb_get(
        "jobseeker_profiles",
        {"select": "id,user_id,desired_position_category_id"},
    )
    seed_jobseekers = [
        js for js in jobseekers if (email_by_user_id.get(js["user_id"], "")).startswith("seeker")
    ]
    if not seed_jobseekers:
        raise SystemExit("seeker*@seed.local 구직자를 찾지 못했습니다. 먼저 seed_jobseekers.py를 실행하세요.")

    # 이미 APPLY 로그가 있는 구직자는 제외하고, 아직 지원 이력이 없는 구직자 중에서 목표 인원만큼 뽑는다.
    existing_apply_logs = sb_get(
        "interaction_logs",
        {"select": "actor_user_id", "action_type": "eq.APPLY"},
    )
    already_applied_user_ids = {row["actor_user_id"] for row in existing_apply_logs}

    candidates = [js for js in seed_jobseekers if js["user_id"] not in already_applied_user_ids]
    random.Random(42).shuffle(candidates)
    selected = candidates[:target]

    if len(selected) < target:
        print(f"  [경고] 지원 이력이 없는 구직자가 {len(candidates)}명뿐이라 {len(selected)}명만 선정합니다.")

    active_postings = sb_get(
        "job_postings",
        {"select": "id,position_category_id,company_profile_id", "status": "eq.active"},
    )
    if not active_postings:
        raise SystemExit("status='active'인 job_postings이 없습니다. 먼저 공고 데이터를 채우세요.")

    postings_by_position = {}
    for p in active_postings:
        postings_by_position.setdefault(p["position_category_id"], []).append(p)

    now = datetime.now(timezone.utc)
    n_created = 0
    n_skipped = 0

    for js in selected:
        matched = postings_by_position.get(js["desired_position_category_id"])
        posting = random.choice(matched) if matched else random.choice(active_postings)

        # idempotent 체크: 이미 같은 (actor_user_id, target_job_posting_id, APPLY) 로그가 있으면 건너뛴다.
        dup = sb_get(
            "interaction_logs",
            {
                "select": "id",
                "action_type": "eq.APPLY",
                "actor_user_id": f"eq.{js['user_id']}",
                "target_job_posting_id": f"eq.{posting['id']}",
                "limit": "1",
            },
        )
        if dup:
            n_skipped += 1
            continue

        created_at = (now - timedelta(days=random.randint(0, 27), hours=random.randint(0, 23))).isoformat()
        sb_insert(
            "interaction_logs",
            {
                "actor_user_id": js["user_id"],
                "action_type": "APPLY",
                "target_job_posting_id": posting["id"],
                "created_at": created_at,
            },
        )
        n_created += 1

    print("\n=== 요약 ===")
    print(f"  신규 APPLY 로그: {n_created}건")
    print(f"  이미 지원 이력이 있어 건너뜀: {n_skipped}건")
    print(f"  대상 구직자 후보(seeker*, 지원 이력 없음): {len(candidates)}명")


if __name__ == "__main__":
    main()
