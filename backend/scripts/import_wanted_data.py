"""원티드(Wanted) 실데이터 -> CSV -> Supabase import 스크립트.

1차 테스트 피드백 2건 중 "가입 시 지역/업종 선택 범위가 너무 좁다"와 "로그인 후 기업 탭에
데이터가 하나도 안 보인다"를 데이터 측면에서 해결한다. seed_categories.py의 Supabase REST
호출/idempotent upsert 패턴을 그대로 재사용한다.

동작(수동 재import, 스케줄러 없음):
  1) fetch: 원티드 공개 API에서 실제 회사/공고를 수집해 CSV로 저장한다.
     - GET /v1/jobs (페이지네이션)로 active 공고를 모으고, 공고의 company/address/category_tags/
       annual_from~to를 그대로 가져온다. 회사 사업자번호는 GET /v1/companies/{id}로 보강한다.
     - 저장 파일: scripts/data/companies.csv, scripts/data/jobs.csv (원본 그대로)
  2) load: CSV를 다시 읽어 Supabase에 idempotent하게 적재한다.
     - categories(REGION/INDUSTRY)를 "데이터에 실제 존재하는 것만" 추가(삭제/덮어쓰기 없음)
     - 회사 -> auth 유저 -> public.users(COMPANY) -> company_profiles -> company_profile_skills
     - 공고 -> job_postings(+ job_posting_position_details)

인증/권한 관련 사실(2026-07 기준, 실제 호출로 확인함):
  - /v1/insight/company, /v1/ats/company-info 는 현재 자격증명으로 401(No permission)이라
    회사 상세(업종 KSIC/법정동코드/평균연봉)를 가져올 수 없다. 따라서:
      * REGION은 /v1/jobs 의 address(시도/시군구)에서만 추출한다(법정동코드 location_code는 없어 NULL).
      * INDUSTRY는 원티드에서 실값을 못 받으므로, 회사 업종은 공고의 원티드 직군(JOB 대분류)을
        한국표준산업분류(KSIC) 섹션으로 매핑한 근사값이다(JOB_PARENT_TO_INDUSTRY 참고).
        업종 카테고리 자체는 공식 KSIC 21개 섹션(실제 분류체계)으로 넓혀 가입 선택폭을 확보한다.
      * company_profiles.average_salary/hired_salary 는 실데이터가 없어 NULL로 둔다(추정값 넣지 않음).

사용법:
    cd backend
    python scripts/import_wanted_data.py            # fetch 후 load (CSV 없으면 fetch, 있으면 그대로 load)
    python scripts/import_wanted_data.py fetch       # 원티드 -> CSV 재수집만
    python scripts/import_wanted_data.py load         # CSV -> Supabase 적재만
"""

import csv
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

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

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "data"
COMPANIES_CSV = DATA_DIR / "companies.csv"
JOBS_CSV = DATA_DIR / "jobs.csv"

# 수집 목표 회사 수(부트캠프 데모 규모). /v1/jobs를 페이지네이션하며 이 수를 채운다.
TARGET_COMPANIES = 40
JOBS_PAGE_SIZE = 50
JOBS_MAX_OFFSET = 400

# seed 계정 공통 비밀번호(테스트용). 실제 서비스 계정과 구분되도록 @seed.local 도메인을 쓴다.
SEED_PASSWORD = "SeedPass!2026"

# 원티드 시도 약칭 -> (categories에 넣을 정식 명칭, 법정동 시도 코드). 기존 seed_data_region.json이
# 쓰는 정식 명칭/코드 규칙과 동일하게 맞춰 upsert가 기존 행을 재사용하도록 한다.
SIDO_ABBR_TO_FULL = {
    "서울": ("서울특별시", "1100000000"),
    "부산": ("부산광역시", "2600000000"),
    "대구": ("대구광역시", "2700000000"),
    "인천": ("인천광역시", "2800000000"),
    "광주": ("광주광역시", "2900000000"),
    "대전": ("대전광역시", "3000000000"),
    "울산": ("울산광역시", "3100000000"),
    "세종": ("세종특별자치시", "3600000000"),
    "경기": ("경기도", "4100000000"),
    "강원": ("강원도", "4200000000"),
    "충북": ("충청북도", "4300000000"),
    "충남": ("충청남도", "4400000000"),
    "전북": ("전라북도", "4500000000"),
    "전남": ("전라남도", "4600000000"),
    "경북": ("경상북도", "4700000000"),
    "경남": ("경상남도", "4800000000"),
    "제주": ("제주특별자치도", "5000000000"),
}

