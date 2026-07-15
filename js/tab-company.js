import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds } from './categories.js';
import { employmentTypeLabel } from './signup.js';
import { renderJobsPanel } from './tab-company-jobs.js';
import { renderTalentsPanel } from './tab-company-talents.js';
import { renderApplicantsPanel } from './tab-company-applicants.js';
import { resolveRegionFilterIds } from './utils.js';

/**
 * Tab1(기업) 콘텐츠 최상단 하이라이트.
 * PRD 5장 1단계(하드 필터)만 구현 — 스킬/직무/지역 소프트 스코어링은 이번 범위 밖.
 * 로그인한 기업의 position_category_id/region_category_id/필요 스킬을 하드 필터 조건으로,
 * is_region_public=true AND is_salary_public=true인 jobseeker_profiles만 조회한다.
 */
export async function renderCompanyHighlight(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">인재 정보를 불러오는 중입니다...</p>';

  let session;
  try {
    session = await getCurrentUserProfile();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">로그인 정보를 확인하지 못했습니다.</p>';
    return;
  }

  if (!session) {
    container.innerHTML = '<p class="empty-state">로그인 후 조건에 맞는 인재를 확인할 수 있습니다.</p>';
    return;
  }

  if (session.userType !== 'COMPANY' || !session.profile) {
    container.innerHTML = '<p class="empty-state">기업 회원만 이용할 수 있는 화면입니다.</p>';
    return;
  }

  const company = session.profile;

  try {
    const { data: skillRows, error: skillError } = await supabase
      .from('company_profile_skills')
      .select('skill_category_id')
      .eq('company_profile_id', company.id);
    if (skillError) throw skillError;
    const requiredSkillIds = (skillRows || []).map((row) => row.skill_category_id);

    let query = supabase
      .from('jobseeker_profiles')
      .select('id, career_years, desired_salary, desired_employment_type, desired_position_category_id, region_category_id')
      .eq('is_region_public', true)
      .eq('is_salary_public', true);

    if (company.position_category_id) {
      query = query.eq('desired_position_category_id', company.position_category_id);
    }
    if (company.region_category_id) {
      const regionIds = await resolveRegionFilterIds(company.region_category_id);
      query = query.in('region_category_id', regionIds);
    }

    const { data: candidateRows, error: candidateError } = await query;
    if (candidateError) throw candidateError;

    let candidates = candidateRows || [];

    if (requiredSkillIds.length > 0 && candidates.length > 0) {
      const candidateIds = candidates.map((c) => c.id);
      const { data: candidateSkillRows, error: candidateSkillError } = await supabase
        .from('jobseeker_profile_skills')
        .select('jobseeker_profile_id, skill_category_id')
        .in('jobseeker_profile_id', candidateIds);
      if (candidateSkillError) throw candidateSkillError;

      const skillsByCandidate = {};
      (candidateSkillRows || []).forEach((row) => {
        if (!skillsByCandidate[row.jobseeker_profile_id]) skillsByCandidate[row.jobseeker_profile_id] = [];
        skillsByCandidate[row.jobseeker_profile_id].push(row.skill_category_id);
      });

      candidates = candidates
        .filter((c) => (skillsByCandidate[c.id] || []).some((id) => requiredSkillIds.includes(id)))
        .map((c) => ({
          ...c,
          matchedSkillIds: (skillsByCandidate[c.id] || []).filter((id) => requiredSkillIds.includes(id)),
        }));
    }

    const [jobDemand, skillDemand] = await Promise.all([
      fetchSimilarIndustryJobDemand(company),
      fetchSimilarIndustrySkillDemand(company),
    ]);

    const categoryIds = new Set();
    candidates.forEach((c) => {
      categoryIds.add(c.desired_position_category_id);
      categoryIds.add(c.region_category_id);
      (c.matchedSkillIds || []).forEach((id) => categoryIds.add(id));
    });
    jobDemand.detailTags.forEach((row) => categoryIds.add(row.position_detail_category_id));
    skillDemand.forEach((row) => categoryIds.add(row.skill_category_id));
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));

    renderUI(container, candidates, categoryMap, jobDemand, skillDemand);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">인재 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

