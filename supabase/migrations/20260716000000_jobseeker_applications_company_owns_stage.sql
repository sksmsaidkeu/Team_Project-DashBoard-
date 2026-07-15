-- jobseeker_applications의 pipeline_stage/outcome을 구직자 본인이 자유롭게 바꿀 수 있던 문제 수정.
--
-- 기존 정책(20260714010000)은 "회사 ATS가 아니라 개인용 트래커"라는 전제로 구직자 본인이
-- 스스로 단계를 갱신하는 모델이었다(주석 참고). 하지만 실제로는 지원완료/서류심사/면접/
-- 최종결과(합격·불합격)는 회사가 결정하는 채용 프로세스 상태이므로, 구직자가 자기 화면에서
-- 임의로 "합격"으로 바꿀 수 있는 건 신뢰할 수 없는 데이터를 만든다.
--
-- 변경: 기존 "본인 전 권한"(for all) 정책을 지우고,
--   - 구직자: SELECT + INSERT만(자기 소유 행). "지원하기" 시 최초 1행 생성은 그대로 가능하지만,
--     이후 pipeline_stage/outcome 변경은 못 한다.
--   - 기업: 자신이 등록한 공고(job_postings.company_profile_id)에 달린 지원 행만 SELECT + UPDATE.
--     (INSERT/DELETE는 기업에도 주지 않는다 — 행 생성은 구직자의 "지원하기"에서만 일어난다.)

drop policy if exists "jobseeker_applications_all_own" on public.jobseeker_applications;

create policy "jobseeker_applications_select_own" on public.jobseeker_applications
  for select using (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  );

create policy "jobseeker_applications_insert_own" on public.jobseeker_applications
  for insert with check (
    exists (
      select 1 from public.jobseeker_profiles jp
      where jp.id = jobseeker_profile_id and jp.user_id = auth.uid()
    )
  );

create policy "jobseeker_applications_select_company" on public.jobseeker_applications
  for select using (
    exists (
      select 1 from public.job_postings jpo
      join public.company_profiles cp on cp.id = jpo.company_profile_id
      where jpo.id = job_posting_id and cp.user_id = auth.uid()
    )
  );

create policy "jobseeker_applications_update_company" on public.jobseeker_applications
  for update using (
    exists (
      select 1 from public.job_postings jpo
      join public.company_profiles cp on cp.id = jpo.company_profile_id
      where jpo.id = job_posting_id and cp.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.job_postings jpo
      join public.company_profiles cp on cp.id = jpo.company_profile_id
      where jpo.id = job_posting_id and cp.user_id = auth.uid()
    )
  );

comment on table public.jobseeker_applications is
  '구직자 지원 현황 트래커. 지원(행 생성)은 구직자 본인만, pipeline_stage/outcome 변경은 해당 공고를 '
  '등록한 기업만 가능하다(2026-07-16 정책 변경 — 이전엔 구직자 본인이 임의로 상태를 바꿀 수 있었음).';
