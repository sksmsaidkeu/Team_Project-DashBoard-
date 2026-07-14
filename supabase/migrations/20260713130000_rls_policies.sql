-- RLS(Row Level Security) 정책. DB.md 1장/8장이 "별도 문서/추후 정책 확정"으로 미뤄뒀던 부분을
-- 이번에 확정해 적용한다. 접근 모델:
--   - categories/company_profiles/company_profile_skills/job_postings/job_posting_position_details
--     : 시장 정보라 공개 SELECT(anon 포함), 쓰기는 소유자(또는 categories는 service_role)만.
--   - users/user_preferences/interaction_logs: 본인만 SELECT/쓰기 가능.
--   - jobseeker_profiles/jobseeker_profile_skills: 간단한 정책 채택(2026-07-13 확정) —
--     is_region_public과 is_salary_public이 "둘 다 true"인 행만 타인에게 전체 공개하고,
--     하나라도 false면 본인만 조회 가능(컬럼 단위 마스킹 없음, DB.md 8장 "추후 정책 확정" 항목의
--     1차 확정 버전 — 더 세밀한 컬럼 단위 공개가 필요해지면 뷰(view) 기반으로 재설계 필요).

alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.company_profiles enable row level security;
alter table public.company_profile_skills enable row level security;
alter table public.jobseeker_profiles enable row level security;
alter table public.jobseeker_profile_skills enable row level security;
alter table public.user_preferences enable row level security;
alter table public.job_postings enable row level security;
alter table public.job_posting_position_details enable row level security;
alter table public.interaction_logs enable row level security;

-- ---------------------------------------------------------------------
-- users: 본인만 조회/생성. user_type은 가입 후 변경 불가(PRD 2장) — UPDATE 정책을 아예 두지 않아
-- RLS 레벨에서도 수정 경로를 차단한다(앱 로직과 이중 방어).
-- ---------------------------------------------------------------------
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- categories: 전체 공개 조회(익명 포함, 가입폼/필터/시장 통계에 필요). 쓰기는 정책을 두지 않아
-- anon/authenticated 모두 차단 — 시드/관리는 service_role 키(RLS 우회)로만 수행한다.
-- ---------------------------------------------------------------------
create policy "categories_select_public" on public.categories
  for select using (true);

-- ---------------------------------------------------------------------
-- company_profiles: 업종/지역 등은 민감정보가 아니라 공개 조회(공고에 기업 정보 표시용).
-- 쓰기는 본인 프로필만.
-- ---------------------------------------------------------------------
create policy "company_profiles_select_public" on public.company_profiles
  for select using (true);

create policy "company_profiles_insert_own" on public.company_profiles
  for insert with check (auth.uid() = user_id);

create policy "company_profiles_update_own" on public.company_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- company_profile_skills: 시장 전체 스킬 수요 랭킹/조합 분석(메인 탭)에 공개 조회가 필요.
-- 쓰기는 해당 company_profile 소유자만.
-- ---------------------------------------------------------------------
create policy "company_profile_skills_select_public" on public.company_profile_skills
  for select using (true);

create policy "company_profile_skills_insert_own" on public.company_profile_skills
  for insert with check (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  );

create policy "company_profile_skills_delete_own" on public.company_profile_skills
  for delete using (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- jobseeker_profiles: 2026-07-13 확정 — 본인은 항상 전체 조회 가능. 타인에게는
-- is_region_public AND is_salary_public이 모두 true인 행만 전체 공개(컬럼 단위 마스킹 없음).
-- ---------------------------------------------------------------------
create policy "jobseeker_profiles_select_own_or_public" on public.jobseeker_profiles
  for select using (
    auth.uid() = user_id
    or (is_region_public = true and is_salary_public = true)
  );

create policy "jobseeker_profiles_insert_own" on public.jobseeker_profiles
  for insert with check (auth.uid() = user_id);

create policy "jobseeker_profiles_update_own" on public.jobseeker_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- jobseeker_profile_skills: 부모 jobseeker_profiles 행이 보이는 경우에만 스킬도 노출해
-- 위 정책과 일관성을 맞춘다(부모가 비공개인데 스킬만 새어나가는 것 방지).
-- ---------------------------------------------------------------------
create policy "jobseeker_profile_skills_select_visible" on public.jobseeker_profile_skills
  for select using (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id
        and (jp.user_id = auth.uid() or (jp.is_region_public = true and jp.is_salary_public = true))
    )
  );

create policy "jobseeker_profile_skills_insert_own" on public.jobseeker_profile_skills
  for insert with check (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  );

create policy "jobseeker_profile_skills_delete_own" on public.jobseeker_profile_skills
  for delete using (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- user_preferences: 완전히 개인적인 추천 로직용 데이터 — 본인만 전 권한.
-- ---------------------------------------------------------------------
create policy "user_preferences_all_own" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- job_postings: 공개 채용공고이므로 전체 공개 조회. 쓰기는 게시 기업(company_profiles) 소유자만.
-- ---------------------------------------------------------------------
create policy "job_postings_select_public" on public.job_postings
  for select using (true);

create policy "job_postings_insert_own" on public.job_postings
  for insert with check (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  );

create policy "job_postings_update_own" on public.job_postings
  for update using (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  );

create policy "job_postings_delete_own" on public.job_postings
  for delete using (
    exists (
      select 1 from public.company_profiles cp
      where cp.id = company_profile_id and cp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- job_posting_position_details: 공개 공고에 딸린 상세 직무 태그 — 공개 조회, 쓰기는 공고 소유자만.
-- ---------------------------------------------------------------------
create policy "job_posting_position_details_select_public" on public.job_posting_position_details
  for select using (true);

create policy "job_posting_position_details_insert_own" on public.job_posting_position_details
  for insert with check (
    exists (
      select 1 from public.job_postings jpost
      join public.company_profiles cp on cp.id = jpost.company_profile_id
      where jpost.id = job_posting_id and cp.user_id = auth.uid()
    )
  );

create policy "job_posting_position_details_delete_own" on public.job_posting_position_details
  for delete using (
    exists (
      select 1 from public.job_postings jpost
      join public.company_profiles cp on cp.id = jpost.company_profile_id
      where jpost.id = job_posting_id and cp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- interaction_logs: 행동 로그는 개인적인 활동 이력 — 본인(actor)만 조회/기록.
-- 필요 시(예: 기업이 자사 공고 조회수 통계를 봐야 하는 기능) 추후 별도 정책 추가.
-- ---------------------------------------------------------------------
create policy "interaction_logs_select_own" on public.interaction_logs
  for select using (auth.uid() = actor_user_id);

create policy "interaction_logs_insert_own" on public.interaction_logs
  for insert with check (auth.uid() = actor_user_id);