/**
 * 같은 직무(position_category_id)로 등록된 다른 기업들의 실제 채용 동향을 job_postings 기준으로
 * 집계한다(2차 테스트 피드백 1번 — company_profile_skills(가입 시 등록값, 실제 채용 활동과 괴리 가능)
 * 대신 실제 게시중(status='active')인 job_postings + job_posting_position_details를 사용한다).
 * 반환값: 활성 공고 총 건수, 직무 상세 상위 태그(최대 5개), 고용형태 분포, 경력대(3구간) 요약.
 */
async function fetchSimilarIndustryJobDemand(company) {
  const empty = { activeCount: 0, detailTags: [], employmentTypeCounts: {}, careerBuckets: [] };
  if (!company.position_category_id) return empty;

  const { data: peerRows, error: peerError } = await supabase
    .from('company_profiles')
    .select('id')
    .eq('position_category_id', company.position_category_id)
    .neq('id', company.id);
  if (peerError) throw peerError;

  const peerIds = (peerRows || []).map((row) => row.id);
  if (peerIds.length === 0) return empty;

  const { data: postingRows, error: postingError } = await supabase
    .from('job_postings')
    .select('id, employment_type, annual_from, annual_to')
    .in('company_profile_id', peerIds)
    .eq('status', 'active');
  if (postingError) throw postingError;

  const postings = postingRows || [];
  if (postings.length === 0) return empty;

  const postingIds = postings.map((p) => p.id);

  const { data: detailRows, error: detailError } = await supabase
    .from('job_posting_position_details')
    .select('position_detail_category_id')
    .in('job_posting_id', postingIds);
  if (detailError) throw detailError;

  const detailCounts = {};
  (detailRows || []).forEach((row) => {
    detailCounts[row.position_detail_category_id] = (detailCounts[row.position_detail_category_id] || 0) + 1;
  });
  const detailTags = Object.entries(detailCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([position_detail_category_id, count]) => ({ position_detail_category_id, count }));

  const employmentTypeCounts = {};
  postings.forEach((p) => {
    employmentTypeCounts[p.employment_type] = (employmentTypeCounts[p.employment_type] || 0) + 1;
  });

  // 경력대는 세분화하지 않고 3구간으로 단순화한다.
  const careerBucketDefs = [
    { label: '신입(0년)', test: (p) => p.annual_from === 0 },
    { label: '주니어(1~3년)', test: (p) => p.annual_from >= 1 && p.annual_from <= 3 },
    { label: '시니어(4년 이상)', test: (p) => p.annual_from >= 4 },
  ];
  const careerBuckets = careerBucketDefs
    .map(({ label, test }) => ({ label, count: postings.filter(test).length }))
    .filter((bucket) => bucket.count > 0);

  return {
    activeCount: postings.length, detailTags, employmentTypeCounts, careerBuckets,
  };
}

/**
 * 같은 직무(position_category_id)로 등록된 다른 기업들이 가입 시 등록한 필요 스킬
 * (company_profile_skills)을 집계한다 — "비슷한 스킬을 공유하는 타 기업들이 주로 보는 스킬"
 * 카드용(2차 테스트 피드백 1번, job_postings 기반 채용 동향 카드와는 별개로 분리 유지).
 */
async function fetchSimilarIndustrySkillDemand(company) {
  if (!company.position_category_id) return [];

  const { data: peerRows, error: peerError } = await supabase
    .from('company_profiles')
    .select('id')
    .eq('position_category_id', company.position_category_id)
    .neq('id', company.id);
  if (peerError) throw peerError;

  const peerIds = (peerRows || []).map((row) => row.id);
  if (peerIds.length === 0) return [];

  const { data: skillRows, error: skillError } = await supabase
    .from('company_profile_skills')
    .select('skill_category_id')
    .in('company_profile_id', peerIds);
  if (skillError) throw skillError;

  const counts = {};
  (skillRows || []).forEach((row) => {
    counts[row.skill_category_id] = (counts[row.skill_category_id] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill_category_id, company_count]) => ({ skill_category_id, company_count }));
}

