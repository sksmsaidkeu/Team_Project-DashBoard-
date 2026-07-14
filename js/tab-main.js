import { getCurrentUserProfile } from './auth.js';

/**
 * 메인 탭(#panel-main) — 로그인 이후 전용 대시보드 자리.
 * 로그인 이전 랜딩 콘텐츠는 '시작' 탭(#panel-start)으로 분리되었다(피드백 3번).
 * 실제 로그인 후 대시보드 내용은 공통 브랜치 병합 이후 별도 작업 범위이므로,
 * 여기서는 로그인 여부/역할에 따른 안내만 표시한다.
 */
export async function renderMainPanel(container) {
  if (!container) return;
  container.innerHTML = '<p class="empty-state">불러오는 중입니다...</p>';

  let session;
  try {
    session = await getCurrentUserProfile();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="empty-state">로그인 정보를 확인하지 못했습니다.</p>';
    return;
  }

  if (!session) {
    container.innerHTML = '<p class="empty-state">로그인 후 이용할 수 있는 대시보드입니다. \'시작\' 탭에서 로그인해주세요.</p>';
    return;
  }

  container.innerHTML = '<p class="empty-state">준비 중입니다. 곧 새로운 대시보드가 제공될 예정입니다.</p>';
}
