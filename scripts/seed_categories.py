"""
scripts/seed_categories.py

categories 테이블 시드 스크립트. company 브랜치(backend/scripts/seed_categories.py)의 로직을
이 브랜치 관례(표준 라이브러리만 사용, 저장소 루트 .env)로 옮긴 것이다.

DB.md 3.2절 스키마 기준으로 4개 category_type을 채운다. 가짜 placeholder가 아니라 실제
출처에서 가져온 값이지만, 로컬 개발/테스트용 "대표 샘플"이라는 점에 유의한다:
- INDUSTRY: seed_data_industry.json (통계청 KSIC 공식 분류 대표 6개 섹션 샘플)
- REGION:   seed_data_region.json (행정안전부 법정동코드 공식 자료 대표 6개 시도 샘플)
- JOB:      원티드 Open API `/v1/tags/categories` 전체 응답(대분류 전량, 실서비스와 동일)
- SKILL:    원티드 Open API `/v1/tags/skills?keyword=...`를 키워드 목록으로 검색한 결과(id 중복 제거)

⚠️ 참고: 이 브랜치가 쓰는 라이브 Supabase 프로젝트(jobseeker-matching)에는 이미 이 스크립트가
실행된 상태다(JOB 438건/SKILL 226건 tag_id 보유, INDUSTRY/REGION도 ksic_code/location_code
보유, 2026-07-15 확인). (category_type, parent_id, title) 조합이 이미 있으면 건너뛰므로
재실행해도 안전하지만, 보통은 다시 돌릴 필요가 없다 — 새 환경을 부트스트랩할 때만 필요하다.

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

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WANTED_BASE_URL = "https://openapi.wanted.jobs/v1"

SKILL_KEYWORDS = [
    "JavaScript", "Python", "Java", "React", "Vue", "Node.js", "Spring", "SQL",
    "AWS", "Docker", "Kubernetes", "Git", "Figma", "Photoshop", "Excel",
    "PowerPoint", "기획", "마케팅", "디자인", "데이터분석", "영업", "회계", "인사",
    "물류", "C++", "Swift", "Kotlin", "TypeScript", "MySQL", "포토샵",
]


def find_repo_root(start):
    d = start
    while True:
        if os.path.isfile(os.path.join(d, ".env")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent


def load_env(path):
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


def wanted_get(base_url, client_id, client_secret, path, params=None):
    qs = "?" + urllib.parse.urlencode(params) if params else ""
    req = urllib.request.Request(
        base_url.rstrip("/") + path + qs,
        headers={"wanted-client-id": client_id, "wanted-client-secret": client_secret},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


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


def seed_job(wanted_base_url, client_id, client_secret, supabase_url, service_role_key):
    print("=== JOB 시드 시작 (Wanted Open API /v1/tags/categories) ===")
    payload = wanted_get(wanted_base_url, client_id, client_secret, "/tags/categories")
    items = payload["data"] if isinstance(payload, dict) else payload

    inserted = 0
    for i, item in enumerate(items):
        parent_id, created = upsert_category(supabase_url, service_role_key, "JOB", None, item["title"],
                                              depth=1, sort_order=i, tag_id=item["id"])
        inserted += int(created)
        for j, sub in enumerate(item.get("sub_tags", [])):
            _, sub_created = upsert_category(supabase_url, service_role_key, "JOB", parent_id, sub["title"],
                                              depth=2, sort_order=j, tag_id=sub["id"])
            inserted += int(sub_created)

    print("JOB 신규 삽입: {}건 (원티드 직군 {}개 전량)".format(inserted, len(items)))


def seed_skill(wanted_base_url, client_id, client_secret, supabase_url, service_role_key):
    print("=== SKILL 시드 시작 (Wanted Open API /v1/tags/skills, 키워드 검색) ===")
    seen_by_id = {}
    for kw in SKILL_KEYWORDS:
        payload = wanted_get(wanted_base_url, client_id, client_secret, "/tags/skills", {"keyword": kw})
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
    wanted_base_url = env.get("WANTED_API_BASE_URL") or DEFAULT_WANTED_BASE_URL
    supabase_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not client_id or not client_secret or not supabase_url or not service_role_key:
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
