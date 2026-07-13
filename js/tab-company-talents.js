import { apiClient, ApiError } from './api-client.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds, mountCascadeSelects, mountSkillCheckboxes } from './categories.js';
import { employmentTypeLabel } from './signup.js';

function errMsg(err) {
  return err instanceof ApiError ? err.message : '검색에 실패했습니다.';
}

/**
 * Tab1(기업) 인재 검색 서브탭 — GET /company/talent-search (backend/app/routers/talent_search.py).
 *
 * PRD 4.2절/DB.md 3.5절 jobseeker_profiles 기준 하드 필터(직무/스킬/지역/근무형태/경력/희망연봉) +
 * PRD 5장 소프트 스코어링(sort=score 파라미터, 스킬 40%/직무 25%/지역·연봉 15%/활동성 10%/최신성 10%)을
 * 백엔드에서 계산해 내려준다. 값을 비우면 자사 등록 직무/지역/필요 스킬을 기본값으로 사용한다(백엔드 기본 동작).
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
          <span class="form-label" id="talent-position-label">직무 (비우면 자사 등록 직무)</span>
          <div class="cascade-group" id="talent-position-select" aria-labelledby="talent-position-label"></div>
        </div>
        <div class="form-row">
          <span class="form-label" id="talent-region-label">지역 (비우면 자사 등록 지역)</span>
          <div class="cascade-group" id="talent-region-select" aria-labelledby="talent-region-label"></div>
        </div>
        <div class="form-row">
          <span class="form-label" id="talent-skills-label">스킬 (비우면 자사 필요 스킬)</span>
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
        <button type="button" class="btn btn-primary" id="talent-search-btn">검색</button>
      </aside>
      <div id="talent-result-area"><p class="empty-state">조건을 설정하고 검색 버튼을 눌러주세요.</p></div>
    </div>
  `;

  const positionApi = mountCascadeSelects({
    container: container.querySelector('#talent-position-select'),
    categoryType: 'JOB',
    maxDepth: 1,
    placeholderLabels: ['직군'],
  });
  const regionApi = mountCascadeSelects({
    container: container.querySelector('#talent-region-select'),
    categoryType: 'REGION',
    maxDepth: 3,
    placeholderLabels: ['시도', '시군구', '읍면동'],
  });

  let skillsApi = { getValue: () => [] };
  mountSkillCheckboxes({ container: container.querySelector('#talent-skills-select') }).then((api) => {
    skillsApi = api;
  });

  const resultArea = container.querySelector('#talent-result-area');
  const searchBtn = container.querySelector('#talent-search-btn');

  async function search() {
    resultArea.innerHTML = '<p class="empty-state">검색 중입니다...</p>';
    const skillIds = skillsApi.getValue();
    const query = {
      position_category_id: positionApi.getValue() || undefined,
      region_category_id: regionApi.getValue() || undefined,
      employment_type: container.querySelector('#talent-employment-type').value || undefined,
      skill_category_ids: skillIds.length > 0 ? skillIds.join(',') : undefined,
      min_career_years: container.querySelector('#talent-career-min').value || undefined,
      max_career_years: container.querySelector('#talent-career-max').value || undefined,
      max_desired_salary: container.querySelector('#talent-salary-max').value || undefined,
      sort: container.querySelector('#talent-sort-score').checked ? 'score' : undefined,
    };

    try {
      const results = await apiClient.get('/company/talent-search', query);
      await renderResults(results || []);
    } catch (err) {
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

    resultArea.innerHTML = `
      <div class="candidate-grid">
        ${results.map((r) => `
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

  searchBtn.addEventListener('click', search);
}
