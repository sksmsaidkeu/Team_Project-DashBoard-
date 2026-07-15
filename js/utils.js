import { supabase } from './supabaseClient.js';

/**
 * app.js/tab-main.js(그리고 company/jobseeker 탭)가 공유하는 최소 유틸.
 * common 브랜치의 escapeHtml/tabForRole(REFACT.md P1-1/P1-5)과 jobseeker 브랜치의
 * resolveRegionFilterIds/resolveCategoryFilterIds(REGION 하드필터 버그 수정)를
 * 병합 시 한쪽이 지워지지 않도록 이 파일 하나에 모아둔다.
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

/**
 * 선택된 카테고리 ID에서 그 자신과 모든 하위 카테고리 ID를 수집한다.
 * REGION/INDUSTRY/JOB 등 계층형 카테고리에 대해 하드 필터링 시 완전일치 대신
 * in() 쿼리로 사용할 ID 배열을 생성한다.
 *
 * 예: 서울 (depth 1) 선택 → [서울 id, 강남구 id, 강남구-논현동 id, ...] 모두 수집
 */
export async function resolveRegionFilterIds(categoryId) {
  if (!categoryId) return [];

  const ids = [categoryId];
  const queue = [categoryId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const { data: children, error } = await supabase
      .from('categories')
      .select('id')
      .eq('parent_id', currentId);

    if (error) {
      console.error('resolveRegionFilterIds error', error);
      continue;
    }

    (children || []).forEach((child) => {
      ids.push(child.id);
      queue.push(child.id);
    });
  }

  return ids;
}

/**
 * INDUSTRY/JOB 카테고리에 대해서도 동일한 로직을 적용한다.
 */
export async function resolveCategoryFilterIds(categoryId) {
  return resolveRegionFilterIds(categoryId);
}