# 공식 KSIC 10차 대분류 21개 섹션(통계청 분류체계). 가입 업종 선택폭 확보용으로 전량 추가한다.
# depth=1 섹션은 industry_code(섹션 문자)만 채우고 ksic_code는 NULL(기존 seed_data_industry.json과 동일).
KSIC_SECTIONS = [
    ("A", "농업, 임업 및 어업"),
    ("B", "광업"),
    ("C", "제조업"),
    ("D", "전기, 가스, 증기 및 공기 조절 공급업"),
    ("E", "수도, 하수 및 폐기물 처리, 원료 재생업"),
    ("F", "건설업"),
    ("G", "도매 및 소매업"),
    ("H", "운수 및 창고업"),
    ("I", "숙박 및 음식점업"),
    ("J", "정보통신업"),
    ("K", "금융 및 보험업"),
    ("L", "부동산업"),
    ("M", "전문, 과학 및 기술 서비스업"),
    ("N", "사업시설 관리, 사업 지원 및 임대 서비스업"),
    ("O", "공공행정, 국방 및 사회보장 행정"),
    ("P", "교육 서비스업"),
    ("Q", "보건업 및 사회복지 서비스업"),
    ("R", "예술, 스포츠 및 여가관련 서비스업"),
    ("S", "협회 및 단체, 수리 및 기타 개인 서비스업"),
    ("T", "가구 내 고용활동 및 달리 분류되지 않은 자가 소비 생산활동"),
    ("U", "국제 및 외국기관"),
]

# 원티드 직군(JOB 대분류) tag_id -> KSIC 섹션 코드. insight(업종)를 못 받아 쓰는 근사 매핑이다.
# 매핑에 없는 직군은 기본값 "M"(전문·과학 및 기술 서비스업)으로 분류한다.
JOB_PARENT_TO_INDUSTRY = {
    518: "J",    # 개발
    959: "J",    # 게임 제작
    10566: "J",  # 정보보호
    524: "J",    # 미디어(출판·영상·방송)
    511: "M",    # 디자인
    507: "M",    # 경영·비즈니스
    523: "M",    # 마케팅·광고
    521: "M",    # 법률·법집행기관
    513: "M",    # 엔지니어링·설계
    530: "G",    # 영업
    510: "G",    # 고객서비스·리테일
    532: "H",    # 물류·무역
    522: "C",    # 제조·생산
    509: "F",    # 건설·시설
    508: "K",    # 금융
    517: "N",    # HR
    515: "Q",    # 의료·제약·바이오
    514: "Q",    # 공공·복지
    10101: "P",  # 교육
    10057: "I",  # 식·음료
}

DEFAULT_INDUSTRY_SECTION = "M"

# 회사 필요 스킬 / 구직자 보유 스킬이 겹치도록 공용으로 쓰는 대표 스킬 title 풀.
# 실제 categories(SKILL)에 존재하는 title만 사용한다(존재하지 않으면 자동으로 건너뜀).
COMMON_SKILL_TITLES = ["Python", "Java", "JavaScript", "React", "SQL", "Spring", "AWS", "Figma"]


# ----------------------------- Supabase REST 헬퍼 -----------------------------


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


def find_existing_category(category_type, parent_id, title):
    params = {
        "select": "id",
        "category_type": f"eq.{category_type}",
        "title": f"eq.{title}",
        "parent_id": "is.null" if parent_id is None else f"eq.{parent_id}",
    }
    rows = sb_get("categories", params)
    return rows[0]["id"] if rows else None


