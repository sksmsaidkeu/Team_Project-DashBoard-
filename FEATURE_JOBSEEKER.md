# Feature: 구직자 대시보드 (Tab2) 구현

## 해결하고 싶은 문제

현재 구직자 사용자(user_type='JOBSEEKER')가 사용하는 Tab2는 PRD.md 6장 IA에서 정의했던 "공고 열람, 기업 정보, 지원 현황"을 표시하는 업무 대시보드이다. 그러나:

1. **지원 현황 조회 화면만 프로토타입**: 실제 데이터를 DB에서 조회하는 API가 없어, 샘플 데이터만 표시됨
2. **추천공고 알고리즘 미구현**: PRD 5장의 3단계 매칭 로직(하드 필터 → 소프트 스코어링 → 정렬)이 설계되었으나 실제 계산 로직이 없음
3. **인사이트/핫스킬/뉴스 데이터소스 미정**: 프론트 마크업은 있으나 백엔드에서 실제 데이터를 제공하지 않음
4. **Wanted API 연동 미완료**: 원티드 API를 통한 공고/기업 데이터 수집 로직 부재

---

## 제안하는 해결 방법

### 백엔드 (Supabase Edge Functions)

#### 1. 지원 현황 조회 API (`/functions/jobseeker-applications`)

**입력:**
- `user_id`: 현재 로그인한 구직자 ID
- `status` (선택): 상태별 필터 (applied/review/interview/result)

**처리:**
- `interaction_logs` (action='APPLY') 기반 지원 기록 조회
- `job_postings` + `company_profiles` 조인으로 공고/기업명 조회
- 지원 시각 기준 4단계 상태 분류:
  - **지원완료**: `interaction_logs.created_at` ≤ 7일
  - **서류심사**: 운영자 설정값 또는 프론트 UI상 상태 변경
  - **면접**: 동일
  - **최종결과**: 동일
  > ⚠️ 오픈이슈: 현재 DB.md에 지원자별 단계 저장 컬럼이 없음. `jobseeker_applications` 테이블 신설 또는 `interaction_logs`에 `pipeline_stage` 컬럼 추가 여부 확정 필요 (하단 오픈이슈 참고)

**응답:**
```json
{
  "stages": [
    {
      "stage_name": "지원완료",
      "stage_key": "applied",
      "count": 27,
      "cards": [
        {
          "id": "job-1",
          "job_title": "프론트엔드 개발자",
          "company_name": "그린팀",
          "applied_at": "2026-07-10T15:30:00Z",
          "skills": ["React", "TypeScript"]
        }
      ]
    }
  ]
}
```

#### 2. 인사이트 조회 API (`/functions/jobseeker-insights`)

**입력:**
- `user_id`: 구직자 ID
- `period` (선택): 기간 (week/month) — 기본값 month

**처리:**
- 지원 수, 진행 중인 지원, 합격률, 응답률 등 통계 계산
- 이전 기간 대비 변화율 계산
- `interaction_logs` 기반 활동성 지표

**응답:**
```json
{
  "stats": [
    {
      "label": "총 지원",
      "value": 42,
      "change": "+5"
    },
    {
      "label": "진행 중",
      "value": 8,
      "change": "+2"
    },
    {
      "label": "합격률",
      "value": 19,
      "change": "+3%"
    }
  ]
}
```

#### 3. 핫 스킬 조회 API (`/functions/jobseeker-trending-skills`)

**입력:**
- `user_id`: 구직자 ID (구직자의 업종/직무 기반 스킬)
- `limit` (선택): 상위 N개 — 기본값 5

**처리:**
- 구직자의 희망 직무/업종 파악
- 최근 30일간 해당 직무 공고에서 요구되는 스킬 빈도 계산
  - 데이터 소스: `job_postings` + `job_posting_position_details` + `company_profile_skills`
  - 또는 `interaction_logs` (VIEW 액션) 기반 조회한 공고들의 스킬
- 상위 5개 스킬 + 변화율(지난달 대비) 반환

**응답:**
```json
{
  "skills": [
    {
      "rank": 1,
      "name": "Python",
      "frequency": 245,
      "change_rate": 12.5
    }
  ]
}
```

#### 4. 추천공고 조회 API (`/functions/recommendations`)

