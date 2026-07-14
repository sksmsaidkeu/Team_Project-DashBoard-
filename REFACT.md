# REFACT.md — 리팩토링 가이드

> 이 문서는 `common` 브랜치 전체 코드베이스에 대한 코드 리뷰에서 나온 **cleanup 항목**(중복 제거·단순화·효율화)을 정리한 것이다. 버그(정확성/보안) 항목은 별도 리뷰에서 이미 보고했으며, 여기서는 다루지 않는다. 각 항목은 우선순위 순으로 정렬했다 — P0가 가장 먼저 손대야 할 항목이다.

## 우선순위 요약

| 우선순위 | 기준 |
|---|---|
| P0 | 중복된 두 코드 경로 중 한쪽에만 버그가 있어 탭 간 결과가 실제로 달라지는 경우 (통합하면서 버그도 같이 고쳐야 함) |
| P1 | 순수 중복 로직 — 동작은 같지만 유지보수 시 한쪽만 고치면 동작이 갈릴 위험이 있는 경우 |
| P2 | 성능/효율 — 정답은 맞지만 불필요하게 느리거나 네트워크·연산을 낭비하는 경우 |
| P3 | 파이썬 스크립트(운영/시딩용) 중복 — 사용자 체감 영향은 없지만 스크립트 3개가 각각 관리되고 있음 |

---

## P0 — 중복 + 버그가 얽힌 항목 (최우선)

이전 코드 리뷰에서 발견된 실제 버그(연봉 마스킹 로직 오류, RLS 상태 백스탑 누락 등)가 아래 두 쌍의 중복 코드 중 **한쪽 경로에만** 존재한다. 단순 중복 제거가 아니라 "정답인 쪽으로 통합"하는 작업이 필요하다.

### P0-1. 기업→구직자 매칭 파이프라인 중복

- **위치**: `js/tab-company.js:12` (`renderCompanyHighlight`) vs `js/tab-main.js:183` (`fetchCompanyHighlightCandidates`)
- **문제**: 회사의 필요 스킬 조회 → `jobseeker_profiles` 하드 필터(직무/지역) → 스킬 매칭 → 카테고리 맵 구성 → 카드 렌더링까지 거의 한 줄 단위로 동일한 로직이 두 파일에 각각 구현되어 있다.
- **제안**: `fetchMatchingJobseekers(company, limit)` 형태로 하나의 함수를 (예: `js/categories.js` 또는 신규 `js/matching.js`에) 추출하고, 두 파일 모두 이를 import해서 사용한다. `limit` 파라미터로 기업 탭(전체 목록)과 메인 탭(하이라이트 N개)의 차이를 흡수한다.
- **영향 범위**: 매칭 규칙이 바뀔 때(예: PRD 5장 소프트 스코어링 도입) 한 곳만 수정하면 되도록 만드는 것이 목적.

### P0-2. 구직자→공고 매칭 파이프라인 중복

- **위치**: `js/tab-jobseeker.js:12` (`renderJobseekerHighlight`) vs `js/tab-main.js:129` (`fetchJobseekerHighlightMatches`)
- **문제**: 구직자 스킬 조회 → 직무 카테고리 depth 해석(`resolvePositionGroupId`) → `job_postings` 하드 필터(직무/지역/고용형태) → 카테고리 맵 구성까지 두 파일에 중복 구현되어 있다. `resolvePositionGroupId` 자체도 `js/tab-main.js:62`와 `js/tab-jobseeker.js:118`에 복붙되어 있다(P1-2와 연결).
- **제안**: `fetchMatchingPostings(jobseeker, limit)` 하나로 통합하고, `resolvePositionGroupId`는 `js/categories.js`로 옮겨 공용 헬퍼로 만든다.
- **영향 범위**: P0-1과 마찬가지로 매칭 규칙 변경 시 단일 지점 수정을 보장.

---

## P1 — 순수 중복 로직

