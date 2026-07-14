-- DB.md 6장 오픈이슈("공고 제목/본문 등 세부 필드는 PRD 확정 후 추가") 해결.
-- FEATURE_JOBSEEKER.md의 지원 현황/추천공고 API가 회사명·공고 제목·구직자 인사말을
-- 표시해야 하는데 기존 스키마엔 "이름"에 해당하는 컬럼이 전혀 없었다(카테고리/수치 필드뿐).
-- 기존 행이 이미 있는 테이블이라 NOT NULL 없이 nullable로 추가하고, API 응답 시
-- null이면 폴백 문구를 사용한다(각 Edge Function 참고).
alter table public.company_profiles add column company_name text;
alter table public.job_postings add column title text;
alter table public.users add column name text;

comment on column public.company_profiles.company_name is '기업명. 가입 폼에 필드 추가 전까지는 NULL 허용(2026-07-14 스키마 보강).';
comment on column public.job_postings.title is '공고 제목. 공고 등록 폼에 필드 추가 전까지는 NULL 허용(2026-07-14 스키마 보강).';
comment on column public.users.name is '표시용 이름(인사 배너 등). 가입 폼에 필드 추가 전까지는 NULL 허용(2026-07-14 스키마 보강).';
