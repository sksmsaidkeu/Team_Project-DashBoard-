import { apiClient, ApiError } from './api-client.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds, mountCascadeSelects, mountSkillCheckboxes } from './categories.js';
import { employmentTypeLabel } from './signup.js';

function errMsg(err) {
  return err instanceof ApiError ? err.message : '검색에 실패했습니다.';
}

// 숫자 입력(경력/연봉)은 매 keystroke마다 검색하면 과도한 요청이 발생하므로 살짝 지연시켜 호출한다.
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 결과 수가 수십~백 단위로 작아 이미 받아온 배열을 client-side에서 페이지로 나눈다(피드백 6번).
const PAGE_SIZE = 12;

/**
 * Tab1(기업) 인재 검색 서브탭 — GET /company/talent-search (backend/app/routers/talent_search.py).
 *
 * PRD 4.2절/DB.md 3.5절 jobseeker_profiles 기준 하드 필터(직무/스킬/지역/근무형태/경력/희망연봉) +
 * PRD 5장 소프트 스코어링(sort=score 파라미터, 스킬 40%/직무 25%/지역·연봉 15%/활동성 10%/최신성 10%)을
 * 백엔드에서 계산해 내려준다. 값을 비우면 해당 조건은 필터링하지 않는다(백엔드 기본 동작) — 아무 조건도
 * 지정하지 않고 검색하면 공개 설정된 전체 인재가 반환된다.
 *
 * js/tab-company.js의 기존 "하드필터 하이라이트" 위젯(company-highlight, Supabase 직접 조회)과는
 * 별개의 화면이다 — 이 서브탭은 새 백엔드 API를 호출하는 본 검색 화면이다.
 */
