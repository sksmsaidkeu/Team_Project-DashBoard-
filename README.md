# 채용 플랫폼

카테고리 기반 매칭을 핵심으로 하는 채용 플랫폼입니다. 기업과 구직자가 자유 텍스트가 아닌 사전 정의된 카테고리 체계를 통해 정보를 등록하고, 이를 기반으로 추천/매칭이 이루어집니다.

> 자세한 요구사항은 [`PRD.md`](./PRD.md), 데이터베이스 설계는 [`DB.md`](./DB.md), 디자인 시스템은 [`DESIGN.md`](./DESIGN.md)를 참고하세요. 이 문서는 전체를 요약한 개발 참고용 개요이자 현재 구현 현황을 정리한 문서입니다.

## 다음 세션 체크리스트 — `company` → `main` push + PR 병합 (2026-07-15 예정)

이 브랜치(`company`)에 로컬 커밋 `6095a3b`("Integrate common branch's main-tab dashboard, gate it to members, add signup promo")까지 반영되어 있고, **아직 `origin/company`에 push는 안 된 상태**입니다. 내일 아래 순서로 진행하세요.

1. **push**: `git push origin company` (push 전 `git status`로 의도치 않은 변경이 없는지 한 번 더 확인)
2. **`common` ← `company` 병합**: `common` 체크아웃 폴더에서 `git merge company` 실행. 아래 파일들은 충돌이 나지만 전부 **`company`(이 브랜치, 방금 만든 버전) 쪽을 그대로 채택**하면 된다 — 이미 common의 내용을 흡수해서 통합했기 때문에 판단이 필요 없는 기계적 작업입니다.
   - `index.html`, `js/app.js`, `js/tab-main.js`, `js/categories.js`, `css/app.css`, `.env.example`, `PRD.md`
   - `.gitignore`는 두 브랜치가 서로 다른 항목을 추가했을 뿐이라 자동 병합되거나, 안 되면 두 블록 다 유지
   - `README.md`/`DB.md`/`css/components.css`/`css/tokens.css` 등 나머지는 자동 병합될 가능성이 높음(그래도 병합 후 diff는 한 번 훑어볼 것)
3. **GitHub PR**: `company` → `main`(팀이 정한 target)으로 Pull Request 생성 후 리뷰·병합
4. **주의사항**
   - `js/config.js`는 이제 git에 없습니다 — 로컬에서 새로 체크아웃하는 사람은 `.env` 채운 뒤 `python scripts/generate_config.py` 실행해야 화면이 뜹니다("로컬 실행 방법" 절 참고).
   - 실제 배포(Vercel) 전에는 `API_BASE_URL`을 실제 백엔드 호스팅 주소로 교체해야 합니다 — 로컬 기본값(`127.0.0.1:8000`)은 배포 환경에서 동작하지 않습니다.

## 회원 유형 및 가입 정책

- 회원가입 시 `user_type`(`COMPANY` / `JOBSEEKER`)을 필수로 선택합니다.
- 유형에 따라 가입 폼, 필수 입력값, 온보딩 플로우가 완전히 분기됩니다.
- 역할 전환은 불가하며, 계정당 1개 역할만 가집니다.
- 업종/직무/스킬/지역 등 입력값은 자유 텍스트가 아니라 `categories` 테이블에서 제공하는 선택지(드롭다운/체크박스)에서만 고릅니다.
- 이메일 인증 절차 없이 가입 즉시 계정이 활성화됩니다(Supabase 대시보드에서 "Confirm email" 옵션을 꺼둬야 합니다).

## 카테고리 체계

업종, 직무, 스킬, 지역 데이터는 자유 텍스트가 아닌 사전 정의된 **Category ID** 기반으로 저장·검색·매칭됩니다. 카테고리는 계층형(parent-child) 구조를 가지며, 원티드(Wanted) 공개 API의 변수명·구조와 최대한 통일했습니다(자세한 내용은 `PRD.md` 3장 참고).

| 코드 | 설명 | 계층 구조 |
|---|---|---|
| `INDUSTRY` | 업종 (KSIC 기준) | 대분류/중분류/소분류 3단계 |
| `JOB` | 직무 (직군 → 직무 2단) | 2단계 |
| `SKILL` | 스킬 | 단일 레벨 |
| `REGION` | 지역 (법정동코드 기준) | 시도/시군구/읍면동 3단계 |

`EMPLOYMENT_TYPE`(고용형태)는 Category 타입이 아닙니다. 원티드 API에서 평면 문자열(`regular`/`contract`/`intern`)이므로, `categories` 테이블이 아니라 각 프로필/공고 테이블에 `employment_type` 컬럼으로 직접 둡니다.

