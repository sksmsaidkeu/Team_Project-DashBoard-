# 채용 플랫폼 PRD

## 1. 개요
카테고리 기반 매칭을 핵심으로 하는 채용 플랫폼. 기업과 구직자가 자유 텍스트가 아닌 사전 정의된 카테고리 체계를 통해 정보를 등록하고, 이를 기반으로 추천/매칭이 이루어진다.

## 2. 회원 유형 및 가입 플로우

- 회원가입 시 `user_type`(`COMPANY` / `JOBSEEKER`)을 필수로 선택한다.
- 유형에 따라 가입 폼, 필수 입력값, 온보딩 플로우가 완전히 분기된다.
- 역할 전환은 불가하며, 계정당 1개 역할만 가진다.
- 가입 폼의 업종/직무/스킬/지역/고용형태 입력값은 자유 텍스트 입력을 받지 않고, 3장 Category 체계에서 제공하는 선택지(드롭다운/자동완성)에서만 고를 수 있다.
- **이메일 인증을 요구하지 않는다.** 가입 시 별도의 인증 메일 발송·링크 클릭 절차 없이, 가입 완료 즉시 계정이 활성화된다.

## 3. 카테고리 체계

모든 데이터(업종, 직무, 스킬, 지역)는 자유 텍스트가 아닌 사전 정의된 **Category ID** 기반으로 저장·검색·매칭된다. 원티드(Wanted) API를 통해 실제 공고/기업 데이터를 가져올 예정이므로, 카테고리 타입·컬럼명·값은 자유롭게 재설계하지 않고 **원티드 공개 API(`openapi.json`/`openapi (1).json`)의 변수명과 최대한 동일하게 맞춘다.** API에 대응 변수가 없는 경우에만 기존(=API에서 온) 변수를 조합해 새 값을 만든다.

| 타입 | 설명 | 분류 기준 | 계층 구조 |
|---|---|---|---|
| `INDUSTRY` | 업종 | 한국표준산업분류(KSIC) | 계층형 — 대분류/중분류/소분류 3단계만 채택(세분류·세세분류는 미사용, depth 3 제한과 정합) |
| `JOB` | 직무 | 직군(대) → 직무(소) 2단 태그 (원티드 `/tags/categories`, ATS `position_category_id`/`position_category_detail_ids` 구조 참고) | 계층형 (depth 2) |
| `SKILL` | 스킬 | 평면 태그 목록 (원티드 `/tags/skills` 참고) | 단일 레벨 (`parent_id`는 항상 NULL) |
| `REGION` | 지역 | 법정동코드 기준 — 시도 → 시군구 → 읍면동 | 계층형 (depth 3) |

