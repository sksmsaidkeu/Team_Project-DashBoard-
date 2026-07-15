"""합성 구직자(인재) 샘플 생성 스크립트.

원티드 공개 API에는 구직자(인재) 목록 엔드포인트가 없다(DB.md 1.1절: 구직자 개념 자체가 없음).
따라서 인재 데이터는 실제 categories(JOB/REGION/SKILL)를 참조하는 합성 샘플로 생성한다.

기업 탭(Tab1)의 인재검색은 하드 필터로 "직무(desired_position) == 회사 직무 AND 지역(region) ==
회사 지역 AND is_region_public AND is_salary_public"이 모두 맞아야 결과에 나온다. 그래서 무작위가
아니라 import_wanted_data.py가 적재한 company_profiles의 (직무, 지역) 조합을 그대로 참조해
구직자를 만든다 -> 로그인한 어떤 기업이든 자사 조건으로 인재가 검색된다.

재실행 안전(idempotent): seeker{n}@seed.local 계정이 이미 있으면 프로필 생성을 건너뛴다.

사용법:
    cd backend
    python scripts/seed_jobseekers.py            # 기본 목표 인원(45명)
    python scripts/seed_jobseekers.py 30          # 인원 지정
"""

import os
import sys
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

SEED_PASSWORD = "SeedPass!2026"
DEFAULT_TARGET = 45

# 다양성 확보용 분포 값(순환 배정). 실제 개인정보가 아니라 그럴듯한 합성값이다.
CAREER_YEARS_CYCLE = [0, 1, 2, 3, 5, 7, 8, 10]
DESIRED_SALARY_CYCLE = [3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000]
EMPLOYMENT_TYPE_CYCLE = ["regular", "regular", "regular", "contract", "intern"]
COMMON_SKILL_TITLES = ["Python", "Java", "JavaScript", "React", "SQL", "Spring", "AWS", "Figma"]


def sb_get(table, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=SUPABASE_HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_insert(table, row, return_repr=True):
    headers = {**SUPABASE_HEADERS}
    if return_repr:
        headers["Prefer"] = "return=representation"
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, json=row, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"insert {table} 실패: {r.status_code} {r.text} payload={row}")
    return r.json()[0] if return_repr else None


def load_auth_user_map():
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
                mapping[u["email"].lower()] = u["id"]
        if len(users) < 1000:
            break
        page += 1
    return mapping


def create_auth_user(email, password):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=SUPABASE_HEADERS,
        json={"email": email, "password": password, "email_confirm": True},
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"auth 유저 생성 실패({email}): {r.status_code} {r.text}")
    return r.json()["id"]


def ensure_auth_user(email, password, auth_map):
    key = email.lower()
    if key in auth_map:
        return auth_map[key]
    uid = create_auth_user(email, password)
    auth_map[key] = uid
    return uid


def ensure_public_user(user_id, user_type):
    if sb_get("users", {"select": "id", "id": f"eq.{user_id}"}):
        return
    sb_insert("users", {"id": user_id, "user_type": user_type}, return_repr=False)


def build_skill_pool():
    pool = []
    for title in COMMON_SKILL_TITLES:
        rows = sb_get("categories", {"select": "id", "category_type": "eq.SKILL", "title": f"eq.{title}"})
        if rows:
            pool.append(rows[0]["id"])
    return pool


