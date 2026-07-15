-- 원티드(Wanted) 실 라이브 채용공고를 scripts/fetch_wanted_jobs.py(ETL, service_role 전용)로
-- job_postings/company_profiles에 직접 적재하기 위한 스키마 보강.
--
-- 1) company_profiles.user_id를 nullable로 변경.
--    기존 제약(not null unique references users(id))은 "회사가 우리 서비스에 가입한 계정"을
--    전제로 한다. 원티드에서 긁어온 회사는 우리 서비스 가입 계정이 없으므로 이 제약을
--    만족할 수 없다. NULL은 unique 제약에 걸리지 않으므로(Postgres는 NULL끼리 같다고
--    보지 않음) 여러 건의 원티드발 company_profiles가 user_id=NULL로 공존 가능하다.
--    RLS는 이미 20260713130000의 company_profiles_select_public이 공개 조회를 허용하고,
--    insert/update_own은 auth.uid() = user_id 비교라 user_id가 NULL인 행은 어차피 아무
--    일반 사용자도 소유(수정)할 수 없다 — service_role(ETL 스크립트)만 쓸 수 있는 "주인
--    없는 시장 데이터"로 취급된다(categories/wanted_job_trend_snapshot과 동일한 원칙).
-- 2) company_profiles.wanted_company_id / job_postings.wanted_job_id 추가.
--    원티드 원본 ID를 저장해 ETL 재실행 시 upsert(on_conflict) 키로 써서 중복 적재를 막는다.
--    회사가 직접 등록한 기존 행은 원티드 ID가 없으므로 NULL로 둔다(nullable + unique는
--    NULL 다건 허용이라 문제 없음).

alter table public.company_profiles
  alter column user_id drop not null;

alter table public.company_profiles
  add column wanted_company_id bigint unique;

comment on column public.company_profiles.wanted_company_id is
  '원티드 원본 기업 ID(scripts/fetch_wanted_jobs.py upsert 키). 회사가 직접 가입/등록한 프로필은 NULL.';

alter table public.job_postings
  add column wanted_job_id bigint unique;

comment on column public.job_postings.wanted_job_id is
  '원티드 원본 공고 ID(scripts/fetch_wanted_jobs.py upsert 키). 회사가 직접 등록한 공고는 NULL.';