### P1-1. `escapeHtml()` 중복 정의

- **위치**: `js/app.js:28` vs `js/tab-main.js:33`
- **문제**: 완전히 동일한 HTML 이스케이프 함수가 두 파일에 각각 정의되어 있다. (참고: `js/tab-company.js`, `js/tab-jobseeker.js`는 아예 이 함수를 갖고 있지 않아 카테고리 제목을 이스케이프 없이 렌더링하는 별도 버그가 있음 — 이전 리뷰 보고서 참고)
- **제안**: `js/utils.js`(신규)에 `escapeHtml`을 두고 `app.js`, `tab-main.js`, `tab-company.js`, `tab-jobseeker.js` 전체가 이 하나를 import해서 사용하도록 통일한다. 이 작업을 하면서 company/jobseeker 탭의 이스케이프 누락 버그도 자연히 해소된다.

### P1-2. `resolvePositionGroupId()` 중복

- P0-2에 포함. 별도 항목으로 분리하지 않음 — 매칭 파이프라인 통합 작업의 일부로 처리할 것.

### P1-3. 회원가입 함수 구조 중복

- **위치**: `js/signup.js:107` (`submitCompanySignup`) vs `js/signup.js:181` (`submitJobseekerSignup`)
- **문제**: "폼 필드 읽기 → 필수값 검증 → 버튼 비활성화 → `auth.signUp` → `users` insert → 프로필 insert → 스킬 join row insert → 성공/실패 처리"까지 필드명·테이블명만 다르고 구조가 완전히 동일한 ~70줄짜리 블록이 두 개 존재한다. (참고: 두 블록 모두에 중간 실패 시 롤백이 없는 동일한 버그가 있음 — 이전 리뷰 보고서 참고)
- **제안**: `submitSignup({ userType, formId, statusId, fields, buildProfileRow, skillTable, skillFkColumn, onSuccess })` 형태로 파라미터화한 단일 함수를 만들고, 회사/구직자 각각의 설정 객체로 두 번 호출한다. 이 작업과 함께 트랜잭션/롤백 로직도 한 곳에만 추가하면 됨.

### P1-4. 랭킹 막대바 렌더링 중복

- **위치**: `js/tab-main.js:649` (`renderWantedTrend`) vs `js/tab-main.js:587` (`renderMainTrend`)
- **문제**: "카운트로 순위 매기기 → 최댓값 계산 → `.rank-bar` HTML 렌더링" 로직이 조회하는 테이블/컬럼과 빈 상태 문구만 다르고 나머지는 동일하게 중복 구현되어 있다.
- **제안**: `renderRankBars(container, rankedItems, { titleOf, countOf, emptyMessage })` 공유 헬퍼로 추출하고, 두 함수는 각자 데이터를 조회·정렬만 한 뒤 이 헬퍼를 호출하도록 단순화한다.

### P1-5. role → tab 매핑 중복 (+ fallback 불일치)

- **위치**: `js/app.js:114` (로그인 흐름) vs `js/app.js:142` (회원가입 흐름)
- **문제**: `role === 'COMPANY' ? 'company' : role === 'JOBSEEKER' ? 'jobseeker' : 'main'` 형태의 인라인 삼항연산자가 두 곳에 중복되어 있는데, 회원가입 쪽(142행)은 `'main'` fallback 분기가 아예 빠져 있어 두 곳의 동작이 미묘하게 다르다.
- **제안**: `tabForRole(role, fallback = 'main')` 헬퍼 하나로 통일한다. 이렇게 하면 fallback 누락이 의도인지 실수인지 코드만 봐서는 알 수 없는 문제도 해결된다.

### P1-6. 파이썬 스크립트 공통 로직 중복

