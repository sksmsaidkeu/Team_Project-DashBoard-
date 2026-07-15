# MERGE.md — `company` ↔ `common` 브랜치 충돌 참고 문서

> **이 문서는 지금 실행 대기 중인 작업이 아니라 참고용입니다.** 2026-07-15 팀 결정에 따라 이번 병합은 `company` → `main` 직접 PR로 진행하며(README.md "다음 세션 체크리스트" 참고), `common`은 이번 PR에 관여하지 않습니다. `git merge-tree --write-tree --name-only company origin/main`으로 시뮬레이션한 결과 `company` → `main`은 **충돌 0건**입니다 — `main`에는 `.github/` 템플릿 커밋들만 있고 이미 `company`의 조상이기 때문입니다.
>
> 이 문서는 대신, 나중에 `common`(로컬 `Team_Project_common` 폴더 기준)을 `company`/`main`과 다시 맞출 필요가 생겼을 때(예: `jobseeker` 브랜치가 `common`을 기준으로 계속 작업하다가 결과물을 올릴 때) 참고할 **`company` ↔ `common` 병합 시뮬레이션 결과**입니다. **실제 작업 디렉터리는 건드리지 않고** `git merge-tree`로 안전하게 시뮬레이션했으며, 기준은 `company` HEAD `63f66c5`와 `common` 로컬 HEAD `1f4eaae`(origin/common보다 3개 커밋 앞섬: 리팩터 `a0f7304`, New.html 리디자인 `ad6433b`, company 병합 대비 준비 `1f4eaae`)입니다.
>
> 총 **7개 파일**에서 충돌이 납니다. `company`의 `6095a3b` 커밋이 이미 `common`의 이 최신 리팩터·리디자인 내용을 통째로 흡수한 상태라(예: `js/tab-main.js`는 두 브랜치가 완전히 동일 — 더 이상 충돌 없음), 대부분의 충돌은 **`company`가 그 위에 얹은 자기 작업(시작 탭, 기업 서브탭 등)과의 구조적 차이**일 뿐이라 기계적으로 풀립니다. 예외는 `.gitignore`와 `README.md` 2개뿐입니다.

## 요약

| 파일 | 해결 방법 |
|---|---|
| `PRD.md` | ✅ `company` 전체 채택 |
| `css/app.css` | ✅ `company` 전체 채택 |
| `index.html` | ✅ `company` 전체 채택 |
| `js/app.js` | ✅ `company` 전체 채택 |
| `js/categories.js` | ✅ `company` 전체 채택 (주석 한 줄 차이뿐) |
| `.gitignore` | ⚠️ `company` 채택 + `/.claude/` 규칙 수동 복원 필요 |
| `README.md` | ⚠️ 손으로 병합 (아래 병합 텍스트 그대로 사용 가능) |

---

## ✅ 기계적으로 풀리는 충돌 — `company` 전체 채택

### `PRD.md`, `index.html`, `js/app.js`, `css/app.css`, `js/categories.js`

`company`가 `common`의 최신 메인탭 구현(히어로 검색/역할선택 CTA/채용 트렌드/스킬 랭킹/채용 뉴스)을 이미 흡수했고, 그 위에 "시작" 탭(비로그인 랜딩)과 기업 서브탭(`initCompanySubtabs`)을 얹은 상태입니다. `common`은 그 이후 해당 파일들을 더 건드리지 않았으므로, 충돌 블록은 전부 "`company`가 `common` 위에 추가로 쌓은 내용"입니다 — 판단 없이 `company` 쪽을 그대로 채택하면 됩니다.

- `js/categories.js`는 함수 설명 주석 한 줄이 다른 것뿐이라 어느 쪽을 골라도 기능상 무방합니다(회사 쪽 문구가 최신 상황을 반영하므로 `company` 채택 권장).

---

## ⚠️ 손으로 병합해야 하는 충돌

### `.gitignore`