def upsert_category(category_type, parent_id, title, depth, sort_order, **extra):
    """(category_type, parent_id, title)가 이미 있으면 그 id를, 없으면 insert 후 id를 반환. (id, 신규여부)."""
    existing_id = find_existing_category(category_type, parent_id, title)
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
    created = sb_insert("categories", row)
    return created["id"], True


# ----------------------------- Auth Admin 헬퍼 -----------------------------


def load_auth_user_map():
    """auth.users 전체를 페이지네이션으로 읽어 {email(lower): id} 맵을 만든다(재실행 시 중복 생성 방지)."""
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
    """이미 있으면 그 id, 없으면 생성 후 맵에 반영한 id를 반환."""
    key = email.lower()
    if key in auth_map:
        return auth_map[key]
    uid = create_auth_user(email, password)
    auth_map[key] = uid
    return uid


def ensure_public_user(user_id, user_type):
    existing = sb_get("users", {"select": "id", "id": f"eq.{user_id}"})
    if existing:
        return
    sb_insert("users", {"id": user_id, "user_type": user_type}, return_repr=False)


# ----------------------------- 1) 원티드 -> CSV -----------------------------


SIDO_SUFFIXES = ("특별시", "광역시", "특별자치시", "특별자치도", "도")


def _parse_sigungu(full_location):
    """full_location에서 시군구(…구/…시/…군)만 안전하게 추출. 도로명/숫자/해외주소 토큰은 버린다.

    full_location의 첫 토큰은 항상 시도(예: "서울"/"서울특별시")이므로 건너뛰고, 이후 토큰 중
    한글로만 이루어지고 …구/…시/…군으로 끝나며 시도 접미사(특별시/광역시/도 등)가 아닌 첫 토큰만
    시군구로 인정한다("퇴계로"/"12,"/"Angeles,"/"서울특별시" 등 제외).
    """
    tokens = (full_location or "").split()
    for token in tokens[1:]:
        if token.endswith(SIDO_SUFFIXES):
            continue
        if token.endswith(("구", "시", "군")) and len(token) >= 2 and all("가" <= c <= "힣" for c in token):
            return token
    return None


