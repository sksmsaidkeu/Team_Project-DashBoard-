import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds } from './categories.js';
import { employmentTypeLabel } from './signup.js';
import { renderJobsPanel } from './tab-company-jobs.js';
import { renderTalentsPanel } from './tab-company-talents.js';
import { renderApplicantsPanel } from './tab-company-applicants.js';

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
      query = query.eq('region_category_id', company.region_category_id);
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

    const categoryIds = new Set();
    candidates.forEach((c) => {
      categoryIds.add(c.desired_position_category_id);
      categoryIds.add(c.region_category_id);
      (c.matchedSkillIds || []).forEach((id) => categoryIds.add(id));
    });
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));

    renderUI(container, candidates, categoryMap);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">인재 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

function renderUI(container, candidates, categoryMap) {
  const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');

  const bannerHtml = `
    <div class="greeting-banner">
      <p class="greeting-banner__title">이번 주 조건에 맞는 인재 현황입니다</p>
      <div class="stat-card">
        <p class="stat-card__label">조건에 맞는 인재</p>
        <p class="stat-card__value">${candidates.length}명</p>
        <p class="stat-card__comment">등록하신 직무 · 지역 · 필요 스킬 기준 하드 필터 결과입니다</p>
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