## 주요 데이터 모델

- **CompanyProfile** — 업종, 기업 규모, 위치, 직무 카테고리, 고용형태, 필요 스킬(다중), 평균연봉/신규입사자 평균연봉
- **JobSeekerProfile** — 희망 직무, 경력 연차, 거주 지역, 보유 스킬(다중), 희망 연봉, 희망 근무형태
- **JobPosting** — 채용공고. 직무(+직무 상세 다중), 고용형태, 경력 범위, 상태(`draft`/`active`/`close`)
- **UserPreference** — 선호 카테고리 + 가중치
- **InteractionLog** — 조회/저장/지원/게시/마감 로그

컬럼명은 원티드 API 필드명과 통일했습니다(예: `title`, `tag_id`, `ksic_code`, `position_category_id`, `annual_from`/`annual_to`, `average_salary`/`hired_salary`). 정확한 스키마는 [`DB.md`](./DB.md)를 참고하세요.

## 추천/매칭 로직

`UserPreference`와 `InteractionLog`를 입력으로 다음 3단계를 거쳐 추천 결과를 산출합니다.

1. **하드 필터**: 필수 조건 불일치 항목 제외 — **현재 구현된 범위**
2. **소프트 스코어링**: 아래 가중치로 점수 계산 — 기업 탭 인재 검색(`/company/talent-search?sort=score`)에 한해 근사 구현됨
3. **정렬**: 점수순 정렬 후 상위 노출

### 스코어링 가중치

| 항목 | 가중치 |
|---|---|
| 스킬 | 40% |
| 직무 | 25% |
| 지역·연봉 | 15% |
| 활동성 | 10% |
| 최신성 | 10% |

## 화면 구조 (IA) 및 구현 현황

- **메인**: 통합 검색, 채용 트렌드/스킬 수요 랭킹, 추천 하이라이트, 최근 공고/인재, 채용 뉴스 — **구현 완료**(2026-07-14, `common` 브랜치에서 이식). 회원가입 유도를 위해 **로그인 회원 전용**이며, 비로그인 방문자는 "시작" 탭에서 미리보기 홍보만 보고 "메인" 탭 진입 시엔 가입 유도 화면만 표시됩니다.
- **Tab1 (기업용)**: 인재 검색, 공고 관리, 지원자 관리 — **구현 완료** (회원가입 ~ 서브탭 3종 전부)
- **Tab2 (구직자용)**: 공고 열람, 기업 정보, 지원 현황 — 하드필터 기반 "추천 공고" 하이라이트 위젯만 구현됨. PRD가 요구하는 본 화면(공고 열람 전체 목록+필터, 기업 정보, 지원 현황)은 아직 미구현

### 기업 탭(Tab1) 상세

- **공고 관리**: 목록(상태 필터)/등록/수정/삭제, 게시·마감 상태 전환, 직군+직무 상세(다중) 카테고리 선택
- **인재 검색**: 직무/지역/스킬/경력/희망연봉/희망근무형태 필터, 매칭 점수순 정렬(소프트 스코어링)
- **지원자 관리**: 공고별 지원자 목록(지원일시순), 열람 처리 — 지원 파이프라인 단계(서류심사/면접 등) 개념은 DB 스키마에 없어 목록형으로만 구성됨
- 백엔드: `backend/` 하위 FastAPI 앱(Supabase Postgres에 `supabase-py`로 접근, service_role 키 사용 + 앱 레벨 소유권 검증). 프런트엔드(`js/api-client.js`)가 Supabase 세션 토큰을 `Authorization: Bearer`로 붙여 호출

## 카테고리 데이터 시딩

`categories` 테이블은 `backend/scripts/seed_categories.py`로 채웁니다(재실행해도 중복 삽입되지 않는 idempotent 스크립트).

| 타입 | 데이터 출처 | 범위 |
|---|---|---|
| `JOB` | 원티드 Open API `/v1/tags/categories` 실호출 | 직군 20개 전량 + 하위 직무 전부 |
| `SKILL` | 원티드 Open API `/v1/tags/skills?keyword=...` (키워드 검색 반복 호출) | 대표 키워드 30개 기준 샘플 |
| `INDUSTRY` | 통계청 KSIC(한국표준산업분류) 공식 분류체계 | 대표 6개 섹션 샘플 (전체 아님) |
| `REGION` | 행정안전부 법정동코드 공식 자료 | 대표 6개 시도 샘플 (전체 아님) |