**입력:**
- `user_id`: 구직자 ID
- `limit` (선택): 상위 N개 — 기본값 20

**처리:**
- PRD 5장 3단계 매칭 로직 적용:
  1. **하드 필터** (필수 조건):
     - 희망 직무 일치
     - 희망 고용형태 일치
     - 거주 지역 일치
     - 보유 스킬 최소 1개 일치
  2. **소프트 스코어링** (0~100점):
     - 스킬 매칭: 40%
     - 직무 매칭: 25%
     - 지역·연봉: 15%
     - 활동성: 10% (`interaction_logs` 기반 상호작용 빈도)
     - 최신성: 10% (공고 게시 후 경과일)
  3. **정렬**: 점수 기준 내림차순

**응답:**
```json
{
  "jobs": [
    {
      "id": "job-1",
      "title": "프론트엔드 개발자",
      "company_name": "그린팀",
      "location": "서울",
      "salary_range": "5.5M~7M",
      "match_score": 92,
      "required_skills": ["React", "TypeScript"]
    }
  ],
  "total": 5
}
```

#### 5. 뉴스 조회 API (`/functions/news`)

**입력:**
- `industry_id` (선택): 구직자 관심 업종 기반 필터
- `limit` (선택): 상위 N개 — 기본값 10

**처리:**
- 임시 처리(PRD 8장): DB의 `news` 테이블(수동 등록)에서 조회
- 향후 Wanted API 또는 외부 뉴스 API 연동 예정

**응답:**
```json
{
  "items": [
    {
      "id": "news-1",
      "title": "2026년 IT 채용 시장 전망",
      "source": "Wanted",
      "published_at": "2026-07-14T10:00:00Z",
      "url": "https://wanted.co.kr/news/..."
    }
  ]
}
```

#### 6. 카테고리 조회 API (공유, `/functions/categories`)

**입력:**
- `category_type` (선택): INDUSTRY / JOB / SKILL / REGION
- `parent_id` (선택): 상위 카테고리 ID (드롭다운 계층 조회용)
- `search` (선택): 검색어 (자동완성용)

**처리:**
- `categories` 테이블 조회 + 필터링
- 자동완성: `search` 포함 항목 반환

**응답:**
```json
{
  "categories": [
    {
      "id": "cat-1",
      "title": "개발",
      "category_type": "JOB",
      "depth": 1,
      "children_count": 5
    }
  ]
}
```

---

### 프론트엔드 (Vanilla HTML/CSS/JS SPA)

#### 1. 지원 현황 칸반 보드

**위치:** `tab-jobseeker.js` + `js/jobseeker-applications.js` (신규)

**구현 사항:**
- API 호출: `GET /functions/jobseeker-applications`
- 4단계 칸반 렌더링 (지원완료 → 서료심사 → 면접 → 최종결과)
- 각 단계별 카드 개수 표시
- 카드 호버 시 스킬 배지 표시
- 상태 변경 UI (드래그 또는 버튼)

**CSS 클래스 (DESIGN.md 5.7절):**
- `.kanban`, `.kanban-col`, `.col-header`
- `.stage-1`, `.stage-2`, `.stage-3`, `.stage-4` (색상 토큰)
- `.job-card`, `.skill`

#### 2. 인사이트 통계 섹션

**위치:** `index.html` panel-jobseeker 내 우측 사이드바

**구현 사항:**
- API 호출: `GET /functions/jobseeker-insights`
- 3개 통계 타일 표시 (총 지원, 진행 중, 합격률)
- 변화율 표시 (색상: 증가 → `--accent-cool-strong`, 감소 → `--negative`)
- 실시간 업데이트 (옵션: 페이지 로드 시마다)

**CSS 클래스 (DESIGN.md 5.5절):**
- `.stat-item`, `.stat-label`, `.stat-value`, `.stat-change`

#### 3. 핫 스킬 트렌딩

**위치:** `index.html` panel-jobseeker 내 우측 사이드바

**구현 사항:**
- API 호출: `GET /functions/jobseeker-trending-skills`
- 순위별 스킬 나열 (1~5위)
- 변화율 표시 (상승 ↑ / 하락 ↓ / 동일)
- 호버 시 상세 정보