> **`EMPLOYMENT_TYPE`(고용형태)는 더 이상 Category 타입이 아니다.** 원티드 API에서 고용형태(`employment_type`, `ATSEmploymentTypeEnum`: `regular`/`contract`/`intern`)는 계층형 태그가 아니라 각 엔터티에 직접 붙는 평면 문자열이므로, 우리 스키마도 이를 그대로 따라 `categories` 테이블이 아닌 각 프로필/공고 테이블에 `employment_type` 컬럼(문자열, `regular`/`contract`/`intern`)으로 직접 둔다 (4장 참고).
>
> 카테고리 컬럼명도 원티드 응답 필드명과 통일한다: 카테고리명은 `name`이 아닌 **`title`**(원티드 `TagResponseSerializer.title`), 원티드 원본 태그 ID는 **`tag_id`**(정수, JOB/SKILL에서 사용), 업종 코드는 **`ksic_code`**/**`industry_code`**(INDUSTRY 전용, `/insight/company` 응답 필드명 그대로), 지역 코드는 **`location_code`**(REGION 전용, 동일 응답 필드명)로 각각 저장한다. 하나의 `categories` 테이블에 이 4개 컬럼을 모두 두되, 해당 타입이 아니면 NULL로 비워둔다.
>
> 원티드 API에는 이 외에 "매력태그(attraction tags)" 카테고리가 존재하지만, 본 프로젝트 범위에서는 채택하지 않는다(필요 시 추후 별도 Category 타입으로 추가 검토).
>
> **API 시드 가능 범위 재검증 (실제 호출로 확인, `scripts/seed_categories.py`)**: `JOB`은 `GET /tags/categories`(파라미터 없이 전체 목록 반환, 직군 20건/직무 418건 확인)로 전체 시드가 가능하다. 단, 응답의 태그 ID 필드명은 `tag_id`가 아니라 **`id`**이다(`TagResponseSerializer`/`ParentTagResponseSerializer` 실제 스키마 기준) — 우리 `categories.tag_id` 컬럼은 이 `id` 값을 그대로 보존하는 우리 쪽 명명일 뿐, 원티드 응답 필드명 자체가 `tag_id`인 것은 아니다. 반면 `SKILL`(`GET /tags/skills`)은 `keyword` 파라미터가 필수라 "전체 스킬 목록"을 한 번에 받아올 방법이 없고, `INDUSTRY`(`GET /insight/company`)는 `biz_number`(특정 회사) 필수 파라미터라 "전체 업종(KSIC) 목록" 조회 용도가 아니다. 따라서 `SKILL`/`INDUSTRY`는 원티드 API만으로 전체 시드가 불가능하며, 대안으로 `SKILL`은 자주 쓰이는 키워드 목록으로 `/tags/skills?keyword=`를 반복 호출해 합치거나 초기에는 수동 큐레이션 목록으로 시작하고, `INDUSTRY`는 KSIC 공개 데이터(통계청 등)를 별도 정적 시드로 사용한다.

## 4. 데이터 모델

아래 변수명은 원티드 API 필드명과 통일한 이름이다(3장 참고). API에 대응 변수가 없는 항목은 API에서 온 변수를 조합해 산출하며, 그 방식을 각 항목에 함께 표기한다.

### 4.1 CompanyProfile (기업)
- 업종 (`industry_category_id` → INDUSTRY 카테고리, KSIC 기준)
- 기업 규모 (`company_size` — API 대응 없음, 자체 입력값)
- 위치 (`region_category_id` → REGION 카테고리)
- 직무 (`position_category_id` → JOB 카테고리, 원티드 `position_category_id` 동일)
- 고용형태 (`employment_type` — 원티드 `ATSEmploymentTypeEnum`과 동일한 평면 문자열, Category 아님)
- 필요 스킬 (SKILL 카테고리, 다중)
- 평균연봉/신규입사자 평균연봉 (`average_salary`/`hired_salary` — 원티드 `/insight/company` 응답 필드명과 동일, 범위(min/max)가 아닌 원티드와 동일한 point-value 2종으로 저장)

### 4.2 JobSeekerProfile (구직자)
- 희망 직무 (`desired_position_category_id` → JOB 카테고리)
- 경력 연차 (`career_years` — 원티드 API에 구직자 개념 자체가 없어 대응 변수 없음, 자체 입력값)
- 거주 지역 (`region_category_id` → REGION 카테고리)
- 보유 스킬 (SKILL 카테고리, 다중)
- 희망 연봉 (`desired_salary` — 원티드 API에 구직자 개념 자체가 없어 대응 변수 없음, 자체 입력값)
- 희망 근무형태 (`desired_employment_type` — CompanyProfile과 동일한 `employment_type` 값 집합 재사용)

### 4.3 UserPreference
- 선호 카테고리 + 가중치 (API 대응 없음, 자체 추천 로직 전용 데이터)

### 4.4 InteractionLog
- 조회 / 저장 / 지원 로그 (API 대응 없음 — 원티드 API는 페이지 조회/저장 로그를 제공하지 않으므로 자체 수집)
- 채용공고 게시/마감 이벤트는 `job_postings.status`(원티드 `JobStatusEnum` 문자열 `draft`/`active`/`close`와 동일한 값 사용, 7장 참고)의 전이를 그대로 기록한다.

### 4.5 JobPosting (채용공고)

PRD 4장에 명시적으로 없었으나 6장 IA(공고 관리/공고 열람)와 7.1절 채용 시장 분석을 지원하기 위해 정의한다. 필드명은 원티드 ATS 공고 생성 스키마(`ATSPositionCreateSerializer`)와 동일하게 맞춘다.

- `position_category_id` (직군, JOB 카테고리) / 직무 상세(복수 가능, 원티드 `position_category_detail_ids`와 동일 개념)
- `employment_type` — CompanyProfile과 동일한 평면 문자열
- `annual_from`/`annual_to` — 최소/최대 경력(신입 = 0), 원티드 필드명 그대로
- `status` — `draft`/`active`/`close` (원티드 `JobStatusEnum`의 부분집합, 그 외 값(`request`/`archived`/`saved`/`start_wait`)은 이번 범위에서 사용하지 않음)
- 급여 필드는 두지 않는다 — 원티드 공고 생성 스키마 자체에 급여 필드가 없으므로, 급여가 필요한 곳(7.1 시장분석)은 `CompanyProfile.average_salary`/`hired_salary`를 조인해서 쓴다(4.1절, 7.1절).

## 5. 추천/매칭 로직

`UserPreference`(선호 카테고리+가중치)와 `InteractionLog`(조회/저장/지원 로그)를 입력으로 다음 3단계를 거친다.

1. **하드 필터**: 필수 조건 불일치 항목 제외
2. **소프트 스코어링**:
   | 항목 | 가중치 |
   |---|---|
   | 스킬 | 40% |
   | 직무 | 25% |
   | 지역·연봉 | 15% |
   | 활동성 | 10% |
   | 최신성 | 10% |
3. **정렬**: 점수순 정렬 후 상위 노출

## 6. 화면 구조 (IA)

- **메인** (2026-07-14 기준 실제 구현 순서): 통합 검색(히어로) → 역할 선택 CTA(기업/구직자 가입 진입) → 채용 트렌드(우리 플랫폼 job_postings 기준) → 실시간 채용 시장 동향(원티드 API 기준, 7.2절) → 스킬 수요 랭킹 & 조합 분석 → 추천 하이라이트 → 최근 공고/최근 인재 → 채용 뉴스
- **Tab1 (기업용)**: 인재 검색, 공고 관리, 지원자 관리
- **Tab2 (구직자용)**: 공고 열람, 기업 정보, 지원 현황

추천/매칭 기능은 위 카테고리 체계 및 스코어링 로직을 화면과 무관하게 공통으로 사용한다.

메인의 "채용 뉴스"는 채용 시장/업계 관련 뉴스를 큐레이션해 노출하는 영역으로, 기업·구직자 어느 쪽에도 치우치지 않는 공통(메인) 화면에만 노출한다. Tab1/Tab2에는 노출하지 않는다. 뉴스의 실제 수집 방식(외부 API 연동/RSS/자체 등록)은 8장 미확정 이슈 참고.

### 6.1 구현 전략 (브랜치 구조)

GitHub 브랜치는 `common`(공통)/`company`(기업)/`jobseeker`(구직자) 3개로 나뉘며, 각 브랜치는 대응하는 화면(메인/Tab1/Tab2)의 기능을 독립적으로 완성한 뒤 PR을 통해 `main`으로 merge한다. 최종 산출물은 3개의 분리된 사이트가 아니라, **하나의 웹사이트 안에서 상단 탭 전환(스위칭)으로 메인·Tab1·Tab2를 오가는 단일 SPA 구조**다. 즉 공통 셸(상단 내비게이션, 인증 상태, 카테고리·매칭 등 공통 로직)은 세 화면이 공유하고, 각 브랜치는 그 위에 자신의 탭 콘텐츠만 구현한다.

## 7. 추가 기능 (Feature Backlog)

### 7.1 채용 시장 분석 (P1 · v1.1)

**기능 설명**: 같은 업종 내 최근 채용 트렌드 분석

- 직무별 채용 수 추이 (월별 그래프)
- 평균 연봉 / 경험 연차 (집계 데이터)
- 경쟁사 채용 트렌드 (익명 상위 3사)

**필요 데이터** (원티드 필드명과 동일한 변수만 사용, 새 변수는 만들지 않고 기존 변수를 조합)

- `InteractionLog` — 채용공고 게시/마감 이벤트는 `job_postings.status`(`draft`/`active`/`close`) 전이 기록으로 대체(4.4절)
- `Category` — 업종(`industry_category_id`), 직무(`position_category_id`)
- 연봉 집계 — 공고 자체에는 급여 필드가 없으므로(원티드 API에 공고별 급여 필드 없음), 새 변수를 만드는 대신 `CompanyProfile.average_salary`/`hired_salary`(원티드 `/insight/company` 필드 그대로)를 `job_postings.position_category_id`/`industry_category_id`와 조인해 직무·업종 단위로 집계한다
- 경력 연차 집계 — `job_postings.annual_from`/`annual_to`(원티드 필드명 그대로)를 직무·업종 단위로 평균 집계

### 7.2 실시간 원티드 채용 동향 (신규)

**7.1절 "채용 트렌드"(우리 자체 `job_postings` 테이블 기준, 아직 실제 등록 공고가 거의 없어 데이터가 희소함)와는 다른 지표**다. 이번에 메인 홈페이지에 원티드(Wanted) API 실 라이브 데이터를 반영한 시각화 섹션을 추가하기 위해, 원티드 `GET /jobs`를 직접 호출해 얻은 실제 공고를 직군(`category_tags.parent_tag`)별로 집계한 스냅샷을 별도로 둔다(`wanted_job_trend_snapshot` 테이블, DB.md 3.10절).

- 수집: `scripts/fetch_wanted_trend.py`가 `GET /jobs`(`limit=100` 페이지네이션, 최대 500~1000건)로 실 라이브 공고를 모아 `status='active'`만 남기고 직군별 건수를 집계한다.
- `GET /jobs`는 openapi.json에 "v2 api 사용을 권장합니다"로 deprecated 표시돼 있으나, 이 저장소엔 v2 스펙이 없으므로 이번 구현은 v1 `/jobs`를 그대로 사용한다. 추후 v2 스펙이 확보되면 마이그레이션을 검토한다.
- 두 지표(7.1 자체 트렌드 vs 7.2 원티드 채용 동향)는 데이터 출처와 테이블이 완전히 분리되어 있으므로 화면 상에서도 "우리 플랫폼 채용 트렌드"와 "원티드 실시간 채용 동향"으로 명확히 구분해 노출한다.

## 8. 미확정 이슈 (구현 시 임시값 처리 필요)

| 이슈 | 임시 처리 방안(제안) |
|---|---|
| 역할 전환 정책 | 전환 불가로 고정, 추후 정책 확정 시 반영 |
| 가중치 자동학습 포함 여부 | 미포함, 고정 가중치(4장 표)로 시작 |
| 카테고리 depth 제한 | 3단계로 확정. INDUSTRY는 KSIC 대/중/소분류까지만 채택(세분류·세세분류 미사용), REGION은 시도/시군구/읍면동 3단계 사용 |
| 민감정보(연봉/지역) 비공개 옵션 | 기본값 공개, 비공개 토글은 추후 추가 |
| 채용 뉴스 수집 방식 (6장) | `js/news.js`의 `fetchJobNews()`가 무료 뉴스 API(GNews.io) 호출을 시도하되, 키 없음/CORS 차단/네트워크 오류 등 실패 시 정적 폴백 뉴스로 자동 대체(graceful degradation)하는 것으로 확정. 아래 상세 참고 |

> 위 항목은 확정 전까지 임시값으로 구현하며, 정책 확정 시 이 문서를 업데이트한다. `EMPLOYMENT_TYPE`/`SKILL`의 계층 여부와 `REGION`의 분류 기준은 3장에서 openapi 비교를 통해 확정했으므로 더 이상 미확정 이슈가 아니다.

### 8.1 채용 뉴스 API 연동 제약 (실측, 2026-07)

이 프로젝트는 빌드 도구도 없고 배포된 백엔드 서버도 없는 정적 SPA다(`scripts/*.py`는 로컬 1회성 실행 스크립트이며 상시 구동되는 프록시 서버가 아니다). 따라서 뉴스 API를 쓰려면 브라우저에서 직접 fetch해야 하는데, 실제로 후보 API의 공식 문서/약관과 HTTP 응답을 확인한 결과 다음과 같은 제약이 있다.

- **NewsAPI.org (무료 "Developer" 플랜)**: pricing FAQ에 "Requests from the browser are not allowed on the Developer plan, except from localhost."라고 명시되어 있다. 즉 브라우저 직접 호출이 `localhost`로만 허용되고, 실제 배포된 프로덕션 도메인에서는 차단된다(업그레이드 시 Business 플랜 등 유료 전환 필요).
- **GNews.io (무료 플랜)**: pricing 페이지에 "CORS enabled for localhost"라고 명시되어 있고, 무료 플랜은 약관상 상업적 프로젝트 이용이 금지되어 있다(비상업/개발·테스트 전용). Python으로 실제 요청을 보내 확인한 결과 `Access-Control-Allow-Origin: *` 헤더 자체는 내려오지만(기술적으로는 브라우저 fetch가 통과할 수 있음), 문서상 정책(비상업 용도 한정)을 근거로 프로덕션에 그대로 사용하는 것은 안전하지 않다고 판단했다.

결론적으로 두 후보 모두 "브라우저에서 안전하게 직접 호출 가능한 무료 API"의 조건(CORS 허용 + 무료 티어 약관상 프로덕션/상업적 사용 허용)을 충족하지 못한다. 이에 따라 `js/news.js`의 `fetchJobNews(fallbackItems)`는 API 호출을 시도만 하고, 실패 시 예외 없이 `fallbackItems`(예: `js/tab-main.js`의 `JOB_NEWS_ITEMS`)로 자동 대체하도록 설계했다. `NEWS_API_KEY`가 `.env`에 비어 있어도 폴백이 정상 동작한다.

**실제 서비스로 배포할 때의 대안**: Supabase Edge Function 등 서버리스 프록시를 하나 두고, 브라우저는 그 프록시만 호출하도록 바꾼다. 프록시가 서버 사이드에서 뉴스 API 키를 안전하게 보관한 채 실제 뉴스 API를 호출하면, CORS 제약과 키 노출 문제를 동시에 해결할 수 있다.
