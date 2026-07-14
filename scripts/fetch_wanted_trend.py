"""
scripts/fetch_wanted_trend.py

Wanted(원티드) 공개 API `GET /jobs`를 페이지네이션 호출해 실제 라이브 채용공고를 모으고,
`status == 'active'`인 공고를 `category_tags.parent_tag`(직군) 기준으로 집계해
`wanted_job_trend_snapshot` 테이블에 upsert할 스냅샷 행으로 변환/반영하는 스크립트.

배경 (PRD.md 7장 근처에 기록된 내용과 동일):
- 메인 탭의 기존 "채용 트렌드"는 우리 자체 Supabase `job_postings` 테이블 기준이었다(아직
  실 데이터가 거의 없음). 이 스크립트가 만드는 "원티드 채용 동향"은 그와 별개로, 원티드 실제
  라이브 공고를 원티드 API에서 직접 집계한 지표다. 두 지표를 혼동하지 않는다.
- `/jobs`는 openapi.json에 "v2 api 사용을 권장합니다"(deprecated)로 표시돼 있지만, 이 저장소엔
  v2 스펙이 없으므로 이번엔 v1 `/jobs`를 그대로 사용한다.

- 외부 패키지 없이 표준 라이브러리(urllib.request, json, os, datetime)만 사용한다.
- .env 파일(client_id/client_secret, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)을
  scripts/seed_categories.py와 동일한 방식으로 직접 파싱해서 읽는다(dotenv 미사용).
- SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 .env에 있으면 Supabase REST(PostgREST)로 실제
  upsert를 수행한다. 없으면(플레이스홀더/빈 값) dry-run(집계 결과 미리보기만 출력)으로 동작한다.
- wanted_job_trend_snapshot 테이블도 categories와 마찬가지로 RLS로 쓰기가 막혀 있으므로
  (supabase/migrations/20260714000000_wanted_job_trend_snapshot.sql), 이 스크립트는 RLS를
  우회하는 SUPABASE_SERVICE_ROLE_KEY로만 쓴다. 이 키는 절대 브라우저(js/config.js)로
  전달하지 않는다(로컬 1회성 스크립트 전용).
- client_secret/SUPABASE_SERVICE_ROLE_KEY 값은 어떤 경우에도 콘솔에 출력하지 않는다.
- 무한 루프 방지: `links.next`가 없거나 목표 건수(MAX_JOBS)에 도달하면 페이지네이션을 중단한다.
  페이지 호출 자체가 실패하면 재시도하지 않고 그 시점까지 모은 데이터로 집계를 계속 진행한다.

upsert 충돌 키(on_conflict) 설계:
  `(tag_id, snapshot_at)` 복합 unique로 잡았다. 이유:
    - `tag_id` 단독을 키로 잡으면 재실행할 때마다 이전 스냅샷 값이 덮어써져 시계열이 사라진다.
      원티드 채용 동향은 "지금 이 순간의 스냅샷"뿐 아니라 향후 "시간에 따른 변화"를 보여줄 수도
      있는 지표라, 스냅샷을 계속 쌓아 보존하는 쪽이 더 유연하다(PRD 7.1 "월별 추이" 요구사항과도
      결이 비슷하다).
    - 프론트가 필요한 최소 요구사항인 "가장 최근 snapshot_at 기준 랭킹"은
        SELECT * FROM wanted_job_trend_snapshot
        WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM wanted_job_trend_snapshot)
        ORDER BY job_count DESC;
      쿼리 한 번으로 얻을 수 있으므로, 이력을 보존하면서도 "최신 스냅샷만 보여준다"는 요구를
      동시에 만족한다.
    - 같은 스크립트 실행(같은 snapshot_at) 내에서 재시도/중복 호출이 있어도 `(tag_id, snapshot_at)`
      unique 덕에 안전하게 upsert된다.

실행:
    python scripts/fetch_wanted_trend.py
    (또는 python3 scripts/fetch_wanted_trend.py)
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

from _common import find_repo_root, load_env, supabase_upsert, is_placeholder

# Windows 콘솔(cp949 등)에서 한글 출력이 깨지는 것을 방지 (Python 3.7+)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# scripts/seed_categories.py와 동일한 기본 host (openapi.json에는 상대 경로만 문서화되어 있음).
# 필요 시 .env 또는 환경변수 WANTED_API_BASE_URL로 override 가능.
DEFAULT_BASE_URL = "https://openapi.wanted.jobs/v1"

PAGE_LIMIT = 100          # 페이지당 요청 건수
MAX_JOBS = 1000           # 무한 루프 방지: 이 건수 이상 모으면 중단
MAX_PAGES = (MAX_JOBS // PAGE_LIMIT) + 2  # 이중 안전장치(페이지 수 상한)


def fetch_jobs_page(base_url, client_id, client_secret, limit, offset):
    url = "{}/jobs?limit={}&offset={}&sort=job.latest_order".format(
        base_url.rstrip("/"), limit, offset
    )
    req = urllib.request.Request(
        url,
        headers={
            "wanted-client-id": client_id,
            "wanted-client-secret": client_secret,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


def fetch_live_jobs(base_url, client_id, client_secret, max_jobs=MAX_JOBS):
    """
    GET /jobs를 offset을 늘려가며 페이지네이션 호출해 최대 max_jobs건까지 모은다.

    중단 조건(무한 루프 방지):
      - 누적 건수가 max_jobs에 도달
      - 응답의 links.next가 없음(더 이상 다음 페이지가 없음)
      - 안전장치로 MAX_PAGES 페이지를 초과
      - 페이지 호출 자체가 실패(HTTPError/URLError) — 재시도하지 않고 그때까지 모은 데이터로 계속 진행
    """
    jobs = []
    offset = 0
    page = 0

    while len(jobs) < max_jobs and page < MAX_PAGES:
        page += 1
        try:
            payload = fetch_jobs_page(base_url, client_id, client_secret, PAGE_LIMIT, offset)
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            print("[WARN] {}번째 페이지(offset={}) 호출 실패, 지금까지 모은 {}건으로 계속 진행: {}".format(
                page, offset, len(jobs), e), file=sys.stderr)
            break

        data = payload.get("data", [])
        jobs.extend(data)
        print("[INFO] {}번째 페이지(offset={}) {}건 수신, 누적 {}건".format(page, offset, len(data), len(jobs)))

        next_link = (payload.get("links") or {}).get("next")
        if not next_link or not data:
            print("[INFO] links.next 없음(또는 빈 페이지) — 페이지네이션 종료")
            break

        offset += PAGE_LIMIT

    return jobs[:max_jobs]


def aggregate_by_parent_tag(jobs):
    """
    status == 'active'인 공고만 남기고 category_tags.parent_tag.{id,title} 기준으로 건수를 집계한다.

    반환: {tag_id(int): {"title": str, "job_count": int}}
    parent_tag가 없는(비정상) 공고는 집계에서 제외한다.
    """
    counts = {}
    active_count = 0
    skipped_no_tag = 0

    for job in jobs:
        if job.get("status") != "active":
            continue
        active_count += 1

        category_tags = job.get("category_tags") or {}
        parent_tag = category_tags.get("parent_tag") or {}
        tag_id = parent_tag.get("id")
        title = parent_tag.get("title")

        if tag_id is None or not title:
            skipped_no_tag += 1
            continue

        entry = counts.setdefault(tag_id, {"title": title, "job_count": 0})
        entry["job_count"] += 1

    if skipped_no_tag:
        print("[WARN] parent_tag 정보가 없어 집계에서 제외한 active 공고 {}건".format(skipped_no_tag),
              file=sys.stderr)

    print("[INFO] 전체 수집 {}건 중 active {}건, 직군 {}종으로 집계".format(
        len(jobs), active_count, len(counts)))

    return counts


def build_snapshot_rows(counts, snapshot_at):
    rows = [
        {
            "tag_id": tag_id,
            "title": entry["title"],
            "job_count": entry["job_count"],
            "snapshot_at": snapshot_at,
        }
        for tag_id, entry in counts.items()
    ]
    rows.sort(key=lambda r: r["job_count"], reverse=True)
    return rows


def main():
    repo_root = find_repo_root(os.path.dirname(os.path.abspath(__file__)))
    env = load_env(os.path.join(repo_root, ".env"))

    client_id = env.get("client_id", "")
    client_secret = env.get("client_secret", "")
    base_url = env.get("WANTED_API_BASE_URL") or os.environ.get("WANTED_API_BASE_URL") or DEFAULT_BASE_URL

    if not client_id or not client_secret:
        print("[ERROR] .env에 client_id/client_secret이 필요합니다 (.env.example 참고).", file=sys.stderr)
        sys.exit(1)

    print("[INFO] GET {}/jobs 페이지네이션 호출 시작 (limit={}, 목표 최대 {}건)...".format(
        base_url, PAGE_LIMIT, MAX_JOBS))
    jobs = fetch_live_jobs(base_url, client_id, client_secret, MAX_JOBS)
    print("[INFO] 최종 수집 {}건".format(len(jobs)))

    counts = aggregate_by_parent_tag(jobs)

    snapshot_at = datetime.now(timezone.utc).isoformat()
    rows = build_snapshot_rows(counts, snapshot_at)
    print("[INFO] snapshot_at = {}".format(snapshot_at))
    print("[INFO] 직군별 집계 {}건 변환 완료".format(len(rows)))

    supabase_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if is_placeholder(supabase_url) or not service_role_key:
        print()
        print("[WARN] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어 dry-run으로 실행합니다"
              " (.env.example 참고, service_role은 Supabase 대시보드 > Project Settings > API).")
        print()
        print("=== 원티드 채용 동향 스냅샷 upsert 대상 (상위 {}건 미리보기, job_count 내림차순) ===".format(
            min(10, len(rows))))
        for row in rows[:10]:
            print(json.dumps(row, ensure_ascii=False))
        if len(rows) > 10:
            print("... 외 {}건".format(len(rows) - 10))
        return

    print("[INFO] Supabase에 실제 upsert를 진행합니다: {}".format(supabase_url))
    inserted = supabase_upsert(
        supabase_url, service_role_key, "wanted_job_trend_snapshot", rows,
        on_conflict="tag_id,snapshot_at",
    )
    print("[INFO] upsert 완료: {}건 반영".format(len(inserted)))
    print()
    print("[INFO] 완료. Supabase 대시보드 > Table Editor > wanted_job_trend_snapshot에서 확인해보세요.")


if __name__ == "__main__":
    main()