**CSS 클래스 (DESIGN.md 5.6절):**
- `.trend-item`, `.trend-rank`, `.trend-name`, `.trend-change`

#### 4. 추천공고 그리드

**위치:** `index.html` panel-jobseeker 하단 (news 섹션과 좌우 배치)

**구현 사항:**
- API 호출: `GET /functions/recommendations`
- 카드 그리드 (데스크톱 3열 → 태블릿 2열 → 모바일 1열)
- 각 카드에 `.match-score` 링 표시 (92%, 87% 등)
  - 매칭 점수 시각화 (원형 진행률 또는 숫자)
  - 접근성: `aria-hidden` + `.sr-only` 텍스트 병행
- 지원하기 버튼

**CSS 클래스 (DESIGN.md 5.3절 + 6장):**
- `.card`, `.match-score`, `.match-score__value`
- `.rec-badge`, `.rec-title`, `.rec-meta`, `.rec-btn`

#### 5. 뉴스 섹션

**위치:** `index.html` panel-jobseeker 하단 (추천공고와 우측 배치)

**구현 사항:**
- API 호출: `GET /functions/news`
- 뉴스 아이템 리스트 (최대 10개)
- 소스 + 발행일 표시
- 클릭 시 외부 링크 열기

**CSS 클래스:**
- `.news-item`, `.news-title`, `.news-source`

#### 6. 인사 배너 (사무 톤)

**위치:** 칸반 보드 최상단

**구현 사항:**
- 구직자명 + 인사말 ("00님, 이번 주 지원자 현황입니다")
- 통계 칩 ("지원 42건 · 진행 중 8건")
- 배경색: `--paper-dim` 또는 `--paper`
- 텍스트: 중성 톤 (과하지 않은 톤)

**CSS 클래스 (DESIGN.md 5.4절):**
- `.greeting-banner`, `.greeting-banner__title`, `.greeting-banner__chip`

#### 7. 카테고리 드롭다운/자동완성 (필터 UI)

**위치:** 구직자 프로필 편집 화면 또는 검색 필터 (추가 범위)

**구현 사항:**
- API 호출: `GET /functions/categories?category_type=JOB`
- 다중 선택 지원 (스킬 필터)
- 자동완성 (검색어 입력 시 필터링)
- 선택된 항목 배지 표시

**CSS 클래스 (DESIGN.md 4.2절):**
- `.cascade-group`, `.form-select`, `.skill-group`

---

## 작업 체크리스트

### 백엔드 (Supabase Edge Functions)

- [ ] **1. 데이터베이스 테이블 확정**
  - [ ] `jobseeker_applications` 테이블 신설 여부 결정 (오픈이슈 참고)
  - [ ] `news` 테이블 생성 (임시 뉴스 저장용)
  - [ ] RLS 정책 설정 (구직자 본인 데이터만 조회 가능)

- [ ] **2. Supabase Edge Functions 구현**
  - [ ] `jobseeker-applications/index.ts` → 지원 현황 조회
  - [ ] `jobseeker-insights/index.ts` → 인사이트 통계
  - [ ] `jobseeker-trending-skills/index.ts` → 핫 스킬
  - [ ] `recommendations/index.ts` → 추천공고 (매칭 로직 포함)
  - [ ] `news/index.ts` → 뉴스
  - [ ] `categories/index.ts` → 카테고리 (공유용)

- [ ] **3. 매칭 로직 구현**
  - [ ] 하드 필터 함수 (직무/고용형태/지역/스킬)
  - [ ] 스코어링 함수 (5가지 가중치)
  - [ ] 정렬 로직

- [ ] **4. API 테스트**
  - [ ] 각 엔드포인트 테스트 (Supabase CLI)
  - [ ] 응답 포맷 검증

### 프론트엔드 (Vanilla JS)

- [ ] **5. API 클라이언트 함수 작성**
  - [ ] `js/api/jobseeker.js` (신규)
     - `getApplications()`
     - `getInsights()`
     - `getTrendingSkills()`
     - `getRecommendations()`
     - `getNews()`
     - `getCategories()`

- [ ] **6. 지원 현황 칸반 렌더링**
  - [ ] `js/jobseeker-applications.js` (신규)
  - [ ] 4단계 칸반 렌더링
  - [ ] 상태 변경 UI 구현

