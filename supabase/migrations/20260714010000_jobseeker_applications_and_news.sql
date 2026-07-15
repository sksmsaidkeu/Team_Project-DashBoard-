-- FEATURE_JOBSEEKER.md 오픈이슈 1/2 해결:
--   1) 지원자 파이프라인 단계 저장 위치 미정 → 신규 테이블 jobseeker_applications 채택(문서의 권장안 A).
--      회사 ATS가 아니라 "구직자 개인용 지원 현황 트래커"이므로(DESIGN.md 4.3/5.7절), 소유자인
--      구직자 본인이 스스로 단계를 갱신하는 모델로 설계했다. 채용 담당자용 파이프라인 관리 기능은
--      이번 범위에 없다.
--   2) 뉴스 데이터소스 미정 → 임시로 수동 등록하는 news 테이블 신설(PRD 8장/FEATURE_JOBSEEKER.md
--      "뉴스 조회 API" 참고). 실제 Wanted API/외부 뉴스 API 연동은 v1.1 이후 별도 처리.

create table public.jobseeker_applications (
  id uuid primary key default gen_random_uuid(),
  jobseeker_profile_id uuid not null references public.jobseeker_profiles(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  pipeline_stage text not null default 'applied'
    check (pipeline_stage in ('applied', 'review', 'interview', 'result')),
  -- DESIGN.md 5.7절: 4단계(최종결과) 도달 후에만 합격/불합격으로 분기.
  outcome text check (outcome in ('passed', 'rejected')),
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jobseeker_profile_id, job_posting_id),
  constraint jobseeker_applications_outcome_requires_result
    check (outcome is null or pipeline_stage = 'result')
);

comment on table public.jobseeker_applications is
  '구직자 개인용 지원 현황 트래커(칸반). 지원 1건당 1행, pipeline_stage로 진행 단계를 구직자 본인이 갱신한다. 회사측 ATS 파이프라인 관리 기능이 아니다.';

create index idx_jobseeker_applications_jobseeker_profile_id
  on public.jobseeker_applications (jobseeker_profile_id);
create index idx_jobseeker_applications_job_posting_id
  on public.jobseeker_applications (job_posting_id);

create trigger trg_jobseeker_applications_updated_at
  before update on public.jobseeker_applications
  for each row execute function public.set_updated_at();

alter table public.jobseeker_applications enable row level security;

-- 본인(구직자) 소유 데이터만 전 권한 — interaction_logs/user_preferences와 동일한 원칙.
create policy "jobseeker_applications_all_own" on public.jobseeker_applications
  for all using (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- news: 임시 수동 등록 뉴스(PRD 8장). categories(INDUSTRY)와 선택적으로 연결해
-- 구직자의 관심 업종 기반 필터링(jobseeker-news API)에 사용한다.
-- ---------------------------------------------------------------------
create table public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null,
  url text not null,
  industry_category_id uuid references public.categories(id),
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.news is
  '임시 수동 등록 뉴스(PRD 8장 미확정 이슈). industry_category_id는 category_type=INDUSTRY 카테고리를 참조하며 NULL이면 업종 무관 일반 뉴스. 실제 원티드/외부 뉴스 API 연동 전까지의 임시 데이터소스.';

create index idx_news_industry_category_id on public.news (industry_category_id);
create index idx_news_published_at on public.news (published_at desc);

-- categories와 동일한 원칙: 공개 조회, 쓰기는 정책 없이 service_role(수동 등록)로만 수행.
alter table public.news enable row level security;

create policy "news_select_public" on public.news
  for select using (true);
