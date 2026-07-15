"""
scripts/import_wanted_data.py

원티드(Wanted) 실데이터 -> CSV -> Supabase import 스크립트.

company 브랜치(backend/scripts/import_wanted_data.py)가 실제 원티드 API 호출로 이미 검증한
로직을 이 브랜치의 관례(외부 패키지 없이 표준 라이브러리만 사용, 저장소 루트 .env,
scripts/fetch_wanted_trend.py와 동일한 스타일)로 그대로 옮긴 것이다. 필드 경로/제약사항은
새로 추측하지 않고 company 브랜치가 실제로 확인한 값을 그대로 따른다.

인증/권한 관련 사실(company 브랜치가 2026-07 실제 호출로 확인, 이 스크립트도 동일 자격증명 사용):
  - `/v1/insight/company`, `/v1/ats/company-info`는 현재 발급받은 자격증명으로 401(No permission)이라
    회사 상세(업종 KSIC/법정동코드/평균연봉)를 가져올 수 없다. 따라서:
      * REGION은 `/v1/jobs`의 `address`(시도/시군구)에서만 추출한다(법정동코드는 시도 단위만 채움).
      * INDUSTRY는 원티드에서 실값을 못 받으므로, 공고의 원티드 직군(JOB 대분류)을 한국표준산업분류
        (KSIC) 섹션으로 매핑한 근사값이다(JOB_PARENT_TO_INDUSTRY 참고).
      * company_profiles.average_salary/hired_salary/company_size는 실데이터가 없어 NULL/"미상"으로 둔다.
  - 공고 제목 필드는 `title`이 아니라 `name`이다.
  - `category_tags`의 하위(세부 직무) 태그는 `.tag`가 아니라 `.child_tags`다.
  - 공고 단위 `skill_tags` 필드는 쓰지 않는다(신뢰 가능한 응답이 없었음) — 대신 겹치는 매칭이
    나오도록 공용 스킬 풀(COMMON_SKILL_TITLES)에서 회사 인덱스 기준으로 1~3개를 배정한다.
  - 원티드에서 긁어온 회사는 우리 서비스 가입 계정이 없다. company_profiles.user_id는
    NOT NULL UNIQUE라 company{n}@seed.local 계정을 Admin API로 실제 생성해서 연결한다
    (supabase/migrations/20260715000000_wanted_job_import.sql이 이 컬럼을 nullable로도
    바꿔뒀지만, 이 스크립트는 company 브랜치와 동일하게 "실 계정 생성" 방식을 쓴다 — RLS의
    insert/update_own 정책이 그대로 의미를 가지려면 이 편이 낫다).
  - wanted_company_id/wanted_job_id(위 마이그레이션에서 추가)를 upsert 키로 써서, company
    브랜치의 "이미 공고가 있으면 통째로 스킵" 방식보다 세밀하게 재실행 안전성을 보장한다.

동작(수동 재실행, 스케줄러 없음):
  1) fetch: 원티드 공개 API에서 실제 회사/공고를 수집해 CSV로 저장한다.
     저장 파일: scripts/data/companies.csv, scripts/data/jobs.csv
  2) load: CSV를 다시 읽어 Supabase에 idempotent하게 적재한다.

사용법:
    python scripts/import_wanted_data.py            # fetch 후 load (CSV 없으면 fetch, 있으면 그대로 load)
    python scripts/import_wanted_data.py fetch       # 원티드 -> CSV 재수집만
    python scripts/import_wanted_data.py load        # CSV -> Supabase 적재만
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from _common import find_repo_root, load_env

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
COMPANIES_CSV = os.path.join(DATA_DIR, "companies.csv")
JOBS_CSV = os.path.join(DATA_DIR, "jobs.csv")

DEFAULT_WANTED_BASE_URL = "https://openapi.wanted.jobs/v1"

# 수집 목표 회사 수(부트캠프 데모 규모). /v1/jobs를 페이지네이션하며 이 수를 채운다.
TARGET_COMPANIES = 40
JOBS_PAGE_SIZE = 50
JOBS_MAX_OFFSET = 400

# seed 계정 공통 비밀번호(테스트용). 실제 서비스 계정과 구분되도록 @seed.local 도메인을 쓴다.
SEED_PASSWORD = "SeedPass!2026"

# 원티드 시도 약칭 -> (categories에 넣을 정식 명칭, 법정동 시도 코드).
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
KSIC_SECTIONS = [
    ("A", "농업, 임업 및 어업"), ("B", "광업"), ("C", "제조업"),
    ("D", "전기, 가스, 증기 및 공기 조절 공급업"), ("E", "수도, 하수 및 폐기물 처리, 원료 재생업"),
    ("F", "건설업"), ("G", "도매 및 소매업"), ("H", "운수 및 창고업"),
    ("I", "숙박 및 음식점업"), ("J", "정보통신업"), ("K", "금융 및 보험업"),
    ("L", "부동산업"), ("M", "전문, 과학 및 기술 서비스업"),
    ("N", "사업시설 관리, 사업 지원 및 임대 서비스업"), ("O", "공공행정, 국방 및 사회보장 행정"),
    ("P", "교육 서비스업"), ("Q", "보건업 및 사회복지 서비스업"),
    ("R", "예술, 스포츠 및 여가관련 서비스업"),
    ("S", "협회 및 단체, 수리 및 기타 개인 서비스업"),
    ("T", "가구 내 고용활동 및 달리 분류되지 않은 자가 소비 생산활동"), ("U", "국제 및 외국기관"),
]

# 원티드 직군(JOB 대분류) tag_id -> KSIC 섹션 코드. insight(업종)를 못 받아 쓰는 근사 매핑이다.
JOB_PARENT_TO_INDUSTRY = {
    518: "J", 959: "J", 10566: "J", 524: "J",
    511: "M", 507: "M", 523: "M", 521: "M", 513: "M",
    530: "G", 510: "G",
    532: "H", 522: "C", 509: "F", 508: "K", 517: "N",
    515: "Q", 514: "Q", 10101: "P", 10057: "I",
}
DEFAULT_INDUSTRY_SECTION = "M"

# 회사 필요 스킬 / 구직자 보유 스킬이 겹치도록 공용으로 쓰는 대표 스킬 title 풀.
COMMON_SKILL_TITLES = ["Python", "Java", "JavaScript", "React", "SQL", "Spring", "AWS", "Figma"]

SIDO_SUFFIXES = ("특별시", "광역시", "특별자치시", "특별자치도", "도")


# ---------------------------------------------------------------------------
# 원티드 API 호출
# ---------------------------------------------------------------------------

def wanted_get(base_url, client_id, client_secret, path, params=None):
    qs = "?" + urllib.parse.urlencode(params) if params else ""
    req = urllib.request.Request(
        base_url.rstrip("/") + path + qs,
        headers={"wanted-client-id": client_id, "wanted-client-secret": client_secret},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_sigungu(full_location):
    """full_location에서 시군구(…구/…시/…군)만 안전하게 추출."""
    tokens = (full_location or "").split()
    for token in tokens[1:]:
        if token.endswith(SIDO_SUFFIXES):
            continue
        if token.endswith(("구", "시", "군")) and len(token) >= 2 and all("가" <= c <= "힣" for c in token):
            return token
    return None


def fetch_from_wanted(base_url, client_id, client_secret):
    print("=== [fetch] 원티드 /v1/jobs 수집 시작 ===")
    companies = {}
    jobs = []
    offset = 0
    while len(companies) < TARGET_COMPANIES and offset <= JOBS_MAX_OFFSET:
        try:
            payload = wanted_get(base_url, client_id, client_secret, "/jobs",
                                  {"limit": JOBS_PAGE_SIZE, "offset": offset})
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            raise RuntimeError("/v1/jobs 호출 실패(offset={}): {}".format(offset, e)) from e

        data = payload.get("data", [])
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
                continue  # 국내 시도로 매핑 안 되는 주소(해외 등)는 지역 매칭 불가 -> 제외
            if parent.get("id") is None:
                continue

            if cid not in companies and len(companies) < TARGET_COMPANIES:
                companies[cid] = {
                    "wanted_company_id": cid,
                    "name": comp.get("name") or "",
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
                "job_child_tag_ids": ",".join(str(c["id"]) for c in children if c.get("id") is not None),
            })
        print("  offset={}: 누적 회사 {}개 / 공고 {}건".format(offset, len(companies), len(jobs)))
        offset += JOBS_PAGE_SIZE
        time.sleep(0.2)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(COMPANIES_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "wanted_company_id", "name", "sido_abbr", "sigungu", "full_location",
            "job_parent_tag_id", "job_parent_title",
        ])
        writer.writeheader()
        for c in companies.values():
            writer.writerow(c)

    with open(JOBS_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "wanted_job_id", "wanted_company_id", "name", "status",
            "annual_from", "annual_to", "job_parent_tag_id", "job_child_tag_ids",
        ])
        writer.writeheader()
        for j in jobs:
            writer.writerow(j)

    print("[fetch] 완료: 회사 {}개 -> {}".format(len(companies), COMPANIES_CSV))
    print("[fetch] 완료: 공고 {}건 -> {}".format(len(jobs), JOBS_CSV))


# ---------------------------------------------------------------------------
# Supabase REST / Auth Admin 호출
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


def sb_get(supabase_url, service_role_key, table, params):
    return sb_request(supabase_url, service_role_key, "GET", "/rest/v1/" + table, params=params)


def sb_insert(supabase_url, service_role_key, table, row, return_repr=True):
    headers = {"Prefer": "return=representation"} if return_repr else {}
    result = sb_request(supabase_url, service_role_key, "POST", "/rest/v1/" + table, body=row, extra_headers=headers)
    return result[0] if return_repr and result else None


def find_existing_category(supabase_url, service_role_key, category_type, parent_id, title):
    params = {
        "select": "id",
        "category_type": "eq.{}".format(category_type),
        "title": "eq.{}".format(title),
        "parent_id": "is.null" if parent_id is None else "eq.{}".format(parent_id),
    }
    rows = sb_get(supabase_url, service_role_key, "categories", params)
    return rows[0]["id"] if rows else None


def upsert_category(supabase_url, service_role_key, category_type, parent_id, title, depth, sort_order, **extra):
    existing_id = find_existing_category(supabase_url, service_role_key, category_type, parent_id, title)
    if existing_id:
        return existing_id, False
    row = {"category_type": category_type, "parent_id": parent_id, "title": title,
           "depth": depth, "sort_order": sort_order}
    row.update(extra)
    created = sb_insert(supabase_url, service_role_key, "categories", row)
    return created["id"], True


def load_auth_user_map(supabase_url, service_role_key):
    """auth.users 전체를 페이지네이션으로 읽어 {email(lower): id} 맵을 만든다(재실행 시 중복 생성 방지)."""
    mapping = {}
    page = 1
    while True:
        body = sb_request(supabase_url, service_role_key, "GET", "/auth/v1/admin/users",
                           params={"page": page, "per_page": 1000})
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


def ensure_auth_user(supabase_url, service_role_key, email, password, auth_map):
    key = email.lower()
    if key in auth_map:
        return auth_map[key]
    created = sb_request(supabase_url, service_role_key, "POST", "/auth/v1/admin/users",
                          body={"email": email, "password": password, "email_confirm": True})
    uid = created["id"]
    auth_map[key] = uid
    return uid


def ensure_public_user(supabase_url, service_role_key, user_id, user_type):
    existing = sb_get(supabase_url, service_role_key, "users", {"select": "id", "id": "eq.{}".format(user_id)})
    if existing:
        return
    sb_insert(supabase_url, service_role_key, "users", {"id": user_id, "user_type": user_type}, return_repr=False)


# ---------------------------------------------------------------------------
# 카테고리 매핑 준비
# ---------------------------------------------------------------------------

def ensure_industry_sections(supabase_url, service_role_key):
    section_by_code = {}
    new_count = 0
    for i, (code, title) in enumerate(KSIC_SECTIONS):
        cid, created = upsert_category(supabase_url, service_role_key, "INDUSTRY", None, title,
                                        depth=1, sort_order=i, industry_code=code)
        section_by_code[code] = cid
        new_count += int(created)
    return section_by_code, new_count


def build_job_tag_map(supabase_url, service_role_key):
    rows = sb_get(supabase_url, service_role_key, "categories",
                  {"select": "id,tag_id,depth", "category_type": "eq.JOB"})
    return {int(r["tag_id"]): {"id": r["id"], "depth": r["depth"]} for r in rows if r.get("tag_id") is not None}


def build_skill_pool(supabase_url, service_role_key):
    pool = []
    for title in COMMON_SKILL_TITLES:
        rows = sb_get(supabase_url, service_role_key, "categories",
                       {"select": "id", "category_type": "eq.SKILL", "title": "eq.{}".format(title)})
        if rows:
            pool.append({"title": title, "id": rows[0]["id"]})
    return pool


def ensure_region_for_company(supabase_url, service_role_key, company_row, sido_cache):
    abbr = company_row["sido_abbr"]
    full_title, sido_code = SIDO_ABBR_TO_FULL[abbr]
    new_count = 0

    if abbr in sido_cache:
        sido_id = sido_cache[abbr]
    else:
        sido_id, created = upsert_category(supabase_url, service_role_key, "REGION", None, full_title,
                                            depth=1, sort_order=0, location_code=sido_code)
        sido_cache[abbr] = sido_id
        new_count += int(created)

    sigungu = (company_row.get("sigungu") or "").strip()
    if sigungu:
        sigungu_id, created = upsert_category(supabase_url, service_role_key, "REGION", sido_id, sigungu,
                                               depth=2, sort_order=0)
        new_count += int(created)
        return sigungu_id, new_count
    return sido_id, new_count


# ---------------------------------------------------------------------------
# CSV -> Supabase 적재
# ---------------------------------------------------------------------------

def load_to_supabase(supabase_url, service_role_key):
    if not os.path.isfile(COMPANIES_CSV) or not os.path.isfile(JOBS_CSV):
        raise SystemExit("CSV가 없습니다. 먼저 fetch를 실행하세요: {}, {}".format(COMPANIES_CSV, JOBS_CSV))

    print("=== [load] CSV -> Supabase 적재 시작 ===")
    with open(COMPANIES_CSV, encoding="utf-8") as f:
        companies = list(csv.DictReader(f))
    with open(JOBS_CSV, encoding="utf-8") as f:
        all_jobs = list(csv.DictReader(f))

    jobs_by_company = {}
    for j in all_jobs:
        jobs_by_company.setdefault(j["wanted_company_id"], []).append(j)

    section_by_code, new_industry = ensure_industry_sections(supabase_url, service_role_key)
    job_tag_map = build_job_tag_map(supabase_url, service_role_key)
    skill_pool = build_skill_pool(supabase_url, service_role_key)
    auth_map = load_auth_user_map(supabase_url, service_role_key)
    sido_cache = {}

    new_region = n_company = n_job = n_skill_link = job_counter = 0
    skipped_companies = []

    # ⚠️ 중복 적재 위험 — 미해결: company 브랜치의 backend/scripts/import_wanted_data.py가
    # 이 마이그레이션(wanted_company_id 컬럼 추가) 이전에 이미 이 라이브 프로젝트에 회사를
    # 적재해뒀다. 그 행들은 wanted_company_id도 company_name도 전부 NULL이라(company 스크립트가
    # company_name을 채우지 않음) 아래 wanted_company_id 매치로도, 이름 매칭으로도 "이미 있음"을
    # 신뢰성 있게 구분할 방법이 없다 — 잘못된 이름 매칭은 서로 다른 두 회사를 같다고 오판할 수도
    # 있어 오히려 위험하다. 따라서 자동 dedup을 시도하지 않고 실행 전에 크게 경고만 한다.
    # 제대로 고치려면: 그 기존 행들에 실제 wanted_company_id를 역으로 채우는 백필이 필요하다
    # (예: 원티드 API를 다시 호출해 회사 주소/직군으로 대사) — 스크립트 로직만으로는 안전하게
    # 자동화할 수 없는 판단(오매칭 허용 범위)이 필요해 PM 결정 사항으로 남긴다.
    legacy_unmapped = sb_get(supabase_url, service_role_key, "company_profiles",
                             {"select": "id", "wanted_company_id": "is.null"})
    if legacy_unmapped:
        print("[WARN] wanted_company_id가 없는 기존 company_profiles {}건이 이미 있습니다 — "
              "이 스크립트를 실행하면 이미 적재된 실제 회사와 같은 회사가 중복 생성될 수 있습니다. "
              "계속하기 전에 백필 여부를 확인하세요.".format(len(legacy_unmapped)), file=sys.stderr)

    for idx, c in enumerate(companies, start=1):
        # 이미 이 원티드 회사가 적재돼 있으면(wanted_company_id 매치) 통째로 건너뛴다(재실행 안전).
        existing = sb_get(supabase_url, service_role_key, "company_profiles",
                           {"select": "id", "wanted_company_id": "eq.{}".format(c["wanted_company_id"])})
        if existing:
            continue

        region_id, added = ensure_region_for_company(supabase_url, service_role_key, c, sido_cache)
        new_region += added

        parent_tag_id = int(c["job_parent_tag_id"])
        job_entry = job_tag_map.get(parent_tag_id)
        if not job_entry:
            skipped_companies.append((c["name"], "직군 tag_id={} 가 categories(JOB)에 없음".format(parent_tag_id)))
            continue
        position_id = job_entry["id"]

        section_code = JOB_PARENT_TO_INDUSTRY.get(parent_tag_id, DEFAULT_INDUSTRY_SECTION)
        industry_id = section_by_code[section_code]

        email = "company{}@seed.local".format(idx)
        uid = ensure_auth_user(supabase_url, service_role_key, email, SEED_PASSWORD, auth_map)
        ensure_public_user(supabase_url, service_role_key, uid, "COMPANY")

        profile = sb_insert(supabase_url, service_role_key, "company_profiles", {
            "user_id": uid,
            "wanted_company_id": int(c["wanted_company_id"]),
            "company_name": c["name"] or None,
            "industry_category_id": industry_id,
            "company_size": "미상",  # 원티드 insight 미접근 -> 실제 규모 데이터 없음
            "region_category_id": region_id,
            "position_category_id": position_id,
            "employment_type": "regular",  # /v1/jobs에 고용형태 필드 없음 -> 기본값
            "average_salary": None,
            "hired_salary": None,
        })
        profile_id = profile["id"]
        n_company += 1

        if skill_pool:
            chosen, seen = [], set()
            for k in range(min(3, len(skill_pool))):
                s = skill_pool[(idx + k) % len(skill_pool)]
                if s["id"] not in seen:
                    seen.add(s["id"])
                    chosen.append(s)
            for s in chosen:
                sb_insert(supabase_url, service_role_key, "company_profile_skills",
                          {"company_profile_id": profile_id, "skill_category_id": s["id"]}, return_repr=False)
                n_skill_link += 1

        for j in jobs_by_company.get(c["wanted_company_id"], []):
            j_parent = int(j["job_parent_tag_id"]) if j["job_parent_tag_id"] else parent_tag_id
            j_pos = job_tag_map.get(j_parent)
            if not j_pos:
                continue

            month_offset = job_counter % 6
            posted_at = datetime(2026, 7 - month_offset, 10, tzinfo=timezone.utc).isoformat()
            job_counter += 1
            annual_to = int(j["annual_to"]) if j.get("annual_to") not in (None, "") else None

            posting = sb_insert(supabase_url, service_role_key, "job_postings", {
                "company_profile_id": profile_id,
                "wanted_job_id": int(j["wanted_job_id"]),
                "title": j["name"] or None,
                "position_category_id": j_pos["id"],
                "employment_type": "regular",
                "annual_from": int(j["annual_from"]) if j.get("annual_from") not in (None, "") else 0,
                "annual_to": annual_to,
                "status": "active",
                "posted_at": posted_at,
            })
            n_job += 1

            detail_ids = []
            for raw in (j.get("job_child_tag_ids") or "").split(","):
                raw = raw.strip()
                if not raw:
                    continue
                entry = job_tag_map.get(int(raw))
                if entry and entry["depth"] == 2 and entry["id"] not in detail_ids:
                    detail_ids.append(entry["id"])
            for did in detail_ids:
                sb_insert(supabase_url, service_role_key, "job_posting_position_details",
                          {"job_posting_id": posting["id"], "position_detail_category_id": did}, return_repr=False)

    if skipped_companies:
        print("[WARN] 회사 {}곳 건너뜀:".format(len(skipped_companies)))
        for name, reason in skipped_companies:
            print("  - {}: {}".format(name, reason))

    print("\n=== [load] 요약 ===")
    print("  신규 INDUSTRY 섹션: {}건".format(new_industry))
    print("  신규 REGION 카테고리: {}건".format(new_region))
    print("  신규 company_profiles: {}개".format(n_company))
    print("  신규 job_postings: {}건".format(n_job))
    print("  신규 company_profile_skills 링크: {}건".format(n_skill_link))
    print("  테스트 로그인: company1@seed.local ~ / 비밀번호 {}".format(SEED_PASSWORD))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode not in ("fetch", "load", "all"):
        raise SystemExit("사용법: python scripts/import_wanted_data.py [fetch|load|all]")

    repo_root = find_repo_root(SCRIPT_DIR)
    env = load_env(os.path.join(repo_root, ".env"))

    client_id = env.get("client_id", "")
    client_secret = env.get("client_secret", "")
    wanted_base_url = env.get("WANTED_API_BASE_URL") or DEFAULT_WANTED_BASE_URL
    supabase_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if mode in ("fetch", "all") and not (mode == "all" and os.path.isfile(COMPANIES_CSV) and os.path.isfile(JOBS_CSV)):
        if not client_id or not client_secret:
            print("[ERROR] .env에 client_id/client_secret이 필요합니다 (.env.example 참고).", file=sys.stderr)
            sys.exit(1)
        fetch_from_wanted(wanted_base_url, client_id, client_secret)
    elif mode == "all":
        print("[all] 기존 CSV를 사용합니다(재수집하려면 fetch): {}".format(COMPANIES_CSV))

    if mode in ("load", "all"):
        if not supabase_url or not service_role_key:
            print("[ERROR] .env에 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 필요합니다.", file=sys.stderr)
            sys.exit(1)
        load_to_supabase(supabase_url, service_role_key)


if __name__ == "__main__":
    main()