`company` 쪽에는 `common`이 추가한 아래 블록이 없습니다. `company`를 그대로 채택하면 이 규칙이 **조용히 사라집니다** — public 저장소에 로컬 Claude Code 설정이 실수로 커밋될 위험이 있으니 반드시 되살리세요.

```gitignore
# Personal local Claude Code agent team config (not shared with team)
/.claude/
```

나머지 항목(`__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `backend/scripts/data/` 등)은 이미 양쪽에 동일하게 있어 `company` 채택만으로 충분합니다.

### `README.md`

충돌 2곳 모두 "한쪽만 채택"하면 정보가 유실됩니다. 아래 병합된 텍스트를 그대로 사용하세요.

**충돌 1 — "화면 구조 (IA) 및 구현 현황" 섹션**: `company`의 구현 현황 목록은 유지하되, `common`이 추가한 "공용 매칭 헬퍼" 섹션(코드는 `js/matching.js`로 양쪽에 이미 다 있고, 문서화만 `common` 쪽에만 있는 상태로 확인됨)을 그 아래에 이어붙입니다.

```markdown
## 화면 구조 (IA) 및 구현 현황

- **메인**: 통합 검색, 채용 트렌드/스킬 수요 랭킹, 추천 하이라이트, 최근 공고/인재, 채용 뉴스 — **구현 완료**(2026-07-14, `common` 브랜치에서 이식). 회원가입 유도를 위해 **로그인 회원 전용**이며, 비로그인 방문자는 "시작" 탭에서 미리보기 홍보만 보고 "메인" 탭 진입 시엔 가입 유도 화면만 표시됩니다.
- **Tab1 (기업용)**: 인재 검색, 공고 관리, 지원자 관리 — **구현 완료** (회원가입 ~ 서브탭 3종 전부)
- **Tab2 (구직자용)**: 공고 열람, 기업 정보, 지원 현황 — 하드필터 기반 "추천 공고" 하이라이트 위젯만 구현됨. PRD가 요구하는 본 화면(공고 열람 전체 목록+필터, 기업 정보, 지원 현황)은 아직 미구현

### 공용 매칭 헬퍼 (`js/matching.js`, `js/categories.js`)

`common` 브랜치가 하드 필터 매칭 쿼리를 아래 공용 함수로 추출했습니다(REFACT.md P0-1/P0-2). `company`/`jobseeker` 브랜치에서 `js/tab-company.js`/`js/tab-jobseeker.js`를 재설계할 때 이 함수들을 가져다 쓸 수 있습니다(채택 여부/시점은 각 담당자 재량).

- `fetchMatchingJobseekers(company, limit)` — `js/matching.js`. 기업 -> 구직자 하드 필터 매칭. `company`는 `company_profiles` 행(`id`/`position_category_id`/`region_category_id` 사용). `limit`으로 반환 건수 조절(기업 탭은 전체 목록, 메인 탭은 하이라이트 N개). 반환: `{ candidates, categoryMap }`.
- `fetchMatchingPostings(jobseeker, limit)` — `js/matching.js`. 구직자 -> 공고 하드 필터 매칭. `jobseeker`는 `jobseeker_profiles` 행(`id`/`desired_position_category_id`/`desired_employment_type`/`region_category_id` 사용). 반환: `{ postings, categoryMap, companyMap }`.
- `resolvePositionGroupId(categoryId)` — `js/categories.js`. `job_postings.position_category_id`(직군, depth 1)와 구직자의 `desired_position_category_id`(직무, depth 2 가능)를 비교하기 위해 직군 레벨로 환산한다.

매칭 규칙(하드 필터 조건) 자체가 바뀔 때는 이 파일들만 고치면 되도록 설계되어 있습니다.
```

**충돌 2 — "브랜치 작업 시작 전 체크리스트" 항목들**: `company` 쪽 1번 항목에 실제로 검증된 API 호스트/인증 헤더 정보가 있어 이쪽을 유지하되, `common` 쪽 2번의 추가 근거 문장과, 서로 완전히 다른 내용인 4번(`company`: 카테고리 샘플 데이터 안내 / `common`: 매칭 헬퍼 재사용 안내)을 모두 살려 5개 항목으로 합칩니다.

```markdown
1. 원티드(Wanted) API에서 실제로 가져오는 변수명·타입·구조가 `PRD.md`(3장 카테고리 체계, 4장 데이터 모델, 4.5장 JobPosting)에 적힌 것과 **동일한지** 다시 확인합니다. 실제 API 호스트는 `https://openapi.wanted.jobs`이며 인증에 `wanted-client-id`/`wanted-client-secret` 헤더가 모두 필요합니다(`openapi.json`의 `servers`에는 호스트가 명시되어 있지 않아 실제 호출로 검증한 값입니다).
2. 차이가 발견되면, 코드부터 구현하지 말고 **`PRD.md`/`DB.md`를 먼저 갱신**한 뒤 구현을 시작합니다 — 두 문서가 실제 API와 어긋난 상태로 구현이 진행되면 이후 다른 브랜치와의 merge 시 데이터 모델 불일치가 발생합니다.
3. `EMPLOYMENT_TYPE`(고용형태, flat 문자열), `average_salary`/`hired_salary`(공고가 아닌 기업 단위 집계), `position_category_id`+직무 상세(복수) 구조처럼 원티드 API에 맞춰 재설계된 부분은 실제 연동 시 어긋나기 쉬우니 우선적으로 재검증하세요.
4. `categories` 테이블의 INDUSTRY/REGION/SKILL은 아직 전체 데이터가 아니라 대표 샘플입니다("카테고리 데이터 시딩" 절 참고) — 해당 카테고리를 다루는 기능을 테스트할 때 데이터 범위가 좁다는 점을 감안하세요.
5. **`company`/`jobseeker` 브랜치 담당자만 해당**: `js/tab-company.js`/`js/tab-jobseeker.js`는 초기 스캐폴드 단계에서 만들어진 **임시 프리뷰 구현**입니다(하드 필터 기반 인재/공고 매칭 카드만 보여줌 — Tab1/Tab2의 정식 기능인 공고 관리·지원자 관리·기업 정보·지원 현황 등은 아직 없음). 각자 브랜치에서 자유롭게 재설계/교체해도 됩니다. 두 파일에 남아 있는 매칭 쿼리 로직은 이제 `js/matching.js`의 `fetchMatchingJobseekers`/`fetchMatchingPostings`(위 "공용 매칭 헬퍼" 절 참고)로 공용 추출되어 있으니, 재설계 시 이 함수를 그대로 쓸지 여부를 `common` 브랜치 담당자와 조율하세요.
```

---

## 이제 충돌 안 나는 것 (참고 — 예전 시뮬레이션과 달라진 점)

- `js/tab-main.js` — ⚠️ **더 이상 사실이 아님(2026-07-15 갱신)**. 이 절은 원래 `company`(당시 `63f66c5`)와 `common`(`1f4eaae`)의 `js/tab-main.js`가 바이트 단위로 동일하다는 뜻이었지만, 같은 날 `company`에서 사용자 피드백 2·3차를 반영하며 이 파일을 계속 고쳤습니다(아래 "jobseeker 병합 시 주의사항" 절 참고). 따라서 지금 시점에 `common`과 다시 비교하면 `js/tab-main.js`/`index.html`/`css/app.css`는 다시 충돌 대상이며, 이 문서의 "요약" 표에 있는 "✅ `company` 전체 채택" 판단도 그 시점 기준입니다 — 실제 병합 작업 전에 `git merge-tree`로 재시뮬레이션하세요.
- `.env.example`, `scripts/generate_config.py` — `common`의 준비 커밋(`1f4eaae`, "Prepare common branch for company merge")이 `company`와 동일한 `API_BASE_URL` 처리를 이미 추가해서 더 이상 충돌하지 않습니다(이 항목은 여전히 유효).

---

## jobseeker 병합 시 주의사항 (2026-07-15 추가)

`jobseeker` 브랜치는 `common`을 기준으로 계속 작업 중입니다(README.md "다음 세션 체크리스트" 4번 참고). `jobseeker` 결과물을 나중에 `company`/`main`과 맞출 때 아래를 확인하세요.

### 1. REGION 카테고리 depth 불일치로 하드 필터가 사실상 안 걸릴 수 있음

`js/matching.js`의 `fetchMatchingPostings`(구직자→공고)/`fetchMatchingJobseekers`(기업→구직자) 하드 필터와, 아직 리팩터되지 않은 `js/tab-company.js`/`js/tab-jobseeker.js`의 자체 매칭 쿼리는 모두 `region_category_id`를 **완전일치**(`.eq()` 또는 `===`)로 비교합니다. 그런데:

- `company_profiles.region_category_id`는 원티드 실데이터 임포트 시 시군구(REGION depth 2, 없으면 시도 depth 1)로 채워집니다(`backend/scripts/import_wanted_data.py`의 `_ensure_region_for_company`).
- `jobseeker_profiles.region_category_id`는 회원가입 폼의 3단계 캐스케이드 select(`js/signup.js`, `mountCascadeSelects({ categoryType: 'REGION', maxDepth: 3 })`)로 입력되어, 하위 카테고리가 있으면 읍면동(depth 3)까지 내려갑니다.

즉 기업은 주로 depth 1~2, 구직자는 흔히 depth 3 id를 갖게 되어 같은 동네라도 id가 다르면(대부분 다릅니다) 완전일치 매칭이 거의 항상 실패합니다. 메인 탭 히어로 검색에서 동일한 원인의 버그를 이번에 고쳤고(README.md "메인 탭 2·3차 수정 요약" 4번), 그때 만든 `js/tab-main.js`의 `resolveRegionFilterIds(regionId)`(선택한 카테고리의 자기 자신 + 하위 시군구 + 그 하위 읍면동 id를 모아 `in` 매칭)가 이 문제의 해결 패턴입니다. `jobseeker` 탭의 실제 추천/매칭 화면을 만들 때, 그리고 `js/matching.js`를 손볼 때 이 패턴을 함께 적용하는 걸 권장합니다 — 두 브랜치가 각자 다른 방식으로 고치면 병합 시 다시 갈라집니다.

### 2. 메인 탭 시장 데이터 영역이 `common` 대비 더 바뀜

`index.html`의 Group B(시장 데이터 섹션)가 3개 섹션 세로 스택에서 4개 파이차트 2x2 그리드(`.section-group__grid`)로, 역할 선택 CTA(`#main-role-cta`)는 완전히 삭제로 바뀌었습니다. `common`이 이 영역을 그 사이에 더 건드리지 않았다면 기계적으로 `company` 전체 채택으로 풀리겠지만, 병합 시점에 `common` 쪽도 이 영역을 손댔다면 사람이 직접 비교해야 합니다.

### 3. 기업 탭 기능을 테스트하려면 백엔드도 같이 띄워야 함

`jobseeker` 탭에서 기업 쪽 기능(예: `js/matching.js`, `js/api-client.js` 경유 API)을 참고/재사용할 계획이라면, "인재 검색" 등 `backend/`(FastAPI) 의존 기능은 프런트만 띄워서는 동작하지 않고 `cd backend && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`으로 백엔드도 같이 띄워야 정상 동작합니다(README.md "로컬 실행 방법" 4번). 이번에 "서버에 연결할 수 없습니다" 에러를 재현/확인하며 확인된 내용입니다.

## 검증 방법

`git merge-tree --write-tree --name-only <branch1> <branch2>` (git 2.38+)는 워킹 디렉터리·인덱스를 건드리지 않고 병합을 시뮬레이션합니다. 이 문서의 결과는 아래로 재현할 수 있습니다.

```bash
git fetch origin
git fetch ../Team_Project_common common:refs/heads/common-local
git merge-tree --write-tree --name-only company common-local   # company ↔ common 충돌 목록
git merge-tree --write-tree --name-only company origin/main    # company → main 실제 PR 대상 (충돌 0건)
```