def fetch_from_wanted():
    print("=== [fetch] 원티드 /v1/jobs 수집 시작 ===")
    companies = {}     # wanted_company_id -> dict
    jobs = []          # 공고 원본 dict 목록
    offset = 0
    while len(companies) < TARGET_COMPANIES and offset <= JOBS_MAX_OFFSET:
        r = requests.get(
            f"{WANTED_API_BASE_URL}/v1/jobs",
            headers=WANTED_HEADERS,
            params={"limit": JOBS_PAGE_SIZE, "offset": offset},
            timeout=30,
        )
        if r.status_code != 200:
            raise RuntimeError(f"/v1/jobs 호출 실패(offset={offset}): {r.status_code} {r.text}")
        data = r.json().get("data", [])
        if not data:
            break

        for j in data:
            comp = j.get("company") or {}
            cid = comp.get("id")
            if cid is None:
                continue
            addr = j.get("address") or {}
            sido_abbr = addr.get("location")
            full_loc = addr.get("full_location") or ""
            sigungu = _parse_sigungu(full_loc)
            ct = j.get("category_tags") or {}
            parent = ct.get("parent_tag") or {}
            children = ct.get("child_tags") or []

            if sido_abbr not in SIDO_ABBR_TO_FULL:
                # 국내 시도로 매핑되지 않는 주소(해외 등)는 지역 매칭이 불가하므로 회사 후보에서 제외
                continue
            if parent.get("id") is None:
                continue

            if cid not in companies and len(companies) < TARGET_COMPANIES:
                companies[cid] = {
                    "wanted_company_id": cid,
                    "name": comp.get("name") or "",
                    "registration_number": "",
                    "sido_abbr": sido_abbr,
                    "sigungu": sigungu or "",
                    "full_location": full_loc,
                    "job_parent_tag_id": parent.get("id"),
                    "job_parent_title": parent.get("title") or "",
                }
            if cid not in companies:
                continue

            jobs.append({
                "wanted_job_id": j.get("id"),
                "wanted_company_id": cid,
                "name": j.get("name") or "",
                "status": j.get("status") or "active",
                "annual_from": j.get("annual_from") if j.get("annual_from") is not None else 0,
                "annual_to": j.get("annual_to") if j.get("annual_to") is not None else "",
                "job_parent_tag_id": parent.get("id"),
                "job_parent_title": parent.get("title") or "",
                "job_child_tag_ids": ",".join(str(c["id"]) for c in children if c.get("id") is not None),
                "job_child_titles": ",".join(c.get("title", "") for c in children),
                "full_location": full_loc,
                "url": j.get("url") or "",
            })
        print(f"  offset={offset}: 누적 회사 {len(companies)}개 / 공고 {len(jobs)}건")
        offset += JOBS_PAGE_SIZE
        time.sleep(0.2)

    # 회사 사업자등록번호 보강(있으면 CSV에 실값 기록, 실패해도 진행)
    print("  회사 사업자등록번호 보강(/v1/companies/{id}) ...")
    for cid, c in companies.items():
        try:
            r = requests.get(f"{WANTED_API_BASE_URL}/v1/companies/{cid}", headers=WANTED_HEADERS, timeout=30)
            if r.status_code == 200:
                detail = (r.json() or {}).get("company") or {}
                c["registration_number"] = detail.get("registration_number") or ""
        except requests.RequestException:
            pass
        time.sleep(0.1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(COMPANIES_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "wanted_company_id", "name", "registration_number",
            "sido_abbr", "sigungu", "full_location",
            "job_parent_tag_id", "job_parent_title",
        ])
        writer.writeheader()
        for c in companies.values():
            writer.writerow(c)

    with open(JOBS_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "wanted_job_id", "wanted_company_id", "name", "status",
            "annual_from", "annual_to", "job_parent_tag_id", "job_parent_title",
            "job_child_tag_ids", "job_child_titles", "full_location", "url",
        ])
        writer.writeheader()
        for j in jobs:
            writer.writerow(j)

    print(f"[fetch] 완료: 회사 {len(companies)}개 -> {COMPANIES_CSV}")
    print(f"[fetch] 완료: 공고 {len(jobs)}건 -> {JOBS_CSV}")


# ----------------------------- 2) CSV -> Supabase -----------------------------


def _ensure_industry_sections():
    """KSIC 21개 섹션을 idempotent upsert. 섹션 코드(industry_code) -> category_id 맵 반환. (맵, 신규수)."""
    section_by_code = {}
    new_count = 0
    for i, (code, title) in enumerate(KSIC_SECTIONS):
        cid, created = upsert_category(
            "INDUSTRY", None, title, depth=1, sort_order=i, industry_code=code
        )
        section_by_code[code] = cid
        new_count += int(created)
    return section_by_code, new_count


def _build_job_tag_maps():
    """categories(JOB) 전체를 읽어 tag_id -> {id, depth} 맵을 만든다(원티드 직군/직무 매핑용)."""
    rows = sb_get("categories", {"select": "id,tag_id,depth", "category_type": "eq.JOB"})
    by_tag = {}
    for r in rows:
        if r.get("tag_id") is not None:
            by_tag[int(r["tag_id"])] = {"id": r["id"], "depth": r["depth"]}
    return by_tag


def _build_skill_pool():
    """공용 스킬 title 중 실제 categories(SKILL)에 존재하는 것만 [{title,id}]로 반환."""
    pool = []
    for title in COMMON_SKILL_TITLES:
        rows = sb_get("categories", {"select": "id", "category_type": "eq.SKILL", "title": f"eq.{title}"})
        if rows:
            pool.append({"title": title, "id": rows[0]["id"]})
    return pool


