-- DB.md 기준 초기 스키마 마이그레이션.
-- DB.md는 RLS(Row Level Security)를 "별도 문서에서 다룬다"고 명시했으므로, 이 마이그레이션은
-- 테이블/컬럼/제약조건만 다루고 RLS 정책은 포함하지 않는다.
-- 주의: RLS를 켜지 않으면 Supabase 기본 권한상 anon/authenticated 롤이 아래 테이블에 자유롭게
-- 접근할 수 있다. 실제 서비스 배포 전에는 반드시 별도로 RLS 정책을 추가해야 한다.

create extension if not exists pgcrypto;

-- =========================================================================
-- 3.1 users (DB.md 3.1절)
-- =========================================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  user_type text not null check (user_type in ('COMPANY', 'JOBSEEKER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is '회원 공통 정보. user_type은 가입 시 1회 결정되며 전환 불가(PRD 2장/8장).';

-- =========================================================================
-- 3.2 categories (DB.md 3.2절)
-- =========================================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  category_type text not null check (category_type in ('INDUSTRY', 'JOB', 'SKILL', 'REGION')),
  parent_id uuid references public.categories(id) on delete restrict,
  title text not null,
  tag_id integer unique,
  ksic_code text,
  industry_code text,
  location_code text,
  depth integer not null default 1 check (depth between 1 and 3),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_type, parent_id, title)
);

comment on table public.categories is '업종/직무/스킬/지역 계층형 카테고리(PRD 3장). 원티드 API 필드명과 통일(DB.md 1.1절).';

-- categories 검증 트리거: DB.md 3.2절이 "CHECK만으로 표현 불가 -> 트리거로 강제"라고 명시한 3가지 규칙.
--   1) depth는 parent의 depth+1 (parent_id NULL이면 depth=1)
--   2) SKILL 타입은 항상 parent_id NULL(단일 레벨)
--   3) ksic_code/industry_code는 INDUSTRY 전용, location_code는 REGION 전용
create or replace function public.categories_validate()
returns trigger
language plpgsql
as $$
declare
  parent_depth integer;
begin
  if new.parent_id is null then
    if new.depth <> 1 then
      raise exception 'categories.depth must be 1 when parent_id is NULL (got %)', new.depth;
    end if;
  else
    select depth into parent_depth from public.categories where id = new.parent_id;
    if parent_depth is null then
      raise exception 'categories.parent_id % not found', new.parent_id;
    end if;
    if new.depth <> parent_depth + 1 then
      raise exception 'categories.depth must equal parent depth + 1 (parent depth=%, got=%)', parent_depth, new.depth;
    end if;
  end if;

  if new.category_type = 'SKILL' and new.parent_id is not null then
    raise exception 'SKILL categories must have parent_id NULL (단일 레벨)';
  end if;

  if new.category_type <> 'INDUSTRY' and (new.ksic_code is not null or new.industry_code is not null) then
    raise exception 'ksic_code/industry_code는 category_type=INDUSTRY일 때만 허용됩니다';
  end if;

  if new.category_type <> 'REGION' and new.location_code is not null then
    raise exception 'location_code는 category_type=REGION일 때만 허용됩니다';
  end if;

  return new;
end;
$$;

create trigger trg_categories_validate
before insert or update on public.categories
for each row execute function public.categories_validate();

