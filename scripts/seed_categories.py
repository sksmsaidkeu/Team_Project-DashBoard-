"""
scripts/seed_categories.py

Wanted OpenAPI `GET /tags/categories` 응답을 Supabase `categories` 테이블
(category_type='JOB') upsert 대상으로 변환해 실제로 반영하는 스크립트.

- 외부 패키지 없이 표준 라이브러리(urllib.request, json, os)만 사용한다. (requests 등 pip 설치 불필요)
- .env 파일(client_id/client_secret, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)을 직접 파싱해서
  읽는다 (dotenv 패키지 미사용).
- SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 .env에 있으면 Supabase REST(PostgREST)로 실제
  upsert를 수행한다. 없으면(플레이스홀더 상태) 지금까지처럼 dry-run(변환 결과 미리보기만 출력)으로
  동작한다 — 항상 안전하게 실행 가능하다.
- categories 테이블은 RLS로 anon/authenticated 쓰기가 막혀 있으므로(supabase/migrations/
  2026-07-13 RLS 정책), 이 스크립트는 RLS를 우회하는 SUPABASE_SERVICE_ROLE_KEY로만 쓴다.
  이 키는 절대 브라우저(js/config.js)로 전달하지 않는다(로컬 1회성 스크립트 전용).
- 원티드 API 호출(GET /tags/categories)은 항상 실제로 수행해 응답 구조를 검증한다.
- client_secret/SUPABASE_SERVICE_ROLE_KEY 값은 어떤 경우에도 콘솔에 출력하지 않는다
  (항상 런타임에 .env에서만 읽는다).
- upsert 충돌 키로 `(category_type, parent_id, title)` 대신 `tag_id`(UNIQUE, NOT NULL)를 쓴다 —
  parent_id가 NULL인 depth1 행은 Postgres UNIQUE 제약에서 NULL끼리 겹치지 않는 것으로 취급되어
  그 조합으로는 재실행 시 중복 삽입될 수 있기 때문이다. tag_id는 원티드 원본 정수 ID라 항상 채워져
  있고 실제 동일성 판단에 더 적합하다.

실행:
    python scripts/seed_categories.py
    (또는 python3 scripts/seed_categories.py)
"""

import json
import os
import sys
import urllib.request
import urllib.error

# Windows 콘솔(cp949 등)에서 한글 출력이 깨지는 것을 방지 (Python 3.7+)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# 원티드 OpenAPI 공개 host. openapi.json의 servers는 "/v1"(상대 경로)만 명시하고
# 이 레포 어디에도 절대 URL이 문서화되어 있지 않아, 공개적으로 알려진 host를 기본값으로 쓴다.
# 필요 시 .env 또는 환경변수 WANTED_API_BASE_URL로 override 가능.
DEFAULT_BASE_URL = "https://openapi.wanted.jobs/v1"


