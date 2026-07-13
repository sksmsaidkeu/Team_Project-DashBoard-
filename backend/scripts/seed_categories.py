"""
categories 테이블 시드 스크립트.

DB.md 3.2절 스키마를 기준으로 실제 Supabase 프로젝트의 categories 테이블에
아래 4개 category_type 데이터를 채운다. 가짜 placeholder가 아니라 실제 출처에서
가져온 값이지만, 로컬 개발/테스트용 "대표 샘플"이라는 점에 유의한다:

- INDUSTRY: seed_data_industry.json (통계청 KSIC 공식 분류에서 대표 6개 섹션만 추출한 샘플)
- REGION:   seed_data_region.json (행정안전부 법정동코드 공식 자료에서 대표 6개 시도만 추출한 샘플)
- JOB:      원티드(Wanted) Open API `/v1/tags/categories` 전체 응답 (20개 대분류 전량, 실서비스와 동일)
- SKILL:    원티드 Open API `/v1/tags/skills?keyword=...`를 지정된 키워드 목록으로 검색한 결과를
            id 기준 중복 제거한 것 (전체 스킬 목록 API가 없어 키워드 검색 결과만 모은 샘플)

재실행해도 안전하도록(idempotent) (category_type, parent_id, title) 조합이 이미 있으면
건너뛴다. DB 트리거가 depth/parent-child category_type 일치/타입별 컬럼(NULL) 정합성을
강제하므로(사전에 실제 insert로 확인함), 이 스크립트는 트리거가 검증하는 값을 미리
올바르게 계산해서 보낸다.

사용법:
    cd backend
    python scripts/seed_categories.py
"""

import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
WANTED_API_BASE_URL = os.environ["WANTED_API_BASE_URL"].rstrip("/")
WANTED_API = os.environ["WANTED_API"]
WANTED_SECRET = os.environ["WANTED_SECRET"]

SUPABASE_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}
WANTED_HEADERS = {
    "wanted-client-id": WANTED_API,
    "wanted-client-secret": WANTED_SECRET,
}

SKILL_KEYWORDS = [
    "JavaScript", "Python", "Java", "React", "Vue", "Node.js", "Spring", "SQL",
    "AWS", "Docker", "Kubernetes", "Git", "Figma", "Photoshop", "Excel",
    "PowerPoint", "기획", "마케팅", "디자인", "데이터분석", "영업", "회계", "인사",
    "물류", "C++", "Swift", "Kotlin", "TypeScript", "MySQL", "포토샵",
]

SCRIPT_DIR = Path(__file__).resolve().parent


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=SUPABASE_HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_insert(row):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/categories",
        headers={**SUPABASE_HEADERS, "Prefer": "return=representation"},
        json=row,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"insert failed: {r.status_code} {r.text} payload={row}")
    return r.json()[0]


def find_existing(category_type, parent_id, title):
    params = {
        "select": "id",
        "category_type": f"eq.{category_type}",
        "title": f"eq.{title}",
        "parent_id": "is.null" if parent_id is None else f"eq.{parent_id}",
    }
    rows = sb_get("categories", params)
    return rows[0]["id"] if rows else None


def upsert_category(category_type, parent_id, title, depth, sort_order, **extra):
    """(category_type, parent_id, title) 조합이 이미 있으면 그 id를 반환하고, 없으면 insert 후 id 반환."""
    existing_id = find_existing(category_type, parent_id, title)
    if existing_id:
        return existing_id, False

    row = {
        "category_type": category_type,
        "parent_id": parent_id,
        "title": title,
        "depth": depth,
        "sort_order": sort_order,
    }
    row.update(extra)
    created = sb_insert(row)
    return created["id"], True


def seed_industry():
    print("=== INDUSTRY 시드 시작 (seed_data_industry.json) ===")
    with open(SCRIPT_DIR / "seed_data_industry.json", encoding="utf-8") as f:
        data = json.load(f)

    inserted = 0
    section_id_by_code = {}
    for i, section in enumerate(data["section"]):
        cid, created = upsert_category(
            "INDUSTRY", None, section["title"], depth=1, sort_order=i,
            industry_code=section["industry_code"],
        )
        section_id_by_code[section["industry_code"]] = cid
        inserted += int(created)

    division_id_by_ksic = {}
    for i, division in enumerate(data["division"]):
        parent_id = section_id_by_code.get(division["parent_section_industry_code"])
        if parent_id is None:
            print(f"  [skip] division '{division['title']}' 부모 section({division['parent_section_industry_code']})을 찾을 수 없음")
            continue
        cid, created = upsert_category(
            "INDUSTRY", parent_id, division["title"], depth=2, sort_order=i,
            ksic_code=division["ksic_code"], industry_code=division["industry_code"],
        )
        division_id_by_ksic[division["ksic_code"]] = cid
        inserted += int(created)

    for i, klass in enumerate(data["class"]):
        parent_id = division_id_by_ksic.get(klass["parent_ksic_code"])
        if parent_id is None:
            print(f"  [skip] class '{klass['title']}' 부모 division({klass['parent_ksic_code']})을 찾을 수 없음")
            continue
        _, created = upsert_category(
            "INDUSTRY", parent_id, klass["title"], depth=3, sort_order=i,
            ksic_code=klass["ksic_code"], industry_code=klass["industry_code"],
        )
        inserted += int(created)

    print(f"INDUSTRY 신규 삽입: {inserted}건 (source: {data['_source']})")