- **위치**: `scripts/fetch_wanted_trend.py:69`, `scripts/generate_config.py`, `scripts/seed_categories.py`
- **문제**: `find_repo_root()`, `load_env()`가 세 스크립트에 바이트 단위로 동일하게 복사되어 있고, `supabase_upsert()`/`is_placeholder()`는 `fetch_wanted_trend.py`와 `seed_categories.py` 두 곳에 중복되어 있다.
- **제안**: `scripts/_common.py` 신규 생성 후 위 4개 함수를 옮기고 세 스크립트 모두 이를 import하도록 변경한다. `.env` 파싱 규칙이 바뀔 때 3곳을 동시에 고쳐야 하는 위험을 없앤다.

---

## P2 — 효율성 개선

### P2-1. 시작 시 `renderMainHighlight` 중복 호출

- **위치**: `js/app.js:149`
- **문제**: `supabase.auth.onAuthStateChange`는 구독 시점에 초기 세션으로 즉시 한 번 발화하는데, 이 콜백의 `refreshActiveTabContent()`와 앱 시작 IIFE의 `setActiveTab('main')`이 둘 다 `renderMainHighlight`를 트리거해서 페이지 로드마다 동일한 Supabase 조회가 두 번 실행된다.
- **제안**: `onAuthStateChange`의 최초 합성 이벤트는 무시하거나(예: 첫 콜백만 skip), IIFE 쪽에서 인증 관련 렌더링은 콜백에 맡기고 탭 전환만 담당하도록 역할을 분리한다.

### P2-2. 탭 전환 시 DOM 재조회 + 무조건 refetch

- **위치**: `js/app.js:48` (`setActiveTab`)
- **문제**: 탭을 클릭할 때마다 관련 DOM 엘리먼트를 매번 `getElementById`로 다시 조회하고, 데이터도 캐시 없이 무조건 다시 fetch한다. main → company → main → company처럼 짧은 시간에 반복 클릭하면 DOM 조회와 네트워크 요청이 그만큼 반복된다.
- **제안**: 엘리먼트 참조는 모듈 스코프에서 한 번만 캐싱하고, 데이터는 짧은 TTL(예: 수 초)로 메모이즈해서 연타 클릭 시 불필요한 재요청을 막는다.

### P2-3~4. 병렬화 가능한데 순차 실행 중인 쿼리

- **위치**: `js/tab-company.js:38` (`renderCompanyHighlight`), `js/tab-jobseeker.js:38` (`renderJobseekerHighlight`)
- **문제**: 서로 의존관계 없는 쿼리(예: 스킬 조회와 후보자 조회, 또는 스킬 조회와 카테고리 depth 조회)를 순차적으로 `await`하고 있어 왕복 지연이 그대로 더해진다.
- **제안**: 의존관계가 없는 호출은 `Promise.all([...])`로 묶어 병렬 실행한다. (P0-1/P0-2 통합 작업 시 같이 정리하면 효율적)

### P2-5. 불필요하게 넓은 `select('*')`

- **위치**: `js/auth.js:38` (`getCurrentUserProfile`)
- **문제**: 프로필 조회 시 `select('*')`로 전체 컬럼을 가져오는데 실제 사용하는 건 5~8개 필드뿐이다. 이 함수는 로그인·페이지 로드·auth 상태 변경마다 호출되는 경로라 낭비가 누적된다.
- **제안**: 실제로 쓰는 컬럼만 명시적으로 `select()`에 나열한다.

### P2-6. 캐싱 없는 O(n²) 조합 계산

- **위치**: `js/tab-main.js:759` (`renderSkillCombo`)
- **문제**: 탭을 활성화할 때마다 최대 2000행을 새로 가져와서 스킬 조합 페어를 O(n²)로 계산한다. 데이터가 자주 바뀌지 않는데도 캐싱이 없어 탭을 왔다갔다 할 때마다 동일한 계산을 반복한다.
- **제안**: `IntersectionObserver`로 화면에 실제로 보일 때까지 지연 로드하거나, 세션 동안 마지막 결과를 캐싱해서 재계산을 생략한다.

