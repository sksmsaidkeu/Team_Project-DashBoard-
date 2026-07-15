import { supabase } from './supabaseClient.js';
import { apiClient, ApiError } from './api-client.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds } from './categories.js';
import { employmentTypeLabel } from './signup.js';

const JOB_STATUS_LABEL = { draft: '임시저장', active: '게시중', close: '마감' };

// jobseeker_applications.pipeline_stage/outcome 변경 옵션(jobseeker-dashboard.js와 동일 매핑).
// 2026-07-16: 이 단계 변경은 이제 기업만 할 수 있다(RLS: jobseeker_applications_update_company,
// migrations/20260716000000_jobseeker_applications_company_owns_stage.sql 참고) — 구직자는
// 더 이상 자기 화면에서 직접 바꿀 수 없다.
const STAGE_OPTIONS = [
  { value: 'applied', label: '지원완료', pipeline_stage: 'applied', outcome: null },
  { value: 'review', label: '서류심사', pipeline_stage: 'review', outcome: null },
  { value: 'interview', label: '면접', pipeline_stage: 'interview', outcome: null },
  { value: 'result_passed', label: '최종결과 · 합격', pipeline_stage: 'result', outcome: 'passed' },
  { value: 'result_rejected', label: '최종결과 · 불합격', pipeline_stage: 'result', outcome: 'rejected' },
];

function stageOptionValue(pipelineStage, outcome) {
  if (pipelineStage === 'result') return outcome === 'rejected' ? 'result_rejected' : 'result_passed';
  return pipelineStage;
}

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
 * 목록/열람 처리는 GET /company/job-postings/{id}/applicants, POST .../{jobseeker_profile_id}/view
 * (backend/app/routers/applicants.py, interaction_logs의 APPLY/VIEW 로그 기반, DB.md 3.9절).
 *
 * 지원 현황 단계(지원완료/서류심사/면접/최종결과)는 별도 테이블 jobseeker_applications에 있고
 * 백엔드에는 이 개념이 없어서, 이 부분만 직접 Supabase(RLS: jobseeker_applications_update_company)
 * 로 조회/변경한다 — jobseeker_profile_id로 위 목록과 조인한다(2026-07-16 추가).
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

    // 지원 현황 단계(jobseeker_applications)는 FastAPI(interaction_logs 기반) 목록과 별도
    // 데이터소스라 jobseeker_profile_id로 조인한다. RLS가 이 공고를 등록한 기업 본인에게만
    // 조회/수정을 허용한다(위 STAGE_OPTIONS 주석 참고).
    const { data: applicationRows, error: applicationError } = await supabase
      .from('jobseeker_applications')
      .select('id, jobseeker_profile_id, pipeline_stage, outcome')
      .eq('job_posting_id', jobPostingId);
    if (applicationError) console.error('jobseeker_applications 조회 실패', applicationError);
    const applicationByProfileId = new Map(
      (applicationRows ?? []).map((row) => [row.jobseeker_profile_id, row]),
    );

    const stageCellHtml = (a) => {
      const application = applicationByProfileId.get(a.jobseeker_profile_id);
      if (!application) return '<span class="card__meta">지원 현황 트래커 미사용</span>';
      const currentValue = stageOptionValue(application.pipeline_stage, application.outcome);
      const optionsHtml = STAGE_OPTIONS
        .map((o) => `<option value="${o.value}" ${o.value === currentValue ? 'selected' : ''}>${o.label}</option>`)
        .join('');
      return `
        <label class="sr-only" for="application-stage-${application.id}">지원 현황 단계 변경</label>
        <select class="form-select" id="application-stage-${application.id}" data-application-id="${application.id}">
          ${optionsHtml}
        </select>
      `;
    };

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
        <td>${stageCellHtml(a)}</td>
        <td class="table-actions">
          ${a.viewed ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-action="view" data-id="${a.jobseeker_profile_id}">열람 처리</button>`}
        </td>
      </tr>
    `).join('');

    listArea.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>직무/경력</th><th>지역</th><th>희망연봉</th><th>희망근무형태</th>
              <th>스킬</th><th>지원일시</th><th>열람여부</th><th>지원 현황 단계</th><th>액션</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
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

    listArea.querySelectorAll('[data-application-id]').forEach((select) => {
      select.addEventListener('change', async (e) => {
        const applicationId = e.target.dataset.applicationId;
        const option = STAGE_OPTIONS.find((o) => o.value === e.target.value);
        if (!option) return;

        e.target.disabled = true;
        const { error } = await supabase
          .from('jobseeker_applications')
          .update({ pipeline_stage: option.pipeline_stage, outcome: option.outcome })
          .eq('id', applicationId);

        if (error) {
          window.alert(`상태 변경에 실패했습니다: ${error.message}`);
          e.target.disabled = false;
          return;
        }
        await loadApplicants(jobPostingId);
      });
    });
  }

  select.addEventListener('change', () => loadApplicants(select.value));
  await loadApplicants(select.value);
}
