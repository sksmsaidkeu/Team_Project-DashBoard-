import { apiClient, ApiError } from './api-client.js';
import { getCurrentUserProfile } from './auth.js';
import { fetchCategoriesByIds, mountCascadeSelects, mountCategoryCheckboxesByParent } from './categories.js';
import { employmentTypeLabel } from './signup.js';

// backend/app/models.py JobPostingStatus = 'draft' | 'active' | 'close' (DB.md 3.8절)
const STATUS_LABEL = { draft: '임시저장', active: '게시중', close: '마감' };

function statusBadge(status) {
  return `<span class="status-badge status-badge--${status}">${STATUS_LABEL[status] || status}</span>`;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function errMsg(err) {
  return err instanceof ApiError ? err.message : '요청 처리 중 오류가 발생했습니다.';
}

/**
 * Tab1(기업) 공고 관리 서브탭.
 * GET/POST /company/job-postings, GET/PUT/DELETE /company/job-postings/{id} (backend/app/routers/job_postings.py)
 */
export async function renderJobsPanel(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';

  const session = await getCurrentUserProfile();
  if (!session || session.userType !== 'COMPANY' || !session.profile) {
    container.innerHTML = '<p class="empty-state">기업 회원으로 로그인해야 이용할 수 있습니다.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-toolbar">
      <div class="form-row form-row--inline">
        <label class="form-label form-label--inline" for="job-status-filter">상태</label>
        <select class="form-select form-input--sm" id="job-status-filter">
          <option value="">전체</option>
          <option value="draft">임시저장</option>
          <option value="active">게시중</option>
          <option value="close">마감</option>
        </select>
      </div>
      <button type="button" class="btn btn-primary" id="job-create-btn">새 공고 등록</button>
    </div>
    <div id="job-list-area"><p class="empty-state">불러오는 중입니다...</p></div>
    <div id="job-modal-root"></div>
  `;

  const statusFilter = container.querySelector('#job-status-filter');
  const listArea = container.querySelector('#job-list-area');
  const modalRoot = container.querySelector('#job-modal-root');
  const createBtn = container.querySelector('#job-create-btn');

  async function loadList() {
    listArea.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';
    try {
      const postings = await apiClient.get(
        '/company/job-postings',
        statusFilter.value ? { status: statusFilter.value } : undefined,
      );
      await renderList(postings || []);
    } catch (err) {
      listArea.innerHTML = `<p class="empty-state">${errMsg(err)}</p>`;
    }
  }

  async function renderList(postings) {
    if (postings.length === 0) {
      listArea.innerHTML = '<p class="empty-state">등록된 공고가 없습니다. "새 공고 등록"으로 첫 공고를 만들어보세요.</p>';
      return;
    }

    const categoryIds = new Set();
    postings.forEach((p) => {
      categoryIds.add(p.position_category_id);
      (p.position_detail_category_ids || []).forEach((id) => categoryIds.add(id));
    });
    const categoryMap = await fetchCategoriesByIds(Array.from(categoryIds));
    const title = (id) => categoryMap[id]?.title || '-';

    const rows = postings.map((p) => `
      <tr>
        <td>
          <strong>${title(p.position_category_id)}</strong>
          ${(p.position_detail_category_ids || []).length > 0
            ? `<div class="tag-row">${p.position_detail_category_ids.map((id) => `<span class="tag">${title(id)}</span>`).join('')}</div>`
            : ''}
        </td>
        <td>${employmentTypeLabel(p.employment_type)}</td>
        <td>${p.annual_from}년${p.annual_to != null ? `~${p.annual_to}년` : ' 이상'}</td>
        <td>${statusBadge(p.status)}</td>
        <td>${formatDateTime(p.posted_at)}</td>
        <td class="table-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${p.id}">수정</button>
          ${p.status === 'draft' ? `<button type="button" class="btn btn-secondary btn-sm" data-action="publish" data-id="${p.id}">게시</button>` : ''}
          ${p.status === 'active' ? `<button type="button" class="btn btn-secondary btn-sm" data-action="close" data-id="${p.id}">마감</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-action="delete" data-id="${p.id}">삭제</button>
        </td>
      </tr>
    `).join('');

    listArea.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>직군/직무상세</th><th>고용형태</th><th>경력</th><th>상태</th><th>게시일</th><th>액션</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    listArea.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id, postings));
    });
  }

  async function handleAction(action, id, postings) {
    const posting = postings.find((p) => p.id === id);

    if (action === 'edit') {
      openModal(posting);
      return;
    }

    if (action === 'delete') {
      if (!window.confirm('이 공고를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
      try {
        await apiClient.delete(`/company/job-postings/${id}`);
        await loadList();
      } catch (err) {
        window.alert(errMsg(err));
      }
      return;
    }

    if (action === 'publish' || action === 'close') {
      const nextStatus = action === 'publish' ? 'active' : 'close';
      const confirmMsg = action === 'publish' ? '이 공고를 게시하시겠습니까?' : '이 공고를 마감하시겠습니까?';
      if (!window.confirm(confirmMsg)) return;
      try {
        await apiClient.put(`/company/job-postings/${id}`, { status: nextStatus });
        await loadList();
      } catch (err) {
        window.alert(errMsg(err));
      }
    }
  }

  function openModal(posting = null) {
    const isEdit = Boolean(posting);
    modalRoot.innerHTML = `
      <div class="modal-overlay" id="job-modal-overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
          <div class="modal__header">
            <h3 class="modal__title" id="job-modal-title">${isEdit ? '공고 수정' : '새 공고 등록'}</h3>
            <button type="button" class="modal__close" id="job-modal-close" aria-label="닫기">×</button>
          </div>
          <form id="job-form" novalidate>
            <div class="form-row">
              <span class="form-label" id="job-position-label">직군</span>
              <div class="cascade-group" id="job-position-select" aria-labelledby="job-position-label"></div>
            </div>
            <div class="form-row">
              <span class="form-label" id="job-detail-label">직무 상세 (다중 선택)</span>
              <div class="skill-group" id="job-detail-select" aria-labelledby="job-detail-label">
                <p class="empty-state">직군을 먼저 선택해주세요.</p>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" for="job-employment-type">고용형태</label>
              <select class="form-select" id="job-employment-type" required>
                <option value="">선택</option>
                <option value="regular">정규직</option>
                <option value="contract">계약직</option>
                <option value="intern">인턴</option>
              </select>
            </div>
            <div class="form-row form-row--split">
              <div>
                <label class="form-label" for="job-annual-from">최소 경력(년)</label>
                <input class="form-input" type="number" min="0" id="job-annual-from" value="0" required />
              </div>
              <div>
                <label class="form-label" for="job-annual-to">최대 경력(년, 선택. 비우면 상한 없음)</label>
                <input class="form-input" type="number" min="0" id="job-annual-to" />
              </div>
            </div>
            <p class="form-status" id="job-form-status" role="alert" aria-live="polite"></p>
            <div class="modal__footer">
              <button type="button" class="btn btn-ghost" id="job-modal-cancel">취소</button>
              <button type="submit" class="btn btn-primary">${isEdit ? '수정 완료' : '등록'}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const detailContainer = modalRoot.querySelector('#job-detail-select');
    let detailApi = { getValue: () => posting?.position_detail_category_ids || [] };

    const positionApi = mountCascadeSelects({
      container: modalRoot.querySelector('#job-position-select'),
      categoryType: 'JOB',
      maxDepth: 1,
      placeholderLabels: ['직군'],
      initialValue: posting?.position_category_id || null,
      onChange: async (value) => {
        detailApi = await mountCategoryCheckboxesByParent({
          container: detailContainer,
          parentId: value,
          initialSelectedIds: isEdit && value === posting.position_category_id
            ? posting.position_detail_category_ids
            : [],
        });
      },
    });

    if (isEdit) {
      modalRoot.querySelector('#job-employment-type').value = posting.employment_type;
      modalRoot.querySelector('#job-annual-from').value = posting.annual_from;
      if (posting.annual_to != null) modalRoot.querySelector('#job-annual-to').value = posting.annual_to;
    }

    function closeModal() {
      modalRoot.innerHTML = '';
    }
    modalRoot.querySelector('#job-modal-close').addEventListener('click', closeModal);
    modalRoot.querySelector('#job-modal-cancel').addEventListener('click', closeModal);
    modalRoot.querySelector('#job-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'job-modal-overlay') closeModal();
    });

    modalRoot.querySelector('#job-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = modalRoot.querySelector('#job-form-status');
      const positionId = positionApi.getValue();
      const employmentType = modalRoot.querySelector('#job-employment-type').value;
      const annualFromRaw = modalRoot.querySelector('#job-annual-from').value;
      const annualToRaw = modalRoot.querySelector('#job-annual-to').value;

      if (!positionId || !employmentType || annualFromRaw === '') {
        statusEl.textContent = '직군/고용형태/최소 경력을 모두 입력해주세요.';
        return;
      }

      const body = {
        position_category_id: positionId,
        employment_type: employmentType,
        annual_from: Number(annualFromRaw),
        annual_to: annualToRaw === '' ? null : Number(annualToRaw),
        position_detail_category_ids: detailApi.getValue(),
      };

      statusEl.textContent = isEdit ? '수정 중입니다...' : '등록 중입니다...';
      try {
        if (isEdit) {
          await apiClient.put(`/company/job-postings/${posting.id}`, body);
        } else {
          // 신규 공고는 항상 draft로 생성한다 — 게시/마감은 목록의 상태 전환 버튼으로만 수행한다.
          await apiClient.post('/company/job-postings', { ...body, status: 'draft' });
        }
        closeModal();
        await loadList();
      } catch (err) {
        statusEl.textContent = errMsg(err);
      }
    });
  }

  statusFilter.addEventListener('change', loadList);
  createBtn.addEventListener('click', () => openModal(null));

  await loadList();
}