---

## 작업 순서 제안

1. **P0-1, P0-2** 먼저 — 버그 수정과 중복 제거가 동시에 되는 항목이라 ROI가 가장 크다.
2. **P1-1 (escapeHtml)** — P0 작업 중 자연스럽게 같이 처리 가능 (매칭 파이프라인 통합 시 렌더링 헬퍼도 함께 정리).
3. **P1-3 (회원가입 통합)** — 트랜잭션/롤백 로직 추가와 묶어서 한 번에 처리.
4. 나머지 P1 항목(P1-4, P1-5)과 P2, P3는 별도 스프린트에서 여유 있을 때 처리해도 무방.

---

## 진행 상태 (common 팀 처리분)

- **완료** (common 소유 파일: `js/app.js`, `js/utils.js`(신규), `js/tab-main.js`, `js/categories.js`, `js/matching.js`(신규), `js/signup.js`, `js/auth.js`, `scripts/_common.py`(신규)):
  - P0-1/P0-2 매칭 파이프라인: `js/matching.js`에 `fetchMatchingJobseekers`/`fetchMatchingPostings` 추출, `resolvePositionGroupId`는 `js/categories.js`로 이전. `js/tab-main.js`가 이 공용 함수를 사용하도록 전환.
  - P1-1 `escapeHtml` 통합 → `js/utils.js` 신규, `app.js`/`tab-main.js`가 import해서 사용.
  - P1-3 회원가입 함수 통합 → `js/signup.js`의 `submitSignup({...})` 단일 함수 + 롤백 로직 추가.
  - P1-4 랭킹 막대바 렌더링 → `js/tab-main.js`의 `renderRankBars()` 공유 헬퍼로 통합.
  - P1-5 role→tab 매핑 → `js/utils.js`의 `tabForRole(role, fallback='main')`으로 통합, 로그인/회원가입 양쪽 다 동일한 fallback 적용.
  - P1-6 파이썬 공통 로직 → `scripts/_common.py` 신규, 3개 스크립트가 import.
  - P2-1 시작 시 중복 렌더 → `onAuthStateChange` 최초 합성 이벤트 skip.
  - P2-2 DOM 재조회 → `js/app.js` 모듈 스코프에 엘리먼트 참조 캐싱.
  - P2-5 `select('*')` 축소 → `js/auth.js`에서 실사용 컬럼만 명시.
  - P2-6 스킬 조합 O(n²) 캐싱 → `js/tab-main.js`에 세션 캐시 추가.

- **미완료 — company/jobseeker 브랜치 담당자의 후속 작업 필요** (해당 파일은 팀원 소유라 common 팀이 직접 수정하지 않음):
  - `js/tab-company.js`(`renderCompanyHighlight`)와 `js/tab-jobseeker.js`(`renderJobseekerHighlight`)는 아직 `js/matching.js`를 import하지 않고 자체 중복 쿼리 로직을 그대로 쓰고 있음. **P0가 최우선인 이유(중복 경로 중 한쪽에만 버그)가 여전히 남아있는 상태** — 두 파일을 `fetchMatchingJobseekers`/`fetchMatchingPostings` 호출로 교체하고 각 파일에 있던 버그(연봉 마스킹, RLS 백스탑 등)를 확인해 정답 경로로 합치는 작업이 필요.
  - `js/tab-jobseeker.js`의 자체 `resolvePositionGroupId()`도 `js/categories.js`의 공용 버전으로 교체 필요.
  - P1-1(escapeHtml)도 두 파일이 아직 `js/utils.js`를 import하지 않아 카테고리 제목 이스케이프 누락 버그가 남아있음.
  - P2-3/4(병렬 쿼리)도 두 파일 내부 로직이라 미착수.
  - 공용 함수 시그니처는 README.md의 "공용 매칭 헬퍼" 절 참고.