export async function renderTalentsPanel(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';

  const session = await getCurrentUserProfile();
  if (!session || session.userType !== 'COMPANY' || !session.profile) {
    container.innerHTML = '<p class="empty-state">기업 회원으로 로그인해야 이용할 수 있습니다.</p>';
    return;
  }

  container.innerHTML = `
    <div class="company-console">
      <aside class="filter-sidebar" aria-label="인재 검색 필터">
        <div class="form-row">
          <span class="form-label" id="talent-position-label">직무 (비우면 전체)</span>
          <div class="cascade-group" id="talent-position-select" aria-labelledby="talent-position-label"></div>
        </div>
        <div class="form-row">
          <span class="form-label" id="talent-region-label">지역 (비우면 전체)</span>
          <div class="cascade-group" id="talent-region-select" aria-labelledby="talent-region-label"></div>
        </div>
        <div class="form-row">
          <span class="form-label" id="talent-skills-label">스킬 (비우면 전체)</span>
          <div class="skill-group" id="talent-skills-select" aria-labelledby="talent-skills-label"></div>
        </div>
        <div class="form-row">
          <label class="form-label" for="talent-employment-type">희망 근무형태</label>
          <select class="form-select" id="talent-employment-type">
            <option value="">전체</option>
            <option value="regular">정규직</option>
            <option value="contract">계약직</option>
            <option value="intern">인턴</option>
          </select>
        </div>
        <div class="form-row form-row--split">
          <div>
            <label class="form-label" for="talent-career-min">최소 경력(년)</label>
            <input class="form-input" type="number" min="0" id="talent-career-min" />
          </div>
          <div>
            <label class="form-label" for="talent-career-max">최대 경력(년)</label>
            <input class="form-input" type="number" min="0" id="talent-career-max" />
          </div>
        </div>
        <div class="form-row">
          <label class="form-label" for="talent-salary-max">희망연봉 상한(만원)</label>
          <input class="form-input" type="number" min="0" id="talent-salary-max" />
        </div>
        <label class="form-toggle">
          <input type="checkbox" id="talent-sort-score" />
          <span>매칭 점수순 정렬</span>
        </label>
        <button type="button" class="btn btn-secondary" id="talent-reset-btn">필터 초기화</button>
      </aside>
      <div id="talent-result-area"><p class="empty-state">불러오는 중입니다...</p></div>
    </div>
  `;

  const positionContainer = container.querySelector('#talent-position-select');
  const regionContainer = container.querySelector('#talent-region-select');
  const skillsContainer = container.querySelector('#talent-skills-select');

  let positionApi;
  let regionApi;
  let skillsApi = { getValue: () => [] };

  // 필터 선택 즉시 검색되므로(피드백 5번), "검색" 버튼 대신 "필터 초기화" 버튼만 두고
  // 초기화 시 이 함수로 세 카테고리 위젯을 다시 마운트해 선택값을 비운다.
  function mountFilterWidgets() {
    positionApi = mountCascadeSelects({
      container: positionContainer,
      categoryType: 'JOB',
      maxDepth: 1,
      placeholderLabels: ['직군'],
      onChange: () => search(),
    });
    regionApi = mountCascadeSelects({
      container: regionContainer,
      categoryType: 'REGION',
      maxDepth: 3,
      placeholderLabels: ['시도', '시군구', '읍면동'],
      onChange: () => search(),
    });
    skillsApi = { getValue: () => [] };
    mountSkillCheckboxes({
      container: skillsContainer,
      onChange: () => search(),
    }).then((api) => {
      skillsApi = api;
    });
  }

  mountFilterWidgets();

  const resultArea = container.querySelector('#talent-result-area');
  const resetBtn = container.querySelector('#talent-reset-btn');
  const employmentTypeSelect = container.querySelector('#talent-employment-type');
  const careerMinInput = container.querySelector('#talent-career-min');
  const careerMaxInput = container.querySelector('#talent-career-max');
  const salaryMaxInput = container.querySelector('#talent-salary-max');
  const sortScoreCheckbox = container.querySelector('#talent-sort-score');

  // 스킬 체크박스는 클릭마다 즉시 search()를 호출한다(디바운스 없음) — 백엔드가 콜드 스타트
  // 등으로 요청마다 응답 속도가 들쭉날쭉하면, 먼저 보낸(느린) 요청의 응답이 나중에 보낸(빠른)
  // 요청의 응답보다 늦게 도착해 화면을 덮어써버릴 수 있다. 사용자 입장에서는 "방금 고른 스킬이
  // 반영 안 되고 이전 상태로 되돌아간다/버튼이 안 눌리는 것 같다"로 보인다. 요청마다 일련번호를
  // 매겨, 가장 마지막에 보낸 요청의 응답만 반영하도록 막는다(오래된 응답은 조용히 버림).
  let searchSeq = 0;

  async function search() {
    const mySeq = ++searchSeq;
    resultArea.innerHTML = '<p class="empty-state">검색 중입니다...</p>';
    const skillIds = skillsApi.getValue();
    const query = {
      position_category_id: positionApi.getValue() || undefined,
      region_category_id: regionApi.getValue() || undefined,
      employment_type: employmentTypeSelect.value || undefined,
      skill_category_ids: skillIds.length > 0 ? skillIds.join(',') : undefined,
      min_career_years: careerMinInput.value || undefined,
      max_career_years: careerMaxInput.value || undefined,
      max_desired_salary: salaryMaxInput.value || undefined,
      sort: sortScoreCheckbox.checked ? 'score' : undefined,
      // 공개 구직자 전체(현재 100명 이상)를 한 번에 받아 클라이언트에서 페이지네이션한다.
      limit: 500,
    };

    try {
      const results = await apiClient.get('/company/talent-search', query);
      if (mySeq !== searchSeq) return; // 그 사이 더 최신 검색이 시작됐으면 이 결과는 버린다
      await renderResults(results || []);
    } catch (err) {
      if (mySeq !== searchSeq) return;
      resultArea.innerHTML = `<p class="empty-state">${errMsg(err)}</p>`;
    }
  }

  async function renderResults(results) {
    if (results.length === 0) {
      resultArea.innerHTML = '<p class="empty-state">조건에 맞는 인재가 없습니다. 필터를 넓혀보세요.</p>';
      return;
    }

    const categoryIds = new Set();
    results.forEach((r) => {
      categoryIds.add(r.desired_position_category_id);
      if (r.region_category_id) categoryIds.add(r.region_category_id);
      (r.matched_skill_category_ids || []).forEach((id) => categoryIds.add(id));
    });
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));
    const title = (id) => (id && categoryMap[id] ? categoryMap[id].title : '-');

    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    let currentPage = 1;

    function renderCards(pageItems) {
      return `
        <div class="candidate-grid">
          ${pageItems.map((r) => `
            <article class="card">
              <div class="talent-card__head">
                ${r.score != null ? `
                  <div class="match-score" style="--score:${Math.round(r.score)};" aria-hidden="true">
                    <span class="match-score__value">${Math.round(r.score)}</span>
                  </div>
                  <span class="sr-only">매칭 점수 ${Math.round(r.score)}점</span>
                ` : ''}
                <div>
                  <h3 class="card__title">${title(r.desired_position_category_id)} · 경력 ${r.career_years}년</h3>
                  <p class="card__meta">${title(r.region_category_id)} · ${employmentTypeLabel(r.desired_employment_type)}</p>
                  <p class="card__meta">희망연봉 ${r.desired_salary != null ? `${r.desired_salary}만원` : '비공개'}</p>
                </div>
              </div>
              ${(r.matched_skill_category_ids || []).length > 0
                ? `<div class="tag-row">${r.matched_skill_category_ids.map((id) => `<span class="tag">${title(id)}</span>`).join('')}</div>`
                : ''}
            </article>
          `).join('')}
        </div>
      `;
    }

    function renderPagination() {
      if (totalPages <= 1) return '';
      const buttons = Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => `
        <button type="button" class="pagination__btn" data-page="${page}" aria-current="${page === currentPage}">${page}</button>
      `).join('');
      return `
        <nav class="pagination" aria-label="인재 검색 결과 페이지">
          <button type="button" class="pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''} aria-label="이전 페이지">이전</button>
          ${buttons}
          <button type="button" class="pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''} aria-label="다음 페이지">다음</button>
        </nav>
      `;
    }

    function renderPage() {
      const start = (currentPage - 1) * PAGE_SIZE;
      const pageItems = results.slice(start, start + PAGE_SIZE);
      resultArea.innerHTML = renderCards(pageItems) + renderPagination();

      resultArea.querySelectorAll('.pagination__btn[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const { page } = btn.dataset;
          if (page === 'prev') currentPage = Math.max(1, currentPage - 1);
          else if (page === 'next') currentPage = Math.min(totalPages, currentPage + 1);
          else currentPage = Number(page);
          renderPage();
          resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }

    renderPage();
  }

  const debouncedSearch = debounce(search, 400);

  function resetFilters() {
    mountFilterWidgets();
    employmentTypeSelect.value = '';
    careerMinInput.value = '';
    careerMaxInput.value = '';
    salaryMaxInput.value = '';
    sortScoreCheckbox.checked = false;
    search();
  }

  resetBtn.addEventListener('click', resetFilters);
  employmentTypeSelect.addEventListener('change', search);
  sortScoreCheckbox.addEventListener('change', search);
  careerMinInput.addEventListener('input', debouncedSearch);
  careerMaxInput.addEventListener('input', debouncedSearch);
  salaryMaxInput.addEventListener('input', debouncedSearch);

  search();
}
