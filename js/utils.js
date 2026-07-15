import { supabase } from './supabaseClient.js';

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
