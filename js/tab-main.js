import { supabase } from './supabaseClient.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds } from './categories.js';
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

const JOB_NEWS_ITEMS = [
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

async function searchJobPostingsByTerm(term, limit = 20) {
  const { data: categoryRows, error: categoryError } = await supabase
    .from('categories')
    .select('id, title, category_type, depth, parent_id')
    .in('category_type', ['JOB', 'SKILL'])
    .ilike('title', `%${term}%`);
  if (categoryError) throw categoryError;

  const matched = categoryRows || [];
  if (matched.length === 0) return [];

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

  let query = supabase
    .from('job_postings')
    .select('id, company_profile_id, position_category_id, employment_type, annual_from, annual_to, status, posted_at')
    .eq('status', 'active')
    .order('posted_at', { ascending: false })
    .limit(limit);

  const orParts = [];
  if (positionGroupIds.size > 0) orParts.push(`position_category_id.in.(${Array.from(positionGroupIds).join(',')})`);
  if (companyIdsFromSkills.length > 0) orParts.push(`company_profile_id.in.(${companyIdsFromSkills.join(',')})`);
  query = query.or(orParts.join(','));

  const { data: postingRows, error: postingError } = await query;
  if (postingError) throw postingError;
  return postingRows || [];
}

/**
 * 통합 검색(hero-search-form) submit 핸들러를 연결한다. 앱 초기화 시 1회만 호출한다.
 */
export function initHeroSearch() {
  const form = document.getElementById('hero-search-form');
  const input = document.getElementById('hero-search-input');
  const resultsContainer = document.getElementById('main-recent-jobs');
  if (!form || !input) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!resultsContainer) return;

    const term = input.value.trim();
    if (!term) {
      renderRecentJobs(resultsContainer);
      return;
    }

    resultsContainer.innerHTML = '<p class="empty-state">검색 중입니다...</p>';

    try {
      const postings = await searchJobPostingsByTerm(term);
      const companyMap = await fetchCompaniesByIds(postings.map((p) => p.company_profile_id));
      const categoryMap = await buildJobCategoryMap(postings, companyMap);
      renderJobList(resultsContainer, postings, categoryMap, companyMap, `"${term}"에 대한 검색 결과가 없습니다.`);
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

/**
 * 랭킹 막대바 공통 렌더러(REFACT.md P1-4). rankedItems: [{title, count}, ...] 정렬된 배열.
 * renderMainTrend/renderWantedTrend는 조회·정렬만 하고 렌더링은 이 헬퍼에 위임한다.
 */
function renderRankBars(container, rankedItems, emptyMessage) {
  if (!rankedItems || rankedItems.length === 0) {
    container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }

  const maxCount = rankedItems[0].count || 1;
  container.innerHTML = rankedItems.map(({ title, count }) => {
    const pct = Math.max(6, Math.round((count / maxCount) * 100));
    return `
      <div class="rank-bar">
        <div class="rank-bar__row">
          <span class="card__title" style="margin:0;">${escapeHtml(title)}</span>
          <span class="card__meta" style="margin:0;">${count}건</span>
        </div>
        <div class="rank-bar__track">
          <div class="rank-bar__fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 채용 트렌드: status='active'인 공고를 position_category_id(직군, depth 1)별로 집계해
 * 상위 랭킹을 가로 바 형태로 렌더링한다. "현재 시점 스냅샷 랭킹"(월별 추이는 이번 범위 제외).
 */
export async function renderMainTrend(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">채용 트렌드를 불러오는 중입니다...</p>';

  try {
    const { data: rows, error } = await supabase
      .from('job_postings')
      .select('position_category_id')
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
    const ranked = topCounts.map(([categoryId, count]) => ({
      title: categoryMap[categoryId] ? categoryMap[categoryId].title : '(알 수 없음)',
      count,
    }));

    renderRankBars(container, ranked, '집계할 채용 공고 데이터가 없습니다.');
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
 * 행을 job_count desc로 상위 8개 조회해 기존 renderMainTrend와 동일한 인라인 막대로 렌더링한다.
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
    renderRankBars(container, ranked, WANTED_TREND_EMPTY_MESSAGE);
  } catch (err) {
    // relation does not exist 등 테이블 미배포 상태도 여기서 잡혀 empty-state로 안내한다(정상 상태, 버그 아님).
    console.error(err);
    container.innerHTML = `<p class="empty-state">${WANTED_TREND_EMPTY_MESSAGE}</p>`;
  }
}

const MAX_SKILL_RANKING = 10;
const SKILL_SAMPLE_LIMIT = 1000;

/**
 * 스킬 수요 랭킹: company_profile_skills를 skill_category_id별로 집계해 상위 스킬을
 * "타이틀 (빈도수)" 형태의 .tag 뱃지로 렌더링한다.
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

    container.innerHTML = `<div class="tag-row">${ranked.map(([categoryId, count]) => {
      const title = categoryMap[categoryId] ? categoryMap[categoryId].title : '(알 수 없음)';
      return `<span class="tag">${escapeHtml(title)} (${count})</span>`;
    }).join('')}</div>`;
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">스킬 수요 랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

const MAX_SKILL_COMBO = 5;
const SKILL_COMBO_SAMPLE_LIMIT = 2000;

// (REFACT.md P2-6) O(n²) 조합 계산 결과를 세션 동안 캐싱해 탭 재방문 시 재계산을 생략한다.
// ponytail: 세션 내 무효화 로직 없음(페이지 새로고침 전까지 고정) — 데이터가 자주 바뀌면 TTL 추가.
let skillComboHtmlCache = null;

/**
 * 스킬 조합 분석: company_profile_skills를 company_profile_id로 그룹핑한 뒤, 그룹 내부의
 * 스킬 2개 조합(순서 무관)의 등장 횟수를 집계해 상위 조합을 "A + B (N건)" 형태로 보여준다.
 * 개별 회사를 특정하지 않고 집계 수치만 노출하는 시장 트렌드 정보다.
 */
export async function renderSkillCombo(container) {
  if (!container) return;

  if (skillComboHtmlCache != null) {
    container.innerHTML = skillComboHtmlCache;
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
      skillComboHtmlCache = '<p class="empty-state">아직 데이터가 충분하지 않습니다.</p>';
      container.innerHTML = skillComboHtmlCache;
      return;
    }

    const ranked = Array.from(pairCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SKILL_COMBO);

    const allIds = new Set();
    ranked.forEach(([pairKey]) => pairKey.split('::').forEach((id) => allIds.add(id)));
    const categoryMap = await fetchCategoriesByIds(Array.from(allIds));

    skillComboHtmlCache = `
      <ul class="combo-list">
        ${ranked.map(([pairKey, count]) => {
          const [idA, idB] = pairKey.split('::');
          const titleA = categoryMap[idA] ? categoryMap[idA].title : '(알 수 없음)';
          const titleB = categoryMap[idB] ? categoryMap[idB].title : '(알 수 없음)';
          return `
            <li class="combo-list__item">
              <div class="tag-row" style="justify-content: space-between;">
                <span class="card__title" style="margin:0;">${escapeHtml(titleA)} + ${escapeHtml(titleB)}</span>
                <span class="card__meta" style="margin:0;">${count}건</span>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    `;
    container.innerHTML = skillComboHtmlCache;
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">스킬 조합 분석을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}
