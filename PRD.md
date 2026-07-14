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

> **Tab1 인재 검색 하드 필터 확정 사항**: 직무/지역/스킬 조건을 비워두면 로그인한 기업의 자사 등록값으로
> 대체하지 않고 해당 조건 자체를 적용하지 않는다 — 아무 조건도 지정하지 않으면 공개 설정(`is_region_public`/
> `is_salary_public`)된 전체 인재가 반환된다. 이전에는 미지정 시 자사 등록값을 기본값으로 대체했으나,
> 사용자 테스트 피드백을 반영해 이 정책으로 확정했다.

## 6. 화면 구조 (IA)

- **시작** (로그인 이전 랜딩): 서비스 소개 히어로, 핵심 기능 소개, 회원 유형(기업/구직자)별 안내. 로그인 여부와 무관하게 항상 접근 가능한 진입 화면이다.
- **메인** (로그인 이후 전용): 로그인한 계정 전용 대시보드 자리. 사용자 테스트 피드백에 따라 "시작"에서 분리했으며, 현재는 준비 중 안내만 표시하는 자리만 마련된 상태다(실제 대시보드 콘텐츠는 `common` 브랜치 병합 이후 별도 범위).
- **Tab1 (기업용)**: 상단에 "조건에 맞는 인재" 수 + "비슷한 직종 기업들의 인기 스킬"(같은 직무로 등록된 다른 기업들의 필요 스킬 집계) + "비슷한 직종 기업들의 채용 동향"(같은 직무 기업들의 게시중인 공고 집계) 하이라이트 카드를 보여준 뒤, 인재 검색 · 공고 관리(공고별 지원자 수 표시 포함) · 지원자 관리 서브탭으로 구성된다.
- **Tab2 (구직자용)**: 공고 열람, 기업 정보, 지원 현황

추천/매칭 기능은 위 카테고리 체계 및 스코어링 로직을 화면과 무관하게 공통으로 사용한다.

> "채용 뉴스" 영역은 아직 구현하지 않았다(8장 미확정 이슈 — 수집 방식 미정으로 이번 범위에서 보류). 향후 추가할 경우 기업·구직자 어느 쪽에도 치우치지 않는 "시작" 화면에만 노출하고 Tab1/Tab2에는 노출하지 않는다.

### 6.1 구현 전략 (브랜치 구조)

GitHub 브랜치는 `common`(공통)/`company`(기업)/`jobseeker`(구직자) 3개로 나뉘며, 각 브랜치는 대응하는 화면(시작·메인/Tab1/Tab2)의 기능을 독립적으로 완성한 뒤 PR을 통해 `main`으로 merge한다. 최종 산출물은 3개의 분리된 사이트가 아니라, **하나의 웹사이트 안에서 상단 탭 전환(스위칭)으로 시작·메인·Tab1·Tab2를 오가는 단일 SPA 구조**다. 즉 공통 셸(상단 내비게이션, 인증 상태, 카테고리·매칭 등 공통 로직)은 네 화면이 공유하고, 각 브랜치는 그 위에 자신의 탭 콘텐츠만 구현한다.

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

## 8. 미확정 이슈 (구현 시 임시값 처리 필요)

| 이슈 | 임시 처리 방안(제안) |
|---|---|
| 역할 전환 정책 | 전환 불가로 고정, 추후 정책 확정 시 반영 |
| 가중치 자동학습 포함 여부 | 미포함, 고정 가중치(4장 표)로 시작 |
| 카테고리 depth 제한 | 3단계로 확정. INDUSTRY는 KSIC 대/중/소분류까지만 채택(세분류·세세분류 미사용), REGION은 시도/시군구/읍면동 3단계 사용 |
| 민감정보(연봉/지역) 비공개 옵션 | 기본값 공개, 비공개 토글은 추후 추가 |
| 채용 뉴스 수집 방식 (6장) | 임시로 운영자가 직접 등록(수동 큐레이션)하는 것으로 가정, 외부 뉴스 API/RSS 연동 여부는 추후 확정 |

> 위 항목은 확정 전까지 임시값으로 구현하며, 정책 확정 시 이 문서를 업데이트한다. `EMPLOYMENT_TYPE`/`SKILL`의 계층 여부와 `REGION`의 분류 기준은 3장에서 openapi 비교를 통해 확정했으므로 더 이상 미확정 이슈가 아니다.