Wanted API에는 업종/지역 전체 목록을 주는 엔드포인트가 없어(특정 사업자등록번호 조회로만 point data 제공), INDUSTRY/REGION은 공식 공개 데이터에서 대표 샘플만 가져왔습니다. **운영 배포 전 INDUSTRY/REGION은 전체 KSIC/법정동코드로, SKILL은 더 넓은 키워드로 확장이 필요합니다.**

## 로컬 실행 방법

1. **환경 변수**: 루트 `.env.example`과 `backend/.env.example`을 각각 복사해 `.env`/`backend/.env`로 만들고, Supabase URL/anon key/service_role key와 원티드 API `client_id`/`client_secret`을 채웁니다.
2. **`js/config.js` 생성** (2026-07-14부터 git에 커밋하지 않음 — `.env`로부터 자동 생성): `python scripts/generate_config.py` 실행. (Vercel 등 Node 기반 빌드 환경에서는 대신 `node scripts/generate-config.mjs`를 빌드 커맨드로 사용)
3. **카테고리 시드** (최초 1회): `cd backend && python scripts/seed_categories.py`
4. **백엔드 실행**: `cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
5. **프런트엔드 실행**: 프로젝트 루트에서 `python -m http.server 5500` 후 `http://127.0.0.1:5500/index.html` 접속 (파일을 `file://`로 직접 열면 ES 모듈 CORS 문제로 동작하지 않습니다)

## 추가 기능 (예정)

### 채용 시장 분석 (P1 · v1.1)

같은 업종 내 최근 채용 트렌드를 분석하는 기능입니다. 백엔드 엔드포인트(`GET /company/market-analysis`)는 존재하지만 프런트엔드 화면은 아직 없습니다.

- 직무별 채용 수 추이 (월별 그래프)
- 평균 연봉 / 경험 연차 (집계 데이터)
- 경쟁사 채용 트렌드 (익명 상위 3사)

자세한 내용은 [`PRD.md`](./PRD.md) 7장을 참고하세요.

## 미확정 이슈

역할 전환 정책, 가중치 자동학습 포함 여부, 카테고리 depth 제한, 민감정보(연봉/지역) 비공개 옵션, 지원 파이프라인 단계(서류심사/면접 등) 스키마 등 아직 확정되지 않은 이슈가 있으며, 구현 시 임시값/임시 구조로 처리됩니다. 자세한 내용과 임시 처리 방안은 [`PRD.md`](./PRD.md) 8장을 참고하세요.

## 브랜치 작업 시작 전 체크리스트

`common`/`company`/`jobseeker` 각 브랜치에서 기능 구현을 시작하기 전에, 아래를 먼저 확인하세요.

1. 원티드(Wanted) API에서 실제로 가져오는 변수명·타입·구조가 `PRD.md`(3장 카테고리 체계, 4장 데이터 모델, 4.5장 JobPosting)에 적힌 것과 **동일한지** 다시 확인합니다. 실제 API 호스트는 `https://openapi.wanted.jobs`이며 인증에 `wanted-client-id`/`wanted-client-secret` 헤더가 모두 필요합니다(`openapi.json`의 `servers`에는 호스트가 명시되어 있지 않아 실제 호출로 검증한 값입니다).
2. 차이가 발견되면, 코드부터 구현하지 말고 **`PRD.md`/`DB.md`를 먼저 갱신**한 뒤 구현을 시작합니다.
3. `EMPLOYMENT_TYPE`(고용형태, flat 문자열), `average_salary`/`hired_salary`(공고가 아닌 기업 단위 집계), `position_category_id`+직무 상세(복수) 구조처럼 원티드 API에 맞춰 재설계된 부분은 실제 연동 시 어긋나기 쉬우니 우선적으로 재검증하세요.
4. `categories` 테이블의 INDUSTRY/REGION/SKILL은 아직 전체 데이터가 아니라 대표 샘플입니다("카테고리 데이터 시딩" 절 참고) — 해당 카테고리를 다루는 기능을 테스트할 때 데이터 범위가 좁다는 점을 감안하세요.

## 기술 스택

- **프런트엔드**: HTML/CSS/JavaScript 기반 단일 페이지 웹앱(SPA), Supabase JS 클라이언트로 인증/카테고리 조회 등을 직접 처리
- **기업 탭(Tab1) 백엔드**: Python FastAPI (`backend/`) — Supabase Postgres에 `supabase-py`(service_role)로 접근, 앱 레벨에서 소유권/권한 검증
- **데이터베이스/인증**: Supabase (Postgres, Auth, RLS)
- **외부 데이터**: 원티드(Wanted) Open API (`openapi.json`/`openapi (1).json`은 참고용 명세, 실제 연동은 `backend/scripts/seed_categories.py` 및 향후 공고 연동 로직에서 사용)
