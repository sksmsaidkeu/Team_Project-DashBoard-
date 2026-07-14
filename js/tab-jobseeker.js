import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds, fetchCategoryById } from './categories.js';
import { employmentTypeLabel } from './signup.js';

/**
 * ⚠️ 임시 프리뷰 구현 — jobseeker 브랜치 담당자가 자유롭게 재설계/교체해도 됩니다.
 * 초기 스캐폴드 단계에서 만들어진 것으로, 하드 필터 공고 매칭 카드만 보여줄 뿐
 * Tab2의 정식 기능(기업 정보, 지원 현황 등)은 포함하지 않습니다.
 * 아래 쿼리 로직은 js/matching.js의 fetchMatchingPostings(jobseeker, limit)로 공용 추출되었고,
 * resolvePositionGroupId()도 js/categories.js로 이전되었습니다(REFACT.md P0-2, common 브랜치 작업).
 * 재설계 시 이 공용 함수들로 교체할지 common 브랜치 담당자와 조율하세요. (README.md 참고)
 *
 * Tab2(구직자) 콘텐츠 최상단 하이라이트.
 * PRD 5장 1단계(하드 필터)만 구현 — 스킬/직무/지역 소프트 스코어링은 이번 범위 밖.
 * 로그인한 구직자의 desired_position_category_id/region_category_id/보유 스킬/desired_employment_type을
 * 하드 필터 조건으로, status='active'인 job_postings만 조회한다.
 */
export async function renderJobseekerHighlight(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">추천 공고를 불러오는 중입니다...</p>';

  let session;
  try {
    session = await getCurrentUserProfile();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">로그인 정보를 확인하지 못했습니다.</p>';
    return;
  }

  if (!session) {
    container.innerHTML = '<p class="empty-state">로그인 후 추천 공고를 확인할 수 있습니다.</p>';
    return;
  }

  if (session.userType !== 'JOBSEEKER' || !session.profile) {
    container.innerHTML = '<p class="empty-state">구직자 회원만 이용할 수 있는 화면입니다.</p>';
    return;
  }

  const jobseeker = session.profile;

  try {
    const { data: skillRows, error: skillError } = await supabase
      .from('jobseeker_profile_skills')
      .select('skill_category_id')
      .eq('jobseeker_profile_id', jobseeker.id);
    if (skillError) throw skillError;
    const mySkillIds = (skillRows || []).map((row) => row.skill_category_id);

    // job_postings.position_category_id는 직군(depth 1)이므로(DB.md 3.8절),
    // 구직자의 desired_position_category_id(직무, depth 2 가능)를 직군 레벨로 환산해 비교한다.
    const positionGroupId = await resolvePositionGroupId(jobseeker.desired_position_category_id);

    let query = supabase
      .from('job_postings')
      .select('id, company_profile_id, position_category_id, employment_type, annual_from, annual_to, status')
      .eq('status', 'active');

    if (positionGroupId) {
      query = query.eq('position_category_id', positionGroupId);
    }
    if (jobseeker.desired_employment_type) {
      query = query.eq('employment_type', jobseeker.desired_employment_type);
    }

    const { data: postingRows, error: postingError } = await query;
    if (postingError) throw postingError;

    let postings = postingRows || [];

    const companyIds = Array.from(new Set(postings.map((p) => p.company_profile_id).filter(Boolean)));
    const companyMap = {};
    const companySkillMap = {};

    if (companyIds.length > 0) {
      const { data: companies, error: companyError } = await supabase
        .from('company_profiles')
        .select('id, industry_category_id, region_category_id')
        .in('id', companyIds);
      if (companyError) throw companyError;
      (companies || []).forEach((c) => { companyMap[c.id] = c; });

      const { data: companySkillRows, error: companySkillError } = await supabase
        .from('company_profile_skills')
        .select('company_profile_id, skill_category_id')
        .in('company_profile_id', companyIds);
      if (companySkillError) throw companySkillError;
      (companySkillRows || []).forEach((row) => {
        if (!companySkillMap[row.company_profile_id]) companySkillMap[row.company_profile_id] = [];
        companySkillMap[row.company_profile_id].push(row.skill_category_id);
      });
    }

    if (jobseeker.region_category_id) {
      postings = postings.filter((p) => {
        const company = companyMap[p.company_profile_id];
        return company && company.region_category_id === jobseeker.region_category_id;
      });
    }

    if (mySkillIds.length > 0) {
      postings = postings.filter((p) => {
        const companySkills = companySkillMap[p.company_profile_id] || [];
        return companySkills.some((id) => mySkillIds.includes(id));
      });
    }

    const categoryIds = new Set();
    postings.forEach((p) => {
      categoryIds.add(p.position_category_id);
      const company = companyMap[p.company_profile_id];
      if (company) categoryIds.add(company.industry_category_id);
    });
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));

    renderUI(container, postings, categoryMap, companyMap);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">추천 공고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

async function resolvePositionGroupId(desiredPositionCategoryId) {
  if (!desiredPositionCategoryId) return null;
  const category = await fetchCategoryById(desiredPositionCategoryId);
  if (!category) return null;
  if (category.depth <= 1) return category.id;
  return category.parent_id;
}

function renderUI(container, postings, categoryMap, companyMap) {
  const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');

  const bannerHtml = `
    <div class="greeting-banner">
      <p class="greeting-banner__title">회원님을 위한 추천 공고예요</p>
      <span class="greeting-banner__chip">추천 공고 ${postings.length}건 · 조건 일치</span>
    </div>
  `;

  const bodyHtml = postings.length === 0
    ? '<p class="empty-state">현재 조건에 맞는 진행 중인 공고가 없습니다. 조건을 넓혀보세요.</p>'
    : `<div class="candidate-grid">
        ${postings.map((p) => {
          const company = companyMap[p.company_profile_id];
          return `
          <article class="card job-card">
            <div class="match-score match-score--matched" aria-hidden="true">
              <span class="match-score__value">일치</span>
            </div>
            <span class="sr-only">하드 필터 조건에 일치하는 공고</span>
            <div class="job-card__body">
              <h3 class="card__title">${title(p.position_category_id)}</h3>
              <p class="card__meta">${company ? title(company.industry_category_id) : '-'} · ${employmentTypeLabel(p.employment_type)}</p>
              <p class="card__meta">경력 ${p.annual_from}${p.annual_to != null ? `~${p.annual_to}` : '+'}년</p>
            </div>
          </article>
        `;
        }).join('')}
      </div>`;

  container.innerHTML = bannerHtml + bodyHtml;
}