def collect_target_slots(skill_pool):
    """company_profiles의 (직무, 지역) 조합을 읽어 구직자를 만들 슬롯 목록을 만든다.

    각 슬롯의 skill_ids에는 그 (직무,지역) 조합에 속한 "모든" 회사의 필요 스킬 합집합을 담는다.
    구직자에게 이 합집합을 그대로 부여하면 같은 조합의 어떤 회사로 로그인해도 그 회사의 필요 스킬을
    최소 1개는 보유하게 되어 인재검색 스킬 필터를 항상 통과한다.
    회사가 없으면(=import 미실행) 카테고리에서 임의 조합으로 폴백한다.
    """
    profiles = sb_get("company_profiles", {"select": "id,position_category_id,region_category_id"})
    slots = {}
    for p in profiles:
        key = (p["position_category_id"], p["region_category_id"])
        skill_rows = sb_get(
            "company_profile_skills",
            {"select": "skill_category_id", "company_profile_id": f"eq.{p['id']}"},
        )
        slots.setdefault(key, set()).update(r["skill_category_id"] for r in skill_rows)
    result = [{"position_id": k[0], "region_id": k[1], "skill_ids": sorted(v)} for k, v in slots.items()]

    if result:
        return result

    # 폴백: 회사 데이터가 없으면 categories에서 직무/지역을 뽑아 조합
    print("  [경고] company_profiles가 비어 있어 categories 임의 조합으로 폴백합니다(먼저 import_wanted_data 권장).")
    jobs = sb_get("categories", {"select": "id", "category_type": "eq.JOB", "depth": "eq.1", "limit": "8"})
    regions = sb_get("categories", {"select": "id", "category_type": "eq.REGION", "limit": "8"})
    for i, jrow in enumerate(jobs):
        rrow = regions[i % len(regions)] if regions else None
        if rrow:
            result.append({"position_id": jrow["id"], "region_id": rrow["id"], "skill_ids": skill_pool[:2]})
    return result


def main():
    target = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"=== 구직자 합성 샘플 생성 (목표 {target}명) ===")

    skill_pool = build_skill_pool()
    slots = collect_target_slots(skill_pool)
    if not slots:
        raise SystemExit("생성 기준이 될 직무/지역 조합을 찾지 못했습니다. seed_categories/import를 먼저 실행하세요.")

    auth_map = load_auth_user_map()
    n_created = 0
    n_skipped = 0
    n_skill_link = 0

    for i in range(1, target + 1):
        slot = slots[(i - 1) % len(slots)]
        email = f"seeker{i}@seed.local"
        uid = ensure_auth_user(email, SEED_PASSWORD, auth_map)
        ensure_public_user(uid, "JOBSEEKER")

        existing = sb_get("jobseeker_profiles", {"select": "id", "user_id": f"eq.{uid}"})
        if existing:
            profile_id = existing[0]["id"]
            n_skipped += 1
        else:
            profile = sb_insert("jobseeker_profiles", {
                "user_id": uid,
                "desired_position_category_id": slot["position_id"],
                "career_years": CAREER_YEARS_CYCLE[(i - 1) % len(CAREER_YEARS_CYCLE)],
                "region_category_id": slot["region_id"],
                "desired_salary": DESIRED_SALARY_CYCLE[(i - 1) % len(DESIRED_SALARY_CYCLE)],
                "desired_employment_type": EMPLOYMENT_TYPE_CYCLE[(i - 1) % len(EMPLOYMENT_TYPE_CYCLE)],
                "is_region_public": True,   # 인재검색 하드 필터 통과 조건
                "is_salary_public": True,
            })
            profile_id = profile["id"]
            n_created += 1

        # 보유 스킬: 같은 (직무,지역) 회사들의 필요 스킬 합집합을 부여해 어떤 회사로 검색해도 매칭되게 한다.
        # 회사 스킬이 없으면 공용 풀로 보충. 신규/기존 프로필 모두에 대해 누락된 링크만 추가(idempotent).
        desired = slot["skill_ids"] or skill_pool[:2]
        existing_links = sb_get(
            "jobseeker_profile_skills",
            {"select": "skill_category_id", "jobseeker_profile_id": f"eq.{profile_id}"},
        )
        have = {r["skill_category_id"] for r in existing_links}
        for sid in desired:
            if sid in have:
                continue
            try:
                sb_insert("jobseeker_profile_skills", {
                    "jobseeker_profile_id": profile_id, "skill_category_id": sid,
                }, return_repr=False)
                n_skill_link += 1
            except RuntimeError:
                pass

    print("\n=== 요약 ===")
    print(f"  신규 구직자: {n_created}명, 기존 유지(skip): {n_skipped}명")
    print(f"  신규 보유스킬 링크: {n_skill_link}건")
    print(f"  참조한 (직무,지역) 조합 수: {len(slots)}")
    print(f"  테스트 로그인: seeker1@seed.local ~ seeker{target}@seed.local / 비밀번호 {SEED_PASSWORD}")


if __name__ == "__main__":
    main()