-- =========================================================================
-- 3.3 company_profiles (DB.md 3.3절)
-- =========================================================================
create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  industry_category_id uuid not null references public.categories(id),
  company_size text not null,
  region_category_id uuid not null references public.categories(id),
  position_category_id uuid not null references public.categories(id),
  employment_type text not null check (employment_type in ('regular', 'contract', 'intern')),
  average_salary integer check (average_salary is null or average_salary >= 0),
  hired_salary integer check (hired_salary is null or hired_salary >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_profiles is '기업 프로필(PRD 4.1). users.user_type=COMPANY 계정과 1:1.';

-- =========================================================================
-- 3.4 company_profile_skills (조인 테이블, DB.md 3.4절)
-- =========================================================================
create table public.company_profile_skills (
  company_profile_id uuid not null references public.company_profiles(id) on delete cascade,
  skill_category_id uuid not null references public.categories(id),
  created_at timestamptz not null default now(),
  primary key (company_profile_id, skill_category_id)
);

-- =========================================================================
-- 3.5 jobseeker_profiles (DB.md 3.5절)
-- =========================================================================
create table public.jobseeker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  desired_position_category_id uuid not null references public.categories(id),
  career_years integer not null check (career_years >= 0),
  region_category_id uuid not null references public.categories(id),
  desired_salary integer check (desired_salary is null or desired_salary >= 0),
  desired_employment_type text not null check (desired_employment_type in ('regular', 'contract', 'intern')),
  is_salary_public boolean not null default true,
  is_region_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobseeker_profiles is '구직자 프로필(PRD 4.2). users.user_type=JOBSEEKER 계정과 1:1.';

-- =========================================================================
-- 3.6 jobseeker_profile_skills (조인 테이블, DB.md 3.6절)
-- =========================================================================
create table public.jobseeker_profile_skills (
  jobseeker_profile_id uuid not null references public.jobseeker_profiles(id) on delete cascade,
  skill_category_id uuid not null references public.categories(id),
  created_at timestamptz not null default now(),
  primary key (jobseeker_profile_id, skill_category_id)
);

-- =========================================================================
-- 3.7 user_preferences (DB.md 3.7절)
-- =========================================================================
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  weight numeric(5, 2) not null default 0 check (weight >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

-- =========================================================================
-- 3.8 job_postings (DB.md 3.8절)
-- =========================================================================
create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.company_profiles(id) on delete cascade,
  position_category_id uuid not null references public.categories(id),
  employment_type text not null check (employment_type in ('regular', 'contract', 'intern')),
  annual_from integer not null default 0 check (annual_from >= 0),
  annual_to integer check (annual_to is null or annual_to >= annual_from),
  status text not null default 'draft' check (status in ('draft', 'active', 'close')),
  posted_at timestamptz,
  closed_at timestamptz check (closed_at is null or posted_at is null or closed_at >= posted_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_postings is '채용공고(PRD 4.5). 컬럼명은 원티드 ATSPositionCreateSerializer/JobStatusEnum과 통일(DB.md 1.1절). 급여 컬럼 없음 — company_profiles.average_salary/hired_salary를 조인해서 사용.';

-- =========================================================================
-- 3.8.1 job_posting_position_details (조인 테이블, DB.md 3.8.1절)
-- =========================================================================
create table public.job_posting_position_details (
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  position_detail_category_id uuid not null references public.categories(id),
  created_at timestamptz not null default now(),
  primary key (job_posting_id, position_detail_category_id)
);

-- =========================================================================
-- 3.9 interaction_logs (DB.md 3.9절)
-- =========================================================================
create table public.interaction_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null check (action_type in ('VIEW', 'SAVE', 'APPLY', 'POSTED', 'CLOSED')),
  target_job_posting_id uuid references public.job_postings(id) on delete cascade,
  target_jobseeker_profile_id uuid references public.jobseeker_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(target_job_posting_id, target_jobseeker_profile_id) = 1)
);

-- =========================================================================
-- updated_at 자동 갱신 트리거 (DB.md에 컬럼은 명시돼 있으나 갱신 방식은 미명시 — 표준 관례로 추가)
-- =========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger trg_company_profiles_updated_at
before update on public.company_profiles
for each row execute function public.set_updated_at();

create trigger trg_jobseeker_profiles_updated_at
before update on public.jobseeker_profiles
for each row execute function public.set_updated_at();

create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger trg_job_postings_updated_at
before update on public.job_postings
for each row execute function public.set_updated_at();

-- =========================================================================
-- 보조 인덱스 (DB.md에 명시되지 않은 추가 사항 — 자주 필터링되는 컬럼 성능 보강)
-- =========================================================================
create index idx_categories_parent_id on public.categories (parent_id);
create index idx_categories_type on public.categories (category_type);
create index idx_company_profile_skills_skill on public.company_profile_skills (skill_category_id);
create index idx_jobseeker_profile_skills_skill on public.jobseeker_profile_skills (skill_category_id);
create index idx_job_postings_status on public.job_postings (status);
create index idx_job_postings_position_category on public.job_postings (position_category_id);
create index idx_job_postings_company on public.job_postings (company_profile_id);
create index idx_interaction_logs_actor on public.interaction_logs (actor_user_id);