def _ensure_region_for_company(company_row, sido_cache):
    """회사의 시도/시군구를 REGION categories로 upsert하고 회사에 매칭할 region_category_id를 반환.

    시군구가 유효하면 시군구(depth2), 없으면 시도(depth1)를 회사 지역으로 쓴다.
    시도는 정식 명칭+법정동코드, 시군구는 실데이터에 등장한 명칭만(location_code는 insight 미접근으로 NULL).
    반환: (region_category_id, 신규 카테고리 수)
    """
    new_count = 0
    abbr = company_row["sido_abbr"]
    full_title, sido_code = SIDO_ABBR_TO_FULL[abbr]

    if abbr in sido_cache:
        sido_id = sido_cache[abbr]
    else:
        sido_id, created = upsert_category(
            "REGION", None, full_title, depth=1, sort_order=0, location_code=sido_code
        )
        sido_cache[abbr] = sido_id
        new_count += int(created)

    sigungu = (company_row.get("sigungu") or "").strip()
    if sigungu:
        sigungu_id, created = upsert_category("REGION", sido_id, sigungu, depth=2, sort_order=0)
        new_count += int(created)
        return sigungu_id, new_count
    return sido_id, new_count


def load_to_supabase():
    if not COMPANIES_CSV.exists() or not JOBS_CSV.exists():
        raise SystemExit(f"CSV가 없습니다. 먼저 fetch를 실행하세요: {COMPANIES_CSV}, {JOBS_CSV}")

    print("=== [load] CSV -> Supabase 적재 시작 ===")
    with open(COMPANIES_CSV, encoding="utf-8") as f:
        companies = list(csv.DictReader(f))
    with open(JOBS_CSV, encoding="utf-8") as f:
        all_jobs = list(csv.DictReader(f))

    jobs_by_company = {}
    for j in all_jobs:
        jobs_by_company.setdefault(j["wanted_company_id"], []).append(j)

    section_by_code, new_industry = _ensure_industry_sections()
    job_tag_map = _build_job_tag_maps()
    skill_pool = _build_skill_pool()
    auth_map = load_auth_user_map()
    sido_cache = {}

    new_region = 0
    n_company = 0
    n_job = 0
    n_skill_link = 0
    job_counter = 0

    for idx, c in enumerate(companies, start=1):
        # 지역 카테고리 확보 + 회사 지역 결정
        region_id, added = _ensure_region_for_company(c, sido_cache)
        new_region += added

        # 직군(position) 카테고리: 원티드 parent tag_id -> categories(JOB depth1)
        parent_tag_id = int(c["job_parent_tag_id"])
        job_entry = job_tag_map.get(parent_tag_id)
        if not job_entry:
            print(f"  [skip] 회사 '{c['name']}' 직군 tag_id={parent_tag_id} 가 categories(JOB)에 없음")
            continue
        position_id = job_entry["id"]

        # 업종(industry): 직군 -> KSIC 섹션 근사 매핑
        section_code = JOB_PARENT_TO_INDUSTRY.get(parent_tag_id, DEFAULT_INDUSTRY_SECTION)
        industry_id = section_by_code[section_code]

        # auth 유저 -> public.users(COMPANY)
        email = f"company{idx}@seed.local"
        uid = ensure_auth_user(email, SEED_PASSWORD, auth_map)
        ensure_public_user(uid, "COMPANY")

        # company_profiles (user_id UNIQUE 기준 idempotent)
        existing_profile = sb_get("company_profiles", {"select": "id", "user_id": f"eq.{uid}"})
        if existing_profile:
            profile_id = existing_profile[0]["id"]
        else:
            profile = sb_insert("company_profiles", {
                "user_id": uid,
                "industry_category_id": industry_id,
                "company_size": "미상",  # insight 미접근으로 실제 규모 데이터 없음
                "region_category_id": region_id,
                "position_category_id": position_id,
                "employment_type": "regular",  # /v1/jobs에 고용형태 없음 -> 기본값
                "average_salary": None,  # insight 미접근 -> 추정값 넣지 않고 NULL
                "hired_salary": None,
            })
            profile_id = profile["id"]
            n_company += 1

        # 필요 스킬(company_profile_skills): 공용 풀에서 직군 인덱스에 따라 1~3개 부여(겹치는 스킬로 매칭 유도)
        if skill_pool and not sb_get("company_profile_skills", {"select": "skill_category_id", "company_profile_id": f"eq.{profile_id}", "limit": "1"}):
            chosen = [skill_pool[(idx + k) % len(skill_pool)] for k in range(min(3, len(skill_pool)))]
            seen = set()
            for s in chosen:
                if s["id"] in seen:
                    continue
                seen.add(s["id"])
                try:
                    sb_insert("company_profile_skills", {
                        "company_profile_id": profile_id, "skill_category_id": s["id"],
                    }, return_repr=False)
                    n_skill_link += 1
                except RuntimeError:
                    pass

        # 공고(job_postings): 이미 이 회사에 공고가 있으면 재적재하지 않는다(재실행 안전)
        has_postings = sb_get("job_postings", {"select": "id", "company_profile_id": f"eq.{profile_id}", "limit": "1"})
        if has_postings:
            continue

        for j in jobs_by_company.get(c["wanted_company_id"], []):
            j_parent = int(j["job_parent_tag_id"]) if j["job_parent_tag_id"] else parent_tag_id
            j_pos = job_tag_map.get(j_parent)
            if not j_pos:
                continue

            # posted_at을 최근 6개월(2026-02~2026-07)에 분산 -> 시장분석 월별 추이가 의미있도록
            month_offset = job_counter % 6
            posted_at = datetime(2026, 7 - month_offset, 10, tzinfo=timezone.utc).isoformat()
            job_counter += 1

            annual_to = int(j["annual_to"]) if j.get("annual_to") not in (None, "") else None
            posting = sb_insert("job_postings", {
                "company_profile_id": profile_id,
                "position_category_id": j_pos["id"],
                "employment_type": "regular",
                "annual_from": int(j["annual_from"]) if j.get("annual_from") not in (None, "") else 0,
                "annual_to": annual_to,
                "status": "active",
                "posted_at": posted_at,
            })
            n_job += 1

            # 직무 상세(job_posting_position_details): child tag_id 중 depth=2 JOB만
            detail_ids = []
            for raw in (j.get("job_child_tag_ids") or "").split(","):
                raw = raw.strip()
                if not raw:
                    continue
                entry = job_tag_map.get(int(raw))
                if entry and entry["depth"] == 2 and entry["id"] not in detail_ids:
                    detail_ids.append(entry["id"])
            for did in detail_ids:
                try:
                    sb_insert("job_posting_position_details", {
                        "job_posting_id": posting["id"], "position_detail_category_id": did,
                    }, return_repr=False)
                except RuntimeError:
                    pass

    print("\n=== [load] 요약 ===")
    print(f"  신규 INDUSTRY 섹션: {new_industry}건 (KSIC 21섹션 중 기존 제외)")
    print(f"  신규 REGION 카테고리: {new_region}건 (시도/시군구, 실데이터 등장분만)")
    print(f"  신규 company_profiles: {n_company}개")
    print(f"  신규 job_postings: {n_job}건")
    print(f"  신규 company_profile_skills 링크: {n_skill_link}건")
    print(f"  테스트 로그인: company1@seed.local ~ company{len(companies)}@seed.local / 비밀번호 {SEED_PASSWORD}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode == "fetch":
        fetch_from_wanted()
    elif mode == "load":
        load_to_supabase()
    elif mode == "all":
        if not (COMPANIES_CSV.exists() and JOBS_CSV.exists()):
            fetch_from_wanted()
        else:
            print(f"[all] 기존 CSV를 사용합니다(재수집하려면 fetch): {COMPANIES_CSV}")
        load_to_supabase()
    else:
        raise SystemExit("사용법: python scripts/import_wanted_data.py [fetch|load|all]")


if __name__ == "__main__":
    main()