function renderUI(container, candidates, categoryMap, jobDemand, skillDemand) {
  const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');
  const { activeCount, detailTags, employmentTypeCounts, careerBuckets } = jobDemand;

  const detailTagsHtml = detailTags.length > 0
    ? `<div class="tag-row">${detailTags.map((row) => `<span class="tag">${title(row.position_detail_category_id)} · ${row.count}건</span>`).join('')}</div>`
    : '';

  // 고용형태·경력대 요약을 한 줄로 합쳐 카드 세로 길이를 줄인다(피드백 5차 3번 — 공간 최적화).
  const jobSummary = [
    ...Object.entries(employmentTypeCounts).map(([type, count]) => `${employmentTypeLabel(type)} ${count}건`),
    ...careerBuckets.map((bucket) => `${bucket.label} ${bucket.count}건`),
  ].join(' · ');

  const jobDemandHtml = activeCount > 0
    ? `
      <p class="stat-card__value">${activeCount}건</p>
      ${detailTagsHtml}
      ${jobSummary ? `<p class="stat-card__comment">${jobSummary}</p>` : ''}
    `
    : '<p class="stat-card__comment">아직 비교할 만한 동일 직무 기업의 게시중인 공고가 없습니다.</p>';

  const skillDemandHtml = skillDemand.length > 0
    ? `<div class="tag-row">${skillDemand.map((row) => `<span class="tag">${title(row.skill_category_id)} · ${row.company_count}곳</span>`).join('')}</div>`
    : '<p class="stat-card__comment">아직 비교할 만한 동일 직무 기업의 등록된 필요 스킬이 없습니다.</p>';

  const bannerHtml = `
    <div class="greeting-banner">
      <p class="greeting-banner__title">회원님께 어울리는 추천 정보</p>
      <div class="greeting-banner__stats">
        <div class="stat-card">
          <p class="stat-card__label">조건에 맞는 인재</p>
          <p class="stat-card__value">${candidates.length}명</p>
          <p class="stat-card__comment">직무 · 지역 · 필요 스킬 기준</p>
        </div>
        <div class="stat-card">
          <p class="stat-card__label">비슷한 직종 기업들의 인기 스킬</p>
          ${skillDemandHtml}
        </div>
        <div class="stat-card">
          <p class="stat-card__label">비슷한 직종 기업들의 채용 동향</p>
          ${jobDemandHtml}
        </div>
      </div>
    </div>
  `;

  const bodyHtml = candidates.length === 0
    ? '<p class="empty-state">현재 조건에 맞는 공개 인재가 없습니다. 조건을 넓혀보세요.</p>'
    : `<div class="candidate-grid">
        ${candidates.map((c) => `
          <article class="card">
            <h3 class="card__title">${title(c.desired_position_category_id)} · 경력 ${c.career_years}년</h3>
            <p class="card__meta">${title(c.region_category_id)} · ${employmentTypeLabel(c.desired_employment_type)}</p>
            <p class="card__meta">희망연봉 ${c.desired_salary != null ? `${c.desired_salary}만원` : '비공개'}</p>
            ${(c.matchedSkillIds && c.matchedSkillIds.length > 0)
              ? `<div class="tag-row">${c.matchedSkillIds.map((id) => `<span class="tag">${title(id)}</span>`).join('')}</div>`
              : ''}
          </article>
        `).join('')}
      </div>`;

  container.innerHTML = bannerHtml + bodyHtml;
}

// --- 서브탭 오케스트레이션(공고 관리 / 인재 검색 / 지원자 관리) ---
// 위 renderCompanyHighlight()는 기존 하드필터 하이라이트 위젯(Supabase 직접 조회)을 그대로 유지하고,
// 아래 서브탭들은 새 FastAPI 백엔드(backend/app, js/api-client.js)를 호출하는 실제 관리 화면이다.

const SUBTAB_PANELS = {
  jobs: { render: renderJobsPanel, elId: 'company-sub-jobs' },
  talents: { render: renderTalentsPanel, elId: 'company-sub-talents' },
  applicants: { render: renderApplicantsPanel, elId: 'company-sub-applicants' },
};

let companySubtabsBound = false;

export function initCompanySubtabs() {
  const nav = document.getElementById('company-subtabs');
  if (!nav) return;

  function activate(name) {
    nav.querySelectorAll('.subtab').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.subtab === name));
    });
    Object.entries(SUBTAB_PANELS).forEach(([key, { elId }]) => {
      const el = document.getElementById(elId);
      if (el) el.hidden = key !== name;
    });
    const target = SUBTAB_PANELS[name];
    if (target) {
      target.render(document.getElementById(target.elId));
    }
  }

  if (!companySubtabsBound) {
    nav.querySelectorAll('.subtab').forEach((btn) => {
      btn.addEventListener('click', () => activate(btn.dataset.subtab));
    });
    companySubtabsBound = true;
  }

  const current = nav.querySelector('.subtab[aria-selected="true"]')?.dataset.subtab || 'jobs';
  activate(current);
}