def find_repo_root(start):
    """.env 파일을 담고 있는 디렉터리를 상위로 탐색해 찾는다."""
    d = start
    while True:
        if os.path.isfile(os.path.join(d, ".env")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent


def load_env(path):
    """외부 dotenv 패키지 없이 KEY=VALUE 형식의 .env를 직접 파싱한다."""
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def fetch_categories(base_url, client_id, client_secret):
    url = base_url.rstrip("/") + "/tags/categories"
    req = urllib.request.Request(
        url,
        headers={
            "wanted-client-id": client_id,
            "wanted-client-secret": client_secret,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("Wanted API HTTPError {}: {}".format(e.code, detail)) from e
    except urllib.error.URLError as e:
        raise RuntimeError("Wanted API 연결 실패: {}".format(e)) from e


def build_upsert_rows(payload):
    """
    GET /tags/categories 응답(payload["data"])을
    categories 테이블(category_type='JOB') upsert 대상으로 변환한다.

    실제 호출로 검증한 응답 구조 (openapi.json ParentTagResponseSerializer /
    openapi__apis__v1__tags__serializers__TagResponseSerializer 및 2026-07-13 실 호출 결과):
        {"data": [
            {"id": <int>, "parent_id": null, "title": <str>, "image_url": <str>,
             "sub_tags": [{"id": <int>, "parent_id": <int>, "title": <str>, "image_url": <str>}, ...]},
            ...
        ]}

    주의: 응답 필드명은 `id`이며 `tag_id`라는 필드명 자체는 Wanted 응답에 존재하지 않는다.
    DB.md 3.2절의 `categories.tag_id` 컬럼은 이 `id` 값을 그대로 저장하기 위한 "우리 쪽" 컬럼명이다
    (값은 원티드 원본 그대로 보존, 컬럼명만 우리가 tag_id로 명명). 최상위 태그(parent_id=null)가
    depth1(직군), sub_tags가 depth2(직무)에 대응한다.

    depth1 행은 parent_id=NULL로 upsert 가능하지만, depth2 행의 parent_id(uuid)는
    depth1을 먼저 upsert해서 얻은 tag_id -> uuid 매핑이 있어야 채울 수 있으므로,
    이 함수는 depth2 행에 임시로 `parent_tag_id`(원티드 원본 정수 id)만 채워 반환한다.
    """
    depth1_rows = []
    depth2_rows = []

    for sort_order, parent in enumerate(payload.get("data", [])):
        depth1_rows.append({
            "category_type": "JOB",
            "parent_id": None,           # depth1 = 최상위 (직군)
            "title": parent["title"],
            "tag_id": parent["id"],       # 원티드 응답의 id를 그대로 보존
            "depth": 1,
            "sort_order": sort_order,
        })
        for child_sort_order, child in enumerate(parent.get("sub_tags", [])):
            depth2_rows.append({
                "category_type": "JOB",
                "parent_tag_id": parent["id"],  # upsert 2단계에서 uuid로 치환 필요 (아래 main() 참고)
                "title": child["title"],
                "tag_id": child["id"],
                "depth": 2,
                "sort_order": child_sort_order,
            })

    return depth1_rows, depth2_rows


def supabase_upsert(supabase_url, service_role_key, table, rows, on_conflict):
    """Supabase REST(PostgREST)로 upsert한다. return=representation으로 반영된 행을 그대로 받는다."""
    if not rows:
        return []
    url = "{}/rest/v1/{}?on_conflict={}".format(supabase_url.rstrip("/"), table, on_conflict)
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": service_role_key,
            "Authorization": "Bearer {}".format(service_role_key),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("Supabase upsert HTTPError {} ({}): {}".format(e.code, table, detail)) from e
    except urllib.error.URLError as e:
        raise RuntimeError("Supabase 연결 실패({}): {}".format(table, e)) from e


def is_placeholder(value):
    return not value or "YOUR_" in value.upper() or "YOUR-" in value.upper()


def main():
    repo_root = find_repo_root(os.path.dirname(os.path.abspath(__file__)))
    env = load_env(os.path.join(repo_root, ".env"))

    client_id = env.get("client_id", "")
    client_secret = env.get("client_secret", "")
    base_url = env.get("WANTED_API_BASE_URL") or os.environ.get("WANTED_API_BASE_URL") or DEFAULT_BASE_URL

    if not client_id or not client_secret:
        print("[ERROR] .env에 client_id/client_secret이 필요합니다 (.env.example 참고).", file=sys.stderr)
        sys.exit(1)

    print("[INFO] GET {}/tags/categories 호출 중...".format(base_url))
    payload = fetch_categories(base_url, client_id, client_secret)

    depth1_rows, depth2_rows = build_upsert_rows(payload)
    print("[INFO] depth1(직군) {}건, depth2(직무) {}건 변환 완료".format(len(depth1_rows), len(depth2_rows)))

    supabase_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if is_placeholder(supabase_url) or not service_role_key:
        print()
        print("[WARN] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어 dry-run으로 실행합니다"
              " (.env.example 참고, service_role은 Supabase 대시보드 > Project Settings > API).")
        print()
        print("=== depth1 upsert 대상 (최대 5건 미리보기) ===")
        for row in depth1_rows[:5]:
            print(json.dumps(row, ensure_ascii=False))
        if len(depth1_rows) > 5:
            print("... 외 {}건".format(len(depth1_rows) - 5))
        print()
        print("=== depth2 upsert 대상 (최대 5건 미리보기, parent_tag_id는 실제 반영 시 uuid로 치환됨) ===")
        for row in depth2_rows[:5]:
            print(json.dumps(row, ensure_ascii=False))
        if len(depth2_rows) > 5:
            print("... 외 {}건".format(len(depth2_rows) - 5))
        return

    print("[INFO] Supabase에 실제 upsert를 진행합니다: {}".format(supabase_url))

    print("[INFO] 1/2: depth1(직군) {}건 upsert 중...".format(len(depth1_rows)))
    inserted_depth1 = supabase_upsert(supabase_url, service_role_key, "categories", depth1_rows, on_conflict="tag_id")
    tag_id_to_uuid = {row["tag_id"]: row["id"] for row in inserted_depth1}
    print("[INFO] depth1 upsert 완료: {}건 반영, tag_id->uuid 매핑 {}건 확보".format(
        len(inserted_depth1), len(tag_id_to_uuid)))

    resolved_depth2_rows = []
    skipped = 0
    for row in depth2_rows:
        parent_tag_id = row.pop("parent_tag_id")
        parent_uuid = tag_id_to_uuid.get(parent_tag_id)
        if parent_uuid is None:
            skipped += 1
            continue
        row["parent_id"] = parent_uuid
        resolved_depth2_rows.append(row)
    if skipped:
        print("[WARN] 부모 tag_id 매핑을 못 찾아 건너뛴 depth2 행 {}건".format(skipped), file=sys.stderr)

    print("[INFO] 2/2: depth2(직무) {}건 upsert 중...".format(len(resolved_depth2_rows)))
    inserted_depth2 = supabase_upsert(
        supabase_url, service_role_key, "categories", resolved_depth2_rows, on_conflict="tag_id")
    print("[INFO] depth2 upsert 완료: {}건 반영".format(len(inserted_depth2)))
    print()
    print("[INFO] 시드 완료. Supabase 대시보드 > Table Editor > categories에서 확인해보세요.")


if __name__ == "__main__":
    main()