- [ ] **7. 인사이트/핫스킬 렌더링**
  - [ ] 통계 타일 렌더링
  - [ ] 트렌드 아이템 렌더링

- [ ] **8. 추천공고 카드 그리드 렌더링**
  - [ ] 매칭 점수 링 구현 (svg 또는 css)
  - [ ] 카드 그리드 반응형
  - [ ] 지원하기 버튼 (클릭 시 상태 변경)

- [ ] **9. 뉴스 섹션 렌더링**
  - [ ] 뉴스 아이템 리스트
  - [ ] 외부 링크 열기

- [ ] **10. 인사 배너 구현**
  - [ ] 구직자명 표시
  - [ ] 통계 칩 표시

- [ ] **11. 반응형 테스트**
  - [ ] 데스크톱 (1280px+)
  - [ ] 태블릿 (768px~1024px)
  - [ ] 모바일 (375px~767px)

- [ ] **12. 접근성 검증**
  - [ ] ARIA 라벨 (매칭 점수)
  - [ ] 색상 단독 표현 제거 (상태 배지)
  - [ ] 키보드 네비게이션
  - [ ] 스크린 리더 테스트

---

## 참고 문서

- **PRD.md**
  - 2장: 회원 가입 및 카테고리 체계
  - 4.2장: JobseekerProfile 데이터 모델
  - 5장: 추천/매칭 로직 (3단계, 가중치)
  - 6장: IA (Tab2 역할)

- **DB.md**
  - 3.2절: categories 테이블
  - 3.4절: jobseeker_profiles + jobseeker_profile_skills
  - 3.5절: job_postings + job_posting_position_details
  - 3.6절: interaction_logs (action_type: VIEW/SAVE/APPLY)

- **DESIGN.md**
  - 2.2절: 색상 토큰 (--pink-*, --accent-cool, --negative)
  - 4.2절: Tab2 레이아웃 (칸반 + 사이드바)
  - 5.3절: 매칭 스코어 링 스타일
  - 5.4절: 인사 배너 스타일
  - 5.5~5.7절: 통계/트렌드/파이프라인 컴포넌트
  - 6장: 매칭 스코어 링 (원형 진행률 상세)
  - 7장: 반응형 & 접근성

---

## 오픈이슈 (구현 전 확정 필요)

### 1. 지원자 파이프라인 단계 저장 위치 미정

**문제:** DB.md에는 지원자별 진행 단계(지원완료/서류심사/면접/최종결과)를 저장하는 컬럼/테이블이 없다.

**선택지:**
- **A) `jobseeker_applications` 테이블 신설** (추천)
  ```sql
  CREATE TABLE jobseeker_applications (
    id UUID PRIMARY KEY,
    jobseeker_profile_id UUID NOT NULL REFERENCES jobseeker_profiles,
    job_posting_id UUID NOT NULL REFERENCES job_postings,
    pipeline_stage TEXT ('applied'/'review'/'interview'/'result'),
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    UNIQUE(jobseeker_profile_id, job_posting_id)
  );
  ```
  - 장점: 명확한 데이터 모델, 빠른 조회
  - 단점: 테이블 추가 (정규화)

- **B) `interaction_logs`에 `pipeline_stage` 컬럼 추가**
  - 장점: 테이블 추가 없음
  - 단점: 이벤트 로그와 상태 정보 혼재

**권장:** **A) 신규 테이블 생성**

### 2. Wanted API 연동 시점 미정

**현재:** 뉴스/핫스킬은 임시 샘플 데이터 또는 수동 등록

**향후:** 실제 원티드 API에서 공고/기업 데이터 수집 (v1.1 예정)

### 3. 민감정보 처리 (PRD 8장)

**현재 임시값:** 모든 연봉/지역 정보 공개

**향후:** `is_salary_public` / `is_region_public` 플래그 기반 마스킹

---

## 일정 (추정)

| 단계 | 담당 | 예상 기간 |
|------|------|---------|
| 1-4 (백엔드) | 공통란 팀원 | 1~2주 |
| 5-12 (프론트) | 구직자란 팀원 | 1~2주 |
| 통합 & 테스트 | 전체 | 3~5일 |
| **총합** | | **2~3주** |

