import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds, fetchTopCategories, fetchChildCategories } from './categories.js';
import { employmentTypeLabel } from './signup.js';
import { fetchCompaniesByIds, buildJobCategoryMap, fetchMatchingPostings, fetchMatchingJobseekers } from './matching.js';
import { escapeHtml } from './utils.js';

/**
 * 메인 탭(공통 셸의 중립 진입점) 데이터 조회 + 렌더링.
 * PRD 6장 IA: "메인 - 통합 검색, 추천 하이라이트, 채용 뉴스".
 * 편향 금지 원칙: 로그인 안 한 방문자에게 기업/구직자 어느 한쪽 성격의 콘텐츠만 보여주지 않는다.
 */

const MAX_HIGHLIGHT = 8;
const MAX_RECENT_JOBS = 5;
const MAX_RECENT_TALENT = 5;

/* ------------------------------------------------------------------ */
/* 0. 공통 유틸                                                        */
/* ------------------------------------------------------------------ */

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (err) {
    return '-';
  }
}

/**
 * 배열을 keyFn 결과값 기준으로 그룹핑해 등장 횟수를 센다.
 * 채용 트렌드/스킬 랭킹/스킬 조합 집계(6절)에서 공통으로 사용하는 client-side group-by 유틸.
 */
function countBy(array, keyFn) {
  const counts = new Map();
  (array || []).forEach((item) => {
    const key = keyFn(item);
    if (key == null) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

/**
 * 채용공고 카드 1건 렌더링.
 * `scoreLabel`이 주어지면 개인화된 매칭 결과(.match-score--matched), 없으면 중립 카드(스코어 링 생략).
 */
function jobPostingCardHtml(posting, categoryMap, companyMap, { scoreLabel, neutralBadge } = {}) {
  const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');
  const company = companyMap[posting.company_profile_id];

  const scoreHtml = scoreLabel
    ? `<div class="match-score match-score--matched" aria-hidden="true"><span class="match-score__value">${scoreLabel}</span></div>
       <span class="sr-only">하드 필터 조건에 일치하는 공고</span>`
    : '';

  const badgeHtml = neutralBadge ? `<span class="tag">${neutralBadge}</span>` : '';

  return `
    <article class="card job-card">
      ${scoreHtml}
      <div class="job-card__body">
        ${badgeHtml}
        <h3 class="card__title">${escapeHtml(title(posting.position_category_id))}</h3>
        <p class="card__meta">${escapeHtml(company ? title(company.industry_category_id) : '-')} · ${escapeHtml(employmentTypeLabel(posting.employment_type))}</p>
        <p class="card__meta">경력 ${posting.annual_from}${posting.annual_to != null ? `~${posting.annual_to}` : '+'}년</p>
        <p class="card__meta">게시일 ${escapeHtml(formatDate(posting.posted_at))}</p>
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------------ */
/* 1. 추천 하이라이트                                                  */
/* ------------------------------------------------------------------ */

async function fetchNeutralLatestJobs(limit) {
  const { data: postingRows, error } = await supabase
    .from('job_postings')
    .select('id, company_profile_id, position_category_id, employment_type, annual_from, annual_to, status, posted_at')
    .eq('status', 'active')
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const postings = postingRows || [];
  const companyMap = await fetchCompaniesByIds(postings.map((p) => p.company_profile_id));
  const categoryMap = await buildJobCategoryMap(postings, companyMap);
  return { postings, categoryMap, companyMap };
}

function candidateCardHtml(candidate, categoryMap) {
  const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');
  return `
    <article class="card">
      <div class="match-score match-score--matched" aria-hidden="true"><span class="match-score__value">일치</span></div>
      <span class="sr-only">하드 필터 조건에 일치하는 인재</span>
      <h3 class="card__title">${escapeHtml(title(candidate.desired_position_category_id))} · 경력 ${candidate.career_years}년</h3>
      <p class="card__meta">${escapeHtml(title(candidate.region_category_id))} · ${escapeHtml(employmentTypeLabel(candidate.desired_employment_type))}</p>
      <p class="card__meta">희망연봉 ${candidate.desired_salary != null ? `${candidate.desired_salary}만원` : '비공개'}</p>
      ${(candidate.matchedSkillIds && candidate.matchedSkillIds.length > 0)
        ? `<div class="tag-row">${candidate.matchedSkillIds.map((id) => `<span class="tag">${escapeHtml(title(id))}</span>`).join('')}</div>`
        : ''}
    </article>
  `;
}

/**
 * 추천 하이라이트 캐러셀.
 * - JOBSEEKER 로그인: 하드 필터로 매칭된 공고를 .match-score 카드로.
 * - COMPANY 로그인: 하드 필터로 매칭된 인재 미리보기 카드로.
 * - 비로그인: 편향 없는 최신 공고(스코어 링 생략, "최신 공고" 중립 뱃지)로 폴백.
 */
export async function renderMainHighlight(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">추천 정보를 불러오는 중입니다...</p>';

  try {
    const session = await getCurrentUserProfile();

    if (session && session.userType === 'JOBSEEKER' && session.profile) {
      const { postings, categoryMap, companyMap } = await fetchMatchingPostings(session.profile, MAX_HIGHLIGHT);
      if (postings.length === 0) {
        container.innerHTML = '<p class="empty-state">현재 조건에 맞는 추천 공고가 없습니다. 프로필 조건을 넓혀보세요.</p>';
        return;
      }
      container.innerHTML = postings.map((p) => jobPostingCardHtml(p, categoryMap, companyMap, { scoreLabel: '일치' })).join('');
      return;
    }

    if (session && session.userType === 'COMPANY' && session.profile) {
      const { candidates, categoryMap } = await fetchMatchingJobseekers(session.profile, MAX_HIGHLIGHT);
      if (candidates.length === 0) {
        container.innerHTML = '<p class="empty-state">현재 조건에 맞는 공개 인재가 없습니다. 조건을 넓혀보세요.</p>';
        return;
      }
      container.innerHTML = candidates.map((c) => candidateCardHtml(c, categoryMap)).join('');
      return;
    }

    // 비로그인(또는 프로필 미완성): 개인화 불가 -> 편향 없는 최신 공고 폴백
    const { postings, categoryMap, companyMap } = await fetchNeutralLatestJobs(MAX_HIGHLIGHT);
    if (postings.length === 0) {
      container.innerHTML = '<p class="empty-state">현재 진행 중인 공고가 없습니다.</p>';
      return;
    }
    container.innerHTML = postings.map((p) => jobPostingCardHtml(p, categoryMap, companyMap, { neutralBadge: '최신 공고' })).join('');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">추천 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

/* ------------------------------------------------------------------ */
/* 2. 최근 공고 (+ 검색 결과 렌더링에도 재사용)                        */
/* ------------------------------------------------------------------ */

function renderJobList(container, postings, categoryMap, companyMap, emptyMessage) {
  if (postings.length === 0) {
    container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }
  // main-recent-jobs는 2열 recent-section 안의 절반 폭 컬럼이라 candidate-grid(3열)를 쓰지 않고
  // 부모 .recent-section__col의 flex-column 레이아웃에 맞춰 카드를 그대로 쌓는다.
  container.innerHTML = postings.map((p) => jobPostingCardHtml(p, categoryMap, companyMap)).join('');
}

/**
 * 최근 공고: status='active'인 공고를 posted_at desc로 최대 5건. 로그인 여부와 무관하게 항상 공개.
 */
export async function renderRecentJobs(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">최근 공고를 불러오는 중입니다...</p>';

  try {
    const { postings, categoryMap, companyMap } = await fetchNeutralLatestJobs(MAX_RECENT_JOBS);
    renderJobList(container, postings, categoryMap, companyMap, '현재 등록된 공고가 없습니다.');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">최근 공고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

/* ------------------------------------------------------------------ */
/* 3. 최근 인재                                                        */
/* ------------------------------------------------------------------ */

/**
 * 최근 인재: is_region_public=true(연봉 노출 시 is_salary_public=true도 함께 확인)인
 * jobseeker_profiles를 created_at desc로 최대 5건. 개인 식별정보(email 등)는 노출하지 않는다.
 */
export async function renderRecentTalent(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">최근 인재 정보를 불러오는 중입니다...</p>';

  try {
    const { data: rows, error } = await supabase
      .from('jobseeker_profiles')
      .select('id, career_years, desired_salary, desired_employment_type, desired_position_category_id, region_category_id, is_salary_public, created_at')
      .eq('is_region_public', true)
      .order('created_at', { ascending: false })
      .limit(MAX_RECENT_TALENT);
    if (error) throw error;

    const candidates = rows || [];
    if (candidates.length === 0) {
      container.innerHTML = '<p class="empty-state">현재 공개된 인재 정보가 없습니다.</p>';
      return;
    }

    const categoryIds = new Set();
    candidates.forEach((c) => {
      categoryIds.add(c.desired_position_category_id);
      categoryIds.add(c.region_category_id);
    });
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));
    const title = (id) => (categoryMap[id] ? categoryMap[id].title : '-');

    // main-recent-talent도 recent-section 절반 폭 컬럼이므로 candidate-grid(3열) 대신 세로 스택으로 렌더링한다.
    container.innerHTML = candidates.map((c) => `
      <article class="card">
        <h3 class="card__title">${escapeHtml(title(c.desired_position_category_id))} · 경력 ${c.career_years}년</h3>
        <p class="card__meta">${escapeHtml(title(c.region_category_id))} · ${escapeHtml(employmentTypeLabel(c.desired_employment_type))}</p>
        ${c.is_salary_public
          ? `<p class="card__meta">희망연봉 ${c.desired_salary != null ? `${c.desired_salary}만원` : '비공개'}</p>`
          : ''}
      </article>
    `).join('');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">최근 인재 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

/* ------------------------------------------------------------------ */
/* 4. 채용 뉴스 (PRD 8장: 임시 수동 큐레이션, 추후 실제 뉴스 소스로 교체) */
/* ------------------------------------------------------------------ */

// jobseeker-dashboard.js(Tab2)도 이 큐레이션 목록을 fetchJobNews()의 폴백으로 재사용한다
// (2026-07-16) — 같은 뉴스 소스/폴백 패턴을 두 화면이 공유한다.
export const JOB_NEWS_ITEMS = [
  {
    title: '2026년 상반기 IT 개발직군 채용, 전년 대비 소폭 회복세',
    date: '2026-07-01',
    summary: '주요 플랫폼·SI 기업을 중심으로 백엔드·데이터 엔지니어 채용 공고가 늘며 개발 직군 채용 심리가 완만하게 개선되고 있습니다.',
  },
  {
    title: '스타트업 채용, "직무 적합성" 검증 강화 추세',
    date: '2026-06-24',
    summary: '초기 스타트업들이 이력서 스펙보다 실무 과제·포트폴리오 기반 검증을 우선하는 채용 프로세스를 늘리고 있습니다.',
  },
  {
    title: '경력 3~5년차 이직 수요 증가, 희망 연봉 상승폭은 둔화',
    date: '2026-06-15',
    summary: '중간 경력자의 이직 문의는 늘었지만, 기업들의 연봉 인상폭 제시는 지난해보다 보수적으로 나타났습니다.',
  },
  {
    title: '원격/하이브리드 근무 조건, 구직자 선호 요인 상위권 유지',
    date: '2026-06-05',
    summary: '근무 형태 유연성이 연봉 다음으로 중요한 지원 결정 요인으로 조사되며 관련 공고 문구가 늘고 있습니다.',
  },
  {
    title: '중소·중견기업, 채용 플랫폼 활용한 상시 채용 전환 확대',
    date: '2026-05-28',
    summary: '공채 대신 직무별 상시 채용으로 전환하는 중소·중견기업이 늘면서 카테고리 기반 매칭 수요가 커지고 있습니다.',
  },
];

/**
 * news.js가 반환할 수 있는 여러 형태(정적 큐레이션 항목 또는 외부 뉴스 API 응답)를
 * 공통 카드 형태로 정규화한다. 알 수 없는 필드명은 합리적인 동의어로 폴백한다.
 */
function normalizeNewsItem(item) {
  return {
    title: item.title || '(제목 없음)',
    date: item.date || item.publishedAt || item.pubDate || item.published_at || null,
    summary: item.summary || item.description || item.content || '',
    url: item.url || item.link || null,
  };
}

function renderNewsItems(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-state">등록된 채용 뉴스가 없습니다.</p>';
    return;
  }

  // news-section은 UI/UX가 세로 카드 리스트(flex-column)로 설계했으므로 candidate-grid(3열)를 쓰지 않는다.
  container.innerHTML = items.map((raw) => {
    const item = normalizeNewsItem(raw);
    // open redirect/스킴 인젝션 방지: http(s)가 아닌 스킴(예: javascript:)은 링크를 만들지 않고 텍스트로 폴백한다.
    const isSafeUrl = typeof item.url === 'string' && /^https?:\/\//i.test(item.url);
    const titleHtml = isSafeUrl
      ? `<a href="${encodeURI(item.url)}" target="_blank" rel="noopener noreferrer" class="card__title news-link">${escapeHtml(item.title)}</a>`
      : `<h3 class="card__title">${escapeHtml(item.title)}</h3>`;
    return `
    <article class="card">
      <p class="card__meta">${escapeHtml(formatDate(item.date))}</p>
      ${titleHtml}
      <p class="card__meta">${escapeHtml(item.summary)}</p>
    </article>
  `;
  }).join('');
}

/**
 * 채용 뉴스 렌더링. js/news.js(다른 에이전트 작성)의 fetchJobNews()가 있으면 그 결과를 사용하고,
 * 아직 없거나 실패하면 기존 정적 큐레이션(JOB_NEWS_ITEMS)으로 폴백한다.
 * js/news.js 연동 대기: 파일이 배포되면 동적 import가 성공해 자동으로 실제 뉴스로 전환된다.
 */
export async function renderJobNews(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">채용 뉴스를 불러오는 중입니다...</p>';

  try {
    const newsModule = await import('./news.js').catch(() => null);
    if (newsModule && typeof newsModule.fetchJobNews === 'function') {
      const items = await newsModule.fetchJobNews(JOB_NEWS_ITEMS);
      renderNewsItems(container, items && items.length > 0 ? items : JOB_NEWS_ITEMS);
      return;
    }
    renderNewsItems(container, JOB_NEWS_ITEMS);
  } catch (err) {
    console.error(err);
    renderNewsItems(container, JOB_NEWS_ITEMS);
  }
}

/* ------------------------------------------------------------------ */
/* 5. 통합 검색                                                        */
/* ------------------------------------------------------------------ */

/**
 * hero-search-region select는 fetchTopCategories('REGION')로 시도(depth 1)만 나열하는데,
 * company_profiles.region_category_id는 실제로는 시군구(depth 2, 시군구가 없으면 시도)가 들어있다
 * (backend/scripts/import_wanted_data.py의 _ensure_region_for_company 참고). 그래서 선택한 시도 id로
 * 그대로 eq 매칭하면 시군구가 채워진 대다수 기업을 놓쳐 검색 결과가 항상 비어 보이는 버그가 있었다
 * (2차 수정, 2026-07-15). 시도 id 자신 + 하위 시군구 + 그 하위 읍면동 id까지 모두 모아 in 매칭으로
 * 넓혀서 고친다.
 */
async function resolveRegionFilterIds(regionId) {
  const level2Rows = await fetchChildCategories(regionId);
  const ids = [regionId, ...level2Rows.map((r) => r.id)];
  const level3Lists = await Promise.all(level2Rows.map((r) => fetchChildCategories(r.id)));
  level3Lists.forEach((rows) => rows.forEach((r) => ids.push(r.id)));
  return ids;
}

/**
 * jobId(직무 select)/regionId(지역 select)는 job_postings/company_profiles 컬럼에 직접 걸고,
 * term(자유 텍스트)만 기존처럼 JOB/SKILL 카테고리 제목 매칭으로 처리한다(New.html 히어로 검색 반영, 2026-07-14).
 * 세 조건은 AND로 결합된다(select로 좁힌 뒤 텍스트로 더 좁히는 방식).
 */
async function searchJobPostingsByTerm(term, { jobId, regionId } = {}, limit = 20) {
  let companyIdsFromRegion = null;
  if (regionId) {
    const regionIds = await resolveRegionFilterIds(regionId);
    const { data: regionRows, error: regionError } = await supabase
      .from('company_profiles')
      .select('id')
      .in('region_category_id', regionIds);
    if (regionError) throw regionError;
    companyIdsFromRegion = (regionRows || []).map((r) => r.id);
    if (companyIdsFromRegion.length === 0) return [];
  }

  let query = supabase
    .from('job_postings')
    .select('id, company_profile_id, position_category_id, employment_type, annual_from, annual_to, status, posted_at')
    .eq('status', 'active')
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (jobId) query = query.eq('position_category_id', jobId);
  if (companyIdsFromRegion) query = query.in('company_profile_id', companyIdsFromRegion);

  if (term) {
    const { data: categoryRows, error: categoryError } = await supabase
      .from('categories')
      .select('id, title, category_type, depth, parent_id')
      .in('category_type', ['JOB', 'SKILL'])
      .ilike('title', `%${term}%`);
    if (categoryError) throw categoryError;

    const matched = categoryRows || [];
    const positionGroupIds = new Set();
    const skillIds = new Set();
    matched.forEach((row) => {
      if (row.category_type === 'JOB') {
        positionGroupIds.add(row.depth <= 1 ? row.id : row.parent_id);
      } else if (row.category_type === 'SKILL') {
        skillIds.add(row.id);
      }
    });

    let companyIdsFromSkills = [];
    if (skillIds.size > 0) {
      const { data: skillRows, error: skillError } = await supabase
        .from('company_profile_skills')
        .select('company_profile_id')
        .in('skill_category_id', Array.from(skillIds));
      if (skillError) throw skillError;
      companyIdsFromSkills = Array.from(new Set((skillRows || []).map((r) => r.company_profile_id)));
    }

    if (positionGroupIds.size === 0 && companyIdsFromSkills.length === 0) return [];

    const orParts = [];
    if (positionGroupIds.size > 0) orParts.push(`position_category_id.in.(${Array.from(positionGroupIds).join(',')})`);
    if (companyIdsFromSkills.length > 0) orParts.push(`company_profile_id.in.(${companyIdsFromSkills.join(',')})`);
    query = query.or(orParts.join(','));
  }

  const { data: postingRows, error: postingError } = await query;
  if (postingError) throw postingError;
  return postingRows || [];
}

function populateSelect(select, rows) {
  rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = row.title;
    select.appendChild(option);
  });
}

/**
 * 히어로 검색(직무/지역 select + 자유 텍스트) submit 핸들러를 연결한다. 앱 초기화 시 1회만 호출한다.
 */
export function initHeroSearch() {
  const form = document.getElementById('hero-search-form');
  const input = document.getElementById('hero-search-input');
  const jobSelect = document.getElementById('hero-search-job');
  const regionSelect = document.getElementById('hero-search-region');
  const resultsContainer = document.getElementById('main-recent-jobs');
  if (!form || !input) return;

  if (jobSelect) fetchTopCategories('JOB').then((rows) => populateSelect(jobSelect, rows));
  if (regionSelect) fetchTopCategories('REGION').then((rows) => populateSelect(regionSelect, rows));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!resultsContainer) return;

    const term = input.value.trim();
    const jobId = jobSelect?.value || null;
    const regionId = regionSelect?.value || null;

    if (!term && !jobId && !regionId) {
      renderRecentJobs(resultsContainer);
      return;
    }

    resultsContainer.innerHTML = '<p class="empty-state">검색 중입니다...</p>';

    try {
      const postings = await searchJobPostingsByTerm(term, { jobId, regionId });
      const companyMap = await fetchCompaniesByIds(postings.map((p) => p.company_profile_id));
      const categoryMap = await buildJobCategoryMap(postings, companyMap);
      renderJobList(resultsContainer, postings, categoryMap, companyMap, '조건에 맞는 검색 결과가 없습니다.');
    } catch (err) {
      console.error(err);
      resultsContainer.innerHTML = '<p class="empty-state">검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>';
    }
  });
}

/* ------------------------------------------------------------------ */
/* 6. 채용 트렌드 / 스킬 수요 랭킹 / 스킬 조합 분석 (PRD 7.1절, 시장 전체 통계)      */
/*    - 기업/구직자 어느 쪽에도 편향되지 않는 공개 집계 데이터. 개별 회사/구직자를    */
/*      특정하지 않고 카테고리 단위 집계 수치만 노출한다.                          */
/* ------------------------------------------------------------------ */

const MAX_TREND_ITEMS = 8;
const TREND_SAMPLE_LIMIT = 500;

const MAX_PIE_SLICES = 8; // 카테고리 색상 슬롯이 8개 고정이라 그 이상은 "기타"로 접는다.
const PIE_OTHER_LABEL = '기타';

/**
 * 랭킹 원형(파이) 차트 공통 렌더러. rankedItems: [{title, count, deltaText?, deltaColor?}, ...] 정렬된 배열.
 * 항목이 8개(MAX_PIE_SLICES, 고정 카테고리 색상 슬롯 수)를 넘으면 상위 7개 + "기타"로 접어
 * 색상을 8개 슬롯 밖으로 순환시키지 않는다. SVG 원(circle)의 stroke-dasharray를 슬라이스 길이만큼
 * 잘라 이어붙이는 방식으로 그린다(stroke-width=반지름 전체라 도넛이 아닌 꽉 찬 파이가 된다).
 * 색상만으로 구분하지 않도록 각 조각마다 제목·건수·비율을 항상 텍스트 범례로 함께 보여준다.
 */
function renderPieChart(container, rankedItems, emptyMessage, chartLabel) {
  if (!rankedItems || rankedItems.length === 0) {
    container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }

  let slices = rankedItems;
  if (slices.length > MAX_PIE_SLICES) {
    const kept = slices.slice(0, MAX_PIE_SLICES - 1);
    const otherCount = slices.slice(MAX_PIE_SLICES - 1).reduce((sum, item) => sum + item.count, 0);
    slices = [...kept, { title: PIE_OTHER_LABEL, count: otherCount }];
  }

  const total = slices.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }

  const size = 160;
  const center = size / 2;
  const radius = size / 4; // stroke-width을 size/2로 줘서 중심~바깥을 꽉 채운다(도넛이 아닌 파이).
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map(({ title, count }, index) => {
    const pct = (count / total) * 100;
    const dash = (pct / 100) * circumference;
    const circle = `
      <circle
        cx="${center}" cy="${center}" r="${radius}"
        fill="none" stroke="var(--series-${index + 1})" stroke-width="${size / 2}"
        stroke-dasharray="${dash} ${circumference - dash}"
        stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${center} ${center})"
      ><title>${escapeHtml(title)} — ${count}건 (${Math.round(pct)}%)</title></circle>
    `;
    offset += dash;
    return circle;
  }).join('');

  const legendItems = slices.map(({ title, count, deltaText, deltaColor }, index) => {
    const pct = Math.round((count / total) * 100);
    const deltaHtml = deltaText
      ? `<span class="card__meta" style="margin:0;color:${deltaColor};font-weight:600;">${escapeHtml(deltaText)}</span>`
      : '';
    return `
      <li class="pie-chart__legend-item">
        <span class="pie-chart__swatch" style="background: var(--series-${index + 1})" aria-hidden="true"></span>
        <span class="card__title" style="margin:0;">${escapeHtml(title)}</span>
        <span class="card__meta" style="margin:0;">${count}건 · ${pct}% ${deltaHtml}</span>
      </li>
    `;
  }).join('');

  container.innerHTML = `
    <div class="pie-chart">
      <svg class="pie-chart__svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(chartLabel || '')}">
        ${arcs}
      </svg>
      <ul class="pie-chart__legend">${legendItems}</ul>
    </div>
  `;
}

const TREND_DELTA_WINDOW_DAYS = 14;

/** posted_at으로부터 지난 일수. posted_at이 없으면 어느 창에도 안 걸리도록 Infinity. */
function daysSince(dateValue) {
  if (!dateValue) return Infinity;
  return (Date.now() - new Date(dateValue).getTime()) / 86400000;
}

/**
 * 최근 N일 게시 건수 대비 그 이전 N일 게시 건수의 증감률. posted_at 실측값 기반(가공 수치 아님).
 * 이전 구간이 0건이면 %가 무의미해(분모 0) "신규"로 표기하고, 두 구간 모두 0건이면 표시하지 않는다.
 */
function computeTrendDelta(postingsInCategory) {
  const recent = postingsInCategory.filter((p) => daysSince(p.posted_at) <= TREND_DELTA_WINDOW_DAYS).length;
  const prior = postingsInCategory.filter((p) => {
    const d = daysSince(p.posted_at);
    return d > TREND_DELTA_WINDOW_DAYS && d <= TREND_DELTA_WINDOW_DAYS * 2;
  }).length;

  if (recent === 0 && prior === 0) return { deltaText: null, deltaColor: null };
  if (prior === 0) return { deltaText: '▲ 신규', deltaColor: 'var(--accent-cool-strong)' };

  const pct = Math.round(((recent - prior) / prior) * 100);
  const up = pct >= 0;
  return {
    deltaText: `${up ? '▲' : '▼'} ${Math.abs(pct)}%`,
    deltaColor: up ? 'var(--accent-cool-strong)' : 'var(--negative-strong)',
  };
}

/**
 * 채용 트렌드: status='active'인 공고를 position_category_id(직군, depth 1)별로 집계해
 * 상위 랭킹을 파이차트로 렌더링한다(company+common 병합 1차 수정, 2026-07-15 — 한눈에 비중을
 * 보기 위해 막대에서 파이로 전환). 증감률(▲/▼)은 posted_at 기준 최근/직전 14일 비교 실측값
 * (New.html 반영, 2026-07-14) — 원티드 트렌드(스냅샷 집계라 개별 게시일 없음)에는 적용하지 않는다.
 */
export async function renderMainTrend(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">채용 트렌드를 불러오는 중입니다...</p>';

  try {
    const { data: rows, error } = await supabase
      .from('job_postings')
      .select('position_category_id, posted_at')
      .eq('status', 'active')
      .limit(TREND_SAMPLE_LIMIT);
    if (error) throw error;

    const postings = rows || [];
    if (postings.length === 0) {
      container.innerHTML = '<p class="empty-state">집계할 채용 공고 데이터가 없습니다.</p>';
      return;
    }

    const counts = countBy(postings, (p) => p.position_category_id);
    const topCounts = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TREND_ITEMS);

    const categoryMap = await fetchCategoriesByIds(topCounts.map(([id]) => id));
    const ranked = topCounts.map(([categoryId, count]) => {
      const postingsInCategory = postings.filter((p) => p.position_category_id === categoryId);
      return {
        title: categoryMap[categoryId] ? categoryMap[categoryId].title : '(알 수 없음)',
        count,
        ...computeTrendDelta(postingsInCategory),
      };
    });

    renderPieChart(container, ranked, '집계할 채용 공고 데이터가 없습니다.', '채용 트렌드 (직군별 활성 공고 비중)');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">채용 트렌드를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

/* ------------------------------------------------------------------ */
/* 6.1 원티드 실공고 트렌드 (wanted_job_trend_snapshot, 팀원 별도 마이그레이션)  */
/*    - 원티드 라이브 API를 스크립트로 스냅샷 수집해 채운 집계 테이블을 조회한다.  */
/*    - 마이그레이션/시딩이 아직 안 되어 있을 수 있으므로 테이블 부재도          */
/*      "정상적인 데이터 없음" 상태로 취급해 안내 문구를 보여준다.               */
/* ------------------------------------------------------------------ */

const MAX_WANTED_TREND_ITEMS = 8;
const WANTED_TREND_EMPTY_MESSAGE = '아직 원티드 트렌드 데이터가 없습니다. 팀 담당자가 scripts/fetch_wanted_trend.py를 실행하면 표시됩니다.';

/**
 * 원티드 실공고 트렌드: wanted_job_trend_snapshot에서 가장 최근 snapshot_at 시점의
 * 행을 job_count desc로 상위 8개 조회해 파이차트로 렌더링한다(2차 수정, 2026-07-15 — 다른
 * 시장 통계 3종과 함께 한눈에 비교할 수 있도록 막대에서 파이로 전환).
 * 테이블이 아직 배포되지 않은 경우(`relation does not exist` 등)도 정상적인 "데이터 없음" 상태로 다룬다.
 */
export async function renderWantedTrend(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">원티드 채용 트렌드를 불러오는 중입니다...</p>';

  try {
    const { data: latestRows, error: latestError } = await supabase
      .from('wanted_job_trend_snapshot')
      .select('snapshot_at')
      .order('snapshot_at', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;

    const latestSnapshotAt = latestRows && latestRows[0] ? latestRows[0].snapshot_at : null;
    if (!latestSnapshotAt) {
      container.innerHTML = `<p class="empty-state">${WANTED_TREND_EMPTY_MESSAGE}</p>`;
      return;
    }

    const { data: rows, error } = await supabase
      .from('wanted_job_trend_snapshot')
      .select('tag_id, title, job_count')
      .eq('snapshot_at', latestSnapshotAt)
      .order('job_count', { ascending: false })
      .limit(MAX_WANTED_TREND_ITEMS);
    if (error) throw error;

    const rows2 = rows || [];
    if (rows2.length === 0) {
      container.innerHTML = `<p class="empty-state">${WANTED_TREND_EMPTY_MESSAGE}</p>`;
      return;
    }

    const ranked = rows2.map((row) => ({ title: row.title || '(알 수 없음)', count: row.job_count }));
    renderPieChart(container, ranked, WANTED_TREND_EMPTY_MESSAGE, '실시간 채용 시장 동향 (원티드 제공)');
  } catch (err) {
    // relation does not exist 등 테이블 미배포 상태도 여기서 잡혀 empty-state로 안내한다(정상 상태, 버그 아님).
    console.error(err);
    container.innerHTML = `<p class="empty-state">${WANTED_TREND_EMPTY_MESSAGE}</p>`;
  }
}

const MAX_SKILL_RANKING = 10;
const SKILL_SAMPLE_LIMIT = 1000;

/**
 * 스킬 수요 랭킹: company_profile_skills를 skill_category_id별로 집계해 상위 스킬 비중을
 * 파이차트로 렌더링한다(company+common 병합 1차 수정, 2026-07-15 — 바 형태에서 전환).
 * 조회 자체는 상위 MAX_SKILL_RANKING(10)건까지 가져오되, 파이차트 색상 슬롯은 8개 고정이라
 * renderPieChart 내부에서 상위 7개 + "기타"로 접어서 그린다.
 */
export async function renderSkillRanking(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">스킬 수요 랭킹을 불러오는 중입니다...</p>';

  try {
    const { data: rows, error } = await supabase
      .from('company_profile_skills')
      .select('skill_category_id')
      .limit(SKILL_SAMPLE_LIMIT);
    if (error) throw error;

    const skillRows = rows || [];
    if (skillRows.length === 0) {
      container.innerHTML = '<p class="empty-state">집계할 스킬 데이터가 없습니다.</p>';
      return;
    }

    const counts = countBy(skillRows, (r) => r.skill_category_id);
    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SKILL_RANKING);

    const categoryMap = await fetchCategoriesByIds(ranked.map(([id]) => id));
    const rankedItems = ranked.map(([categoryId, count]) => ({
      title: categoryMap[categoryId] ? categoryMap[categoryId].title : '(알 수 없음)',
      count,
    }));

    renderPieChart(container, rankedItems, '집계할 스킬 데이터가 없습니다.', '스킬 수요 랭킹');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">스킬 수요 랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

const MAX_SKILL_COMBO = 5;
const SKILL_COMBO_SAMPLE_LIMIT = 2000;

// (REFACT.md P2-6) O(n²) 조합 계산 결과를 세션 동안 캐싱해 탭 재방문 시 재계산을 생략한다.
// ponytail: 세션 내 무효화 로직 없음(페이지 새로고침 전까지 고정) — 데이터가 자주 바뀌면 TTL 추가.
// (company+common 병합 1차 수정, 2026-07-15) HTML 문자열이 아니라 렌더링 입력값(랭킹 배열)을
// 캐싱한다 — renderPieChart가 직접 container.innerHTML을 채우는 구조라, 캐시 히트 시에도
// 동일 함수를 그대로 재호출해 마크업 생성 로직이 두 곳에 중복되지 않게 한다.
let skillComboRankedCache = null;

/**
 * 스킬 조합 분석: company_profile_skills를 company_profile_id로 그룹핑한 뒤, 그룹 내부의
 * 스킬 2개 조합(순서 무관)의 등장 횟수를 집계해 상위 조합("A + B")의 비중을 파이차트로 보여준다
 * (company+common 병합 1차 수정, 2026-07-15 — 목록에서 파이차트로 전환).
 * 개별 회사를 특정하지 않고 집계 수치만 노출하는 시장 트렌드 정보다.
 */
export async function renderSkillCombo(container) {
  if (!container) return;

  if (skillComboRankedCache != null) {
    renderPieChart(container, skillComboRankedCache, '아직 데이터가 충분하지 않습니다.', '자주 함께 요구되는 스킬 조합');
    return;
  }

  container.innerHTML = '<p class="empty-state">스킬 조합을 분석하는 중입니다...</p>';

  try {
    const { data: rows, error } = await supabase
      .from('company_profile_skills')
      .select('company_profile_id, skill_category_id')
      .limit(SKILL_COMBO_SAMPLE_LIMIT);
    if (error) throw error;

    const skillRows = rows || [];
    const byCompany = new Map();
    skillRows.forEach((row) => {
      if (!byCompany.has(row.company_profile_id)) byCompany.set(row.company_profile_id, []);
      byCompany.get(row.company_profile_id).push(row.skill_category_id);
    });

    const pairCounts = new Map();
    byCompany.forEach((skillIds) => {
      const uniqueSkillIds = Array.from(new Set(skillIds));
      for (let i = 0; i < uniqueSkillIds.length; i += 1) {
        for (let j = i + 1; j < uniqueSkillIds.length; j += 1) {
          const pairKey = [uniqueSkillIds[i], uniqueSkillIds[j]].sort().join('::');
          pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        }
      }
    });

    if (pairCounts.size === 0) {
      skillComboRankedCache = [];
      renderPieChart(container, skillComboRankedCache, '아직 데이터가 충분하지 않습니다.', '자주 함께 요구되는 스킬 조합');
      return;
    }

    const ranked = Array.from(pairCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SKILL_COMBO);

    const allIds = new Set();
    ranked.forEach(([pairKey]) => pairKey.split('::').forEach((id) => allIds.add(id)));
    const categoryMap = await fetchCategoriesByIds(Array.from(allIds));

    skillComboRankedCache = ranked.map(([pairKey, count]) => {
      const [idA, idB] = pairKey.split('::');
      const titleA = categoryMap[idA] ? categoryMap[idA].title : '(알 수 없음)';
      const titleB = categoryMap[idB] ? categoryMap[idB].title : '(알 수 없음)';
      return { title: `${titleA} + ${titleB}`, count };
    });

    renderPieChart(container, skillComboRankedCache, '아직 데이터가 충분하지 않습니다.', '자주 함께 요구되는 스킬 조합');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">스킬 조합 분석을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}
