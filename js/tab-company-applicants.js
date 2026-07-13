import { apiClient, ApiError } from './api-client.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds } from './categories.js';
import { employmentTypeLabel } from './signup.js';

const JOB_STATUS_LABEL = { draft: '임시저장', active: '게시중', close: '마감' };

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function errMsg(err, fallback) {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Tab1(기업) 지원자 관리 서브탭.
 * GET /company/job-postings/{id}/applicants, POST .../applicants/{jobseeker_profile_id}/view
 * (backend/app/routers/applicants.py)
 *
 * 백엔드에 파이프라인 단계(서류심사/면접 등) 개념이 없고 interaction_logs의 APPLY/VIEW 로그만
 * 존재하므로(DB.md 3.9절), 칸반이 아니라 지원일시 순 목록 + 열람 처리 버튼으로만 구성한다.
 */
export async function renderApplicantsPanel(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';

  const session = await getCurrentUserProfile();
  if (!session || session.userType !== 'COMPANY' || !session.profile) {
    container.innerHTML = '<p class="empty-state">기업 회원으로 로그인해야 이용할 수 있습니다.</p>';
    return;
  }

  let postings;
  try {
    postings = await apiClient.get('/company/job-postings');
  } catch (err) {
    container.innerHTML = `<p class="empty-state">${errMsg(err, '공고 목록을 불러오지 못했습니다.')}</p>`;
    return;
  }

  if (!postings || postings.length === 0) {
    container.innerHTML = '<p class="empty-state">등록된 공고가 없습니다. 먼저 "공고 관리"에서 공고를 등록해주세요.</p>';
    return;
  }

  const categoryIds = new Set(postings.map((p) => p.position_category_id));
  const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));
  const postingLabel = (p) => `${categoryMap[p.position_category_id]?.title || '공고'} (${JOB_STATUS_LABEL[p.status] || p.status})`;

  container.innerHTML = `
    <div class="form-row form-row--inline">
      <label class="form-label form-label--inline" for="applicant-posting-select">공고 선택</label>
      <select class="form-select" id="applicant-posting-select">
        ${postings.map((p) => `<option value="${p.id}">${postingLabel(p)}</option>`).join('')}
      </select>
    </div>
    <div id="applicant-list-area"><p class="empty-state">불러오는 중입니다...</p></div>
  `;

  const select = container.querySelector('#applicant-posting-select');
  const listArea = container.querySelector('#applicant-list-area');

  async function loadApplicants(jobPostingId) {
    listArea.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';
    try {
      const applicants = await apiClient.get(`/company/job-postings/${jobPostingId}/applicants`);
      await renderApplicants(jobPostingId, applicants || []);
    } catch (err) {
      listArea.innerHTML = `<p class="empty-state">${errMsg(err, '지원자 목록을 불러오지 못했습니다.')}</p>`;
    }
  }

  async function renderApplicants(jobPostingId, applicants) {
    if (applicants.length === 0) {
      listArea.innerHTML = '<p class="empty-state">아직 지원자가 없습니다.</p>';
      return;
    }

    const catIds = new Set();
    applicants.forEach((a) => {
      catIds.add(a.desired_position_category_id);
      if (a.region_category_id) catIds.add(a.region_category_id);
      (a.skill_category_ids || []).forEach((id) => catIds.add(id));
    });
    const catMap = await fetchCategoriesByIds(Array.from(catIds));
    const title = (id) => (id && catMap[id] ? catMap[id].title : '-');

    const rows = applicants.map((a) => `
      <tr>
        <td>${title(a.desired_position_category_id)} · 경력 ${a.career_years}년</td>
        <td>${a.region_category_id ? title(a.region_category_id) : '비공개'}</td>
        <td>${a.desired_salary != null ? `${a.desired_salary}만원` : '비공개'}</td>
        <td>${employmentTypeLabel(a.desired_employment_type)}</td>
        <td>${(a.skill_category_ids || []).length > 0
          ? `<div class="tag-row">${a.skill_category_ids.map((id) => `<span class="tag">${title(id)}</span>`).join('')}</div>`
          : '-'}</td>
        <td>${formatDateTime(a.applied_at)}</td>
        <td>${a.viewed
          ? '<span class="status-badge status-badge--viewed">열람함</span>'
          : '<span class="status-badge status-badge--unviewed">미열람</span>'}</td>
        <td class="table-actions">
          ${a.viewed ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-action="view" data-id="${a.jobseeker_profile_id}">열람 처리</button>`}
        </td>
      </tr>
    `).join('');

    listArea.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>직무/경력</th><th>지역</th><th>희망연봉</th><th>희망근무형태</th>
            <th>스킬</th><th>지원일시</th><th>열람여부</th><th>액션</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    listArea.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await apiClient.post(`/company/job-postings/${jobPostingId}/applicants/${btn.dataset.id}/view`);
          await loadApplicants(jobPostingId);
        } catch (err) {
          window.alert(errMsg(err, '열람 처리에 실패했습니다.'));
          btn.disabled = false;
        }
      });
    });
  }

  select.addEventListener('change', () => loadApplicants(select.value));
  await loadApplicants(select.value);
}
