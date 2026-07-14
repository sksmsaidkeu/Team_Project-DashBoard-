/**
 * app.js/tab-main.js(그리고 향후 company/jobseeker 탭)가 공유하는 최소 유틸.
 * XSS 방지용 escapeHtml과 role→tab 매핑을 한 곳에 둔다(REFACT.md P1-1/P1-5).
 */

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function tabForRole(role, fallback = 'main') {
  if (role === 'COMPANY') return 'company';
  if (role === 'JOBSEEKER') return 'jobseeker';
  return fallback;
}
