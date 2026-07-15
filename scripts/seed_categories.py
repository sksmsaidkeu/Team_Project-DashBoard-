"""
scripts/seed_categories.py

categories 테이블 시드 스크립트.

JOB 시딩(Wanted OpenAPI `GET /tags/categories`)은 common 브랜치가 실제 호출로 검증하고
다듬은 로직(tag_id 기준 배치 upsert, _common.py 공용 헬퍼)을 그대로 채택했다 — 이유:
`(category_type, parent_id, title)` 조합으로 존재 여부를 매번 SELECT-then-INSERT하는
것보다, `tag_id`(원티드 원본 정수 ID, UNIQUE) 기준 on_conflict 배치 upsert가 더 빠르고
(요청 수가 N+1 → 2회로 감소) depth1(parent_id=NULL) 행의 재실행 안전성도 더 낫다
(NULL은 Postgres UNIQUE 비교에서 서로 다르다고 취급되어 SELECT-then-INSERT 쪽은 그
경계에서 이론상 더 취약하다).

INDUSTRY/REGION/SKILL은 common 브랜치에 대응하는 시딩이 없어(JOB만 다룸) company
브랜치(backend/scripts/seed_categories.py) 로직을 그대로 유지한다:
- INDUSTRY: seed_data_industry.json (통계청 KSIC 공식 분류 대표 6개 섹션 샘플)
- REGION:   seed_data_region.json (행정안전부 법정동코드 공식 자료 대표 6개 시도 샘플)
- SKILL:    원티드 Open API `/v1/tags/skills?keyword=...`를 키워드 목록으로 검색한 결과(id 중복 제거)
이 세 개는 tag_id 같은 단일 자연키가 없거나(INDUSTRY는 depth별로 ksic_code 유무가 다름)
매 실행마다 소량이라, `(category_type, parent_id, title)` 기준 find-then-insert 패턴을
그대로 둔다.

⚠️ 참고: 이 브랜치가 쓰는 라이브 Supabase 프로젝트(jobseeker-matching)에는 이미 4개
category_type이 전부 시딩된 상태다(JOB 438건/SKILL 226건 tag_id 보유, INDUSTRY/REGION도
ksic_code/location_code 보유, 2026-07-15 확인). 재실행해도 안전하지만 새 환경을
부트스트랩할 때만 필요하다.

사용법:
    python scripts/seed_categories.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from _common import find_repo_root, load_env, supabase_upsert, is_placeholder

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BASE_URL = "https://openapi.wanted.jobs/v1"

SKILL_KEYWORDS = [
    "JavaScript", "Python", "Java", "React", "Vue", "Node.js", "Spring", "SQL",
    "AWS", "Docker", "Kubernetes", "Git", "Figma", "Photoshop", "Excel",
    "PowerPoint", "기획", "마케팅", "디자인", "데이터분석", "영업", "회계", "인사",
    "물류", "C++", "Swift", "Kotlin", "TypeScript", "MySQL", "포토샵",
]


# ---------------------------------------------------------------------------
# JOB — common 브랜치의 tag_id 기준 배치 upsert 로직 그대로 채택
# ---------------------------------------------------------------------------

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
    실제 호출로 검증한 응답 구조:
        {"data": [
            {"id": <int>, "parent_id": null, "title": <str>, "image_url": <str>,
             "sub_tags": [{"id": <int>, "parent_id": <int>, "title": <str>, "image_url": <str>}, ...]},
            ...
        ]}
    주의: 응답 필드명은 `id`이며 `tag_id`라는 필드명 자체는 Wanted 응답에 존재하지 않는다.
    DB.md 3.2절의 `categories.tag_id` 컬럼은 이 `id` 값을 그대로 저장하기 위한 "우리 쪽" 컬럼명이다.
    최상위 태그(parent_id=null)가 depth1(직군), sub_tags가 depth2(직무)에 대응한다.
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
                "parent_tag_id": parent["id"],  # upsert 2단계에서 uuid로 치환 필요 (아래 seed_job 참고)
                "title": child["title"],
                "tag_id": child["id"],
                "depth": 2,
                "sort_order": child_sort_order,
            })
    return depth1_rows, depth2_rows


def seed_job(wanted_base_url, client_id, client_secret, supabase_url, service_role_key):
    print("=== JOB 시드 시작 (Wanted Open API /v1/tags/categories) ===")
    payload = fetch_categories(wanted_base_url, client_id, client_secret)
    depth1_rows, depth2_rows = build_upsert_rows(payload)
    print("[INFO] depth1(직군) {}건, depth2(직무) {}건 변환 완료".format(len(depth1_rows), len(depth2_rows)))

    inserted_depth1 = supabase_upsert(supabase_url, service_role_key, "categories", depth1_rows, on_conflict="tag_id")
    tag_id_to_uuid = {row["tag_id"]: row["id"] for row in inserted_depth1}
    print("[INFO] depth1 upsert 완료: {}건 반영".format(len(inserted_depth1)))

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

    inserted_depth2 = supabase_upsert(
        supabase_url, service_role_key, "categories", resolved_depth2_rows, on_conflict="tag_id")
    print("JOB 신규/갱신: depth1 {}건, depth2 {}건".format(len(inserted_depth1), len(inserted_depth2)))


# ---------------------------------------------------------------------------
# INDUSTRY/REGION/SKILL — company 브랜치 로직 유지(단일 자연키가 없어 find-then-insert 패턴)
# ---------------------------------------------------------------------------

def sb_request(supabase_url, service_role_key, method, path, params=None, body=None, extra_headers=None):
    qs = "?" + urllib.parse.urlencode(params) if params else ""
    headers = {
        "apikey": service_role_key,
        "Authorization": "Bearer {}".format(service_role_key),
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(supabase_url.rstrip("/") + path + qs, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("{} {} 실패: {} {}".format(method, path, e.code, detail)) from e


def sb_get(supabase_url, service_role_key, params):
    return sb_request(supabase_url, service_role_key, "GET", "/rest/v1/categories", params=params)


def find_existing(supabase_url, service_role_key, category_type, parent_id, title):
    params = {
        "select": "id",
        "category_type": "eq.{}".format(category_type),
        "title": "eq.{}".format(title),
        "parent_id": "is.null" if parent_id is None else "eq.{}".format(parent_id),
    }
    rows = sb_get(supabase_url, service_role_key, params)
    return rows[0]["id"] if rows else None


def upsert_category(supabase_url, service_role_key, category_type, parent_id, title, depth, sort_order, **extra):
    existing_id = find_existing(supabase_url, service_role_key, category_type, parent_id, title)
    if existing_id:
        return existing_id, False
    row = {"category_type": category_type, "parent_id": parent_id, "title": title,
           "depth": depth, "sort_order": sort_order}
    row.update(extra)
    created = sb_request(supabase_url, service_role_key, "POST", "/rest/v1/categories", body=row,
                          extra_headers={"Prefer": "return=representation"})
    return created[0]["id"], True


def seed_industry(supabase_url, service_role_key):
    print("=== INDUSTRY 시드 시작 (seed_data_industry.json) ===")
    with open(os.path.join(SCRIPT_DIR, "seed_data_industry.json"), encoding="utf-8") as f:
        data = json.load(f)

    inserted = 0
    section_id_by_code = {}
    for i, section in enumerate(data["section"]):
        cid, created = upsert_category(supabase_url, service_role_key, "INDUSTRY", None, section["title"],
                                        depth=1, sort_order=i, industry_code=section["industry_code"])
        section_id_by_code[section["industry_code"]] = cid
        inserted += int(created)

    division_id_by_ksic = {}
    for i, division in enumerate(data["division"]):
        parent_id = section_id_by_code.get(division["parent_section_industry_code"])
        if parent_id is None:
            print("  [skip] division '{}' 부모 section({})을 찾을 수 없음".format(
                division["title"], division["parent_section_industry_code"]))
            continue
        cid, created = upsert_category(supabase_url, service_role_key, "INDUSTRY", parent_id, division["title"],
                                        depth=2, sort_order=i, ksic_code=division["ksic_code"],
                                        industry_code=division["industry_code"])
        division_id_by_ksic[division["ksic_code"]] = cid
        inserted += int(created)

    for i, klass in enumerate(data["class"]):
        parent_id = division_id_by_ksic.get(klass["parent_ksic_code"])
        if parent_id is None:
            print("  [skip] class '{}' 부모 division({})을 찾을 수 없음".format(
                klass["title"], klass["parent_ksic_code"]))
            continue
        _, created = upsert_category(supabase_url, service_role_key, "INDUSTRY", parent_id, klass["title"],
                                      depth=3, sort_order=i, ksic_code=klass["ksic_code"],
                                      industry_code=klass["industry_code"])
        inserted += int(created)

    print("INDUSTRY 신규 삽입: {}건 (source: {})".format(inserted, data["_source"]))


def seed_region(supabase_url, service_role_key):
    print("=== REGION 시드 시작 (seed_data_region.json) ===")
    with open(os.path.join(SCRIPT_DIR, "seed_data_region.json"), encoding="utf-8") as f:
        data = json.load(f)

    inserted = 0
    sido_id_by_code = {}
    for i, sido in enumerate(data["sido"]):
        cid, created = upsert_category(supabase_url, service_role_key, "REGION", None, sido["title"],
                                        depth=1, sort_order=i, location_code=sido["location_code"])
        sido_id_by_code[sido["location_code"]] = cid
        inserted += int(created)

    sigungu_id_by_code = {}
    for i, sigungu in enumerate(data["sigungu"]):
        parent_id = sido_id_by_code.get(sigungu["parent_location_code"])
        if parent_id is None:
            print("  [skip] sigungu '{}' 부모 sido({})를 찾을 수 없음".format(
                sigungu["title"], sigungu["parent_location_code"]))
            continue
        cid, created = upsert_category(supabase_url, service_role_key, "REGION", parent_id, sigungu["title"],
                                        depth=2, sort_order=i, location_code=sigungu["location_code"])
        sigungu_id_by_code[sigungu["location_code"]] = cid
        inserted += int(created)

    for i, dong in enumerate(data["eupmyeondong"]):
        parent_id = sigungu_id_by_code.get(dong["parent_location_code"])
        if parent_id is None:
            print("  [skip] eupmyeondong '{}' 부모 sigungu({})를 찾을 수 없음".format(
                dong["title"], dong["parent_location_code"]))
            continue
        _, created = upsert_category(supabase_url, service_role_key, "REGION", parent_id, dong["title"],
                                      depth=3, sort_order=i, location_code=dong["location_code"])
        inserted += int(created)

    print("REGION 신규 삽입: {}건 (source: {})".format(inserted, data["_source"]))


def seed_skill(wanted_base_url, client_id, client_secret, supabase_url, service_role_key):
    print("=== SKILL 시드 시작 (Wanted Open API /v1/tags/skills, 키워드 검색) ===")
    seen_by_id = {}
    for kw in SKILL_KEYWORDS:
        qs = urllib.parse.urlencode({"keyword": kw})
        req = urllib.request.Request(
            wanted_base_url.rstrip("/") + "/tags/skills?" + qs,
            headers={"wanted-client-id": client_id, "wanted-client-secret": client_secret},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        items = payload["data"] if isinstance(payload, dict) else payload
        for item in items:
            seen_by_id[item["id"]] = item["title"]
        time.sleep(0.25)

    inserted = 0
    for i, (tag_id, title) in enumerate(seen_by_id.items()):
        _, created = upsert_category(supabase_url, service_role_key, "SKILL", None, title,
                                      depth=1, sort_order=i, tag_id=tag_id)
        inserted += int(created)

    print("SKILL 신규 삽입: {}건 (키워드 {}개 검색 결과 중복 제거 후 {}개)".format(
        inserted, len(SKILL_KEYWORDS), len(seen_by_id)))


def verify(supabase_url, service_role_key):
    print("=== 검증: category_type별 개수 / 최상위 개수 ===")
    for category_type in ["INDUSTRY", "JOB", "SKILL", "REGION"]:
        total = sb_get(supabase_url, service_role_key, {"select": "id", "category_type": "eq.{}".format(category_type)})
        top = sb_get(supabase_url, service_role_key,
                     {"select": "id", "category_type": "eq.{}".format(category_type), "parent_id": "is.null"})
        print("  {}: 전체 {}건, 최상위(depth=1) {}건".format(category_type, len(total), len(top)))


def main():
    repo_root = find_repo_root(SCRIPT_DIR)
    env = load_env(os.path.join(repo_root, ".env"))

    client_id = env.get("client_id", "")
    client_secret = env.get("client_secret", "")
    wanted_base_url = env.get("WANTED_API_BASE_URL") or DEFAULT_BASE_URL
    supabase_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not client_id or not client_secret or is_placeholder(supabase_url) or not service_role_key:
        print("[ERROR] .env에 client_id/client_secret/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
              file=sys.stderr)
        sys.exit(1)

    seed_industry(supabase_url, service_role_key)
    seed_region(supabase_url, service_role_key)
    seed_job(wanted_base_url, client_id, client_secret, supabase_url, service_role_key)
    seed_skill(wanted_base_url, client_id, client_secret, supabase_url, service_role_key)
    verify(supabase_url, service_role_key)


if __name__ == "__main__":
    main()