def seed_region():
    print("=== REGION 시드 시작 (seed_data_region.json) ===")
    with open(SCRIPT_DIR / "seed_data_region.json", encoding="utf-8") as f:
        data = json.load(f)

    inserted = 0
    sido_id_by_code = {}
    for i, sido in enumerate(data["sido"]):
        cid, created = upsert_category(
            "REGION", None, sido["title"], depth=1, sort_order=i,
            location_code=sido["location_code"],
        )
        sido_id_by_code[sido["location_code"]] = cid
        inserted += int(created)

    sigungu_id_by_code = {}
    for i, sigungu in enumerate(data["sigungu"]):
        parent_id = sido_id_by_code.get(sigungu["parent_location_code"])
        if parent_id is None:
            print(f"  [skip] sigungu '{sigungu['title']}' 부모 sido({sigungu['parent_location_code']})를 찾을 수 없음")
            continue
        cid, created = upsert_category(
            "REGION", parent_id, sigungu["title"], depth=2, sort_order=i,
            location_code=sigungu["location_code"],
        )
        sigungu_id_by_code[sigungu["location_code"]] = cid
        inserted += int(created)

    for i, dong in enumerate(data["eupmyeondong"]):
        parent_id = sigungu_id_by_code.get(dong["parent_location_code"])
        if parent_id is None:
            print(f"  [skip] eupmyeondong '{dong['title']}' 부모 sigungu({dong['parent_location_code']})를 찾을 수 없음")
            continue
        _, created = upsert_category(
            "REGION", parent_id, dong["title"], depth=3, sort_order=i,
            location_code=dong["location_code"],
        )
        inserted += int(created)

    print(f"REGION 신규 삽입: {inserted}건 (source: {data['_source']})")


def seed_job():
    print("=== JOB 시드 시작 (Wanted Open API /v1/tags/categories) ===")
    r = requests.get(f"{WANTED_API_BASE_URL}/v1/tags/categories", headers=WANTED_HEADERS, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Wanted /v1/tags/categories 호출 실패: {r.status_code} {r.text}")

    payload = r.json()
    items = payload["data"] if isinstance(payload, dict) else payload

    inserted = 0
    for i, item in enumerate(items):
        parent_id, created = upsert_category(
            "JOB", None, item["title"], depth=1, sort_order=i,
            tag_id=item["id"],
        )
        inserted += int(created)

        for j, sub in enumerate(item.get("sub_tags", [])):
            _, sub_created = upsert_category(
                "JOB", parent_id, sub["title"], depth=2, sort_order=j,
                tag_id=sub["id"],
            )
            inserted += int(sub_created)

    print(f"JOB 신규 삽입: {inserted}건 (원티드 직군 {len(items)}개 전량)")


def seed_skill():
    print("=== SKILL 시드 시작 (Wanted Open API /v1/tags/skills, 키워드 검색) ===")
    seen_by_id = {}
    for kw in SKILL_KEYWORDS:
        qs = urlencode({"keyword": kw})
        r = requests.get(f"{WANTED_API_BASE_URL}/v1/tags/skills?{qs}", headers=WANTED_HEADERS, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"Wanted /v1/tags/skills 호출 실패(keyword={kw}): {r.status_code} {r.text}")
        payload = r.json()
        items = payload["data"] if isinstance(payload, dict) else payload
        for item in items:
            seen_by_id[item["id"]] = item["title"]
        time.sleep(0.25)

    inserted = 0
    for i, (tag_id, title) in enumerate(seen_by_id.items()):
        _, created = upsert_category(
            "SKILL", None, title, depth=1, sort_order=i,
            tag_id=tag_id,
        )
        inserted += int(created)

    print(f"SKILL 신규 삽입: {inserted}건 (키워드 {len(SKILL_KEYWORDS)}개 검색 결과 중복 제거 후 {len(seen_by_id)}개)")


def verify():
    print("=== 검증: category_type별 개수 / 최상위 개수 ===")
    for category_type in ["INDUSTRY", "JOB", "SKILL", "REGION"]:
        total = sb_get("categories", {"select": "id", "category_type": f"eq.{category_type}"})
        top = sb_get("categories", {"select": "id", "category_type": f"eq.{category_type}", "parent_id": "is.null"})
        print(f"  {category_type}: 전체 {len(total)}건, 최상위(depth=1) {len(top)}건")


def main():
    seed_industry()
    seed_region()
    seed_job()
    seed_skill()
    verify()


if __name__ == "__main__":
    main()
