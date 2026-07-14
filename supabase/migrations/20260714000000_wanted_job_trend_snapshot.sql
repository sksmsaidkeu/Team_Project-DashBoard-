-- 원티드(Wanted) 실 라이브 채용공고 기반 "실시간 원티드 채용 동향" 스냅샷 테이블.
-- 메인 탭의 기존 "채용 트렌드"(우리 자체 job_postings 테이블 기준, 20260713120000/130000
-- 마이그레이션의 job_postings)와는 별개의 지표다 — 혼동 방지를 위해 테이블명도 명시적으로
-- wanted_ 접두사를 붙였다. 데이터는 scripts/fetch_wanted_trend.py가 원티드 GET /jobs(v1,
-- openapi.json 상 v2 권장/deprecated 표시됐으나 이 저장소엔 v2 스펙이 없어 v1 사용)를
-- 페이지네이션 호출해 status='active' 공고를 category_tags.parent_tag(직군) 기준으로
-- 집계한 뒤 service_role 키로 upsert한다.
--
-- on_conflict 키를 (tag_id, snapshot_at)로 잡은 이유는 스크립트 상단 주석 참고: 재실행마다
-- 새 snapshot_at으로 스냅샷을 계속 쌓아 이력을 보존하면서, 프론트는
--   SELECT * FROM wanted_job_trend_snapshot
--   WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM wanted_job_trend_snapshot)
--   ORDER BY job_count DESC;
-- 로 "가장 최근 스냅샷 기준 랭킹"만 조회하면 된다.

create table public.wanted_job_trend_snapshot (
  id uuid primary key default gen_random_uuid(),
  tag_id integer not null,
  title text not null,
  job_count integer not null check (job_count >= 0),
  snapshot_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tag_id, snapshot_at)
);

comment on table public.wanted_job_trend_snapshot is
  '원티드 GET /jobs(v1) 실 라이브 공고를 status=active 기준으로 category_tags.parent_tag(직군)별 '
  '건수 집계한 스냅샷. 자체 job_postings 기반 "채용 트렌드"와는 다른 지표(scripts/fetch_wanted_trend.py 참고).';

-- 최신 스냅샷 조회(MAX(snapshot_at)) 및 랭킹 정렬(job_count) 성능 보강.
create index idx_wanted_job_trend_snapshot_snapshot_at
  on public.wanted_job_trend_snapshot (snapshot_at desc);
create index idx_wanted_job_trend_snapshot_tag_id
  on public.wanted_job_trend_snapshot (tag_id);

-- RLS: 20260713130000_rls_policies.sql의 categories 테이블과 동일한 원칙 —
-- 시장 정보라 공개 SELECT(anon 포함), 쓰기 정책은 두지 않아 anon/authenticated 모두 차단하고
-- service_role 키(RLS 우회)로만 스냅샷을 반영한다(scripts/fetch_wanted_trend.py 전용).
alter table public.wanted_job_trend_snapshot enable row level security;

create policy "wanted_job_trend_snapshot_select_public" on public.wanted_job_trend_snapshot
  for select using (true);
