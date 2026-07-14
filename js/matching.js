import { supabase } from './supabaseClient.js';
import { fetchCategoriesByIds, resolvePositionGroupId } from './categories.js';

/**
 * 기업<->구직자 매칭 파이프라인 공용 헬퍼 (REFACT.md P0-1/P0-2).
 * js/tab-main.js의 fetchCompanyHighlightCandidates()/fetchJobseekerHighlightMatches()에서
 * 순수 추출한 것 — 하드 필터 로직/쿼리 자체는 바꾸지 않았다. `limit`으로 기업/구직자 탭의
 * "전체 목록" 용도와 메인 탭의 "하이라이트 N개" 용도 차이를 흡수한다.
 * PRD 5장 소프트 스코어링을 도입할 때 이 파일 한 곳만 고치면 되도록 하는 것이 목적.
 */

/**
 * company_profiles 행을 id 목록으로 일괄 조회해 { [id]: row } 맵으로 반환한다.
 */
export async function fetchCompaniesByIds(companyIds) {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from('company_profiles')
    .select('id, industry_category_id, region_category_id')
    .in('id', uniqueIds);
  if (error) throw error;
  const map = {};
  (data || []).forEach((c) => { map[c.id] = c; });
  return map;
}

/**
 * 공고 목록에 필요한 카테고리(직군/업종)를 한 번에 조회해 title 맵을 만든다.
 */
export async function buildJobCategoryMap(postings, companyMap) {
  const ids = new Set();
  postings.forEach((p) => {
    ids.add(p.position_category_id);
    const company = companyMap[p.company_profile_id];
    if (company) ids.add(company.industry_category_id);
  });
  return fetchCategoriesByIds(Array.from(ids));
}

/**
 * 구직자 -> 공고 매칭 (하드 필터).
 * @param {object} jobseeker - jobseeker_profiles 행. id/desired_position_category_id/
 *   desired_employment_type/region_category_id 필드를 사용한다.
 * @param {number} limit - 반환할 공고 최대 건수.
 * @returns {Promise<{postings: object[], categoryMap: object, companyMap: object}>}
 */
export async function fetchMatchingPostings(jobseeker, limit) {
  const { data: skillRows, error: skillError } = await supabase
    .from('jobseeker_profile_skills')
    .select('skill_category_id')
    .eq('jobseeker_profile_id', jobseeker.id);
  if (skillError) throw skillError;
  const mySkillIds = (skillRows || []).map((row) => row.skill_category_id);

  const positionGroupId = await resolvePositionGroupId(jobseeker.desired_position_category_id);

  let query = supabase
    .from('job_postings')
    .select('id, company_profile_id, position_category_id, employment_type, annual_from, annual_to, status, posted_at')
    .eq('status', 'active')
    .order('posted_at', { ascending: false });

  if (positionGroupId) query = query.eq('position_category_id', positionGroupId);
  if (jobseeker.desired_employment_type) query = query.eq('employment_type', jobseeker.desired_employment_type);

  const { data: postingRows, error: postingError } = await query;
  if (postingError) throw postingError;

  let postings = postingRows || [];
  const companyMap = await fetchCompaniesByIds(postings.map((p) => p.company_profile_id));

  if (jobseeker.region_category_id) {
    postings = postings.filter((p) => {
      const company = companyMap[p.company_profile_id];
      return company && company.region_category_id === jobseeker.region_category_id;
    });
  }

  if (mySkillIds.length > 0 && postings.length > 0) {
    const companyIds = Array.from(new Set(postings.map((p) => p.company_profile_id)));
    const { data: companySkillRows, error: companySkillError } = await supabase
      .from('company_profile_skills')
      .select('company_profile_id, skill_category_id')
      .in('company_profile_id', companyIds);
    if (companySkillError) throw companySkillError;

    const companySkillMap = {};
    (companySkillRows || []).forEach((row) => {
      if (!companySkillMap[row.company_profile_id]) companySkillMap[row.company_profile_id] = [];
      companySkillMap[row.company_profile_id].push(row.skill_category_id);
    });

    postings = postings.filter((p) => (companySkillMap[p.company_profile_id] || []).some((id) => mySkillIds.includes(id)));
  }

  postings = postings.slice(0, limit);
  const categoryMap = await buildJobCategoryMap(postings, companyMap);
  return { postings, categoryMap, companyMap };
}

/**
 * 기업 -> 구직자 매칭 (하드 필터).
 * @param {object} company - company_profiles 행. id/position_category_id/region_category_id 필드를 사용한다.
 * @param {number} limit - 반환할 인재 최대 건수.
 * @returns {Promise<{candidates: object[], categoryMap: object}>}
 */
export async function fetchMatchingJobseekers(company, limit) {
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

  if (company.position_category_id) query = query.eq('desired_position_category_id', company.position_category_id);
  if (company.region_category_id) query = query.eq('region_category_id', company.region_category_id);

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
      .map((c) => ({ ...c, matchedSkillIds: (skillsByCandidate[c.id] || []).filter((id) => requiredSkillIds.includes(id)) }));
  }

  candidates = candidates.slice(0, limit);

  const categoryIds = new Set();
  candidates.forEach((c) => {
    categoryIds.add(c.desired_position_category_id);
    categoryIds.add(c.region_category_id);
    (c.matchedSkillIds || []).forEach((id) => categoryIds.add(id));
  });
  const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));

  return { candidates, categoryMap };
}
