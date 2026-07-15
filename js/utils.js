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
 *
 * 2026-07-16 수정: 구직자가 읍면동(REGION depth 3, 리프 노드)까지 선택하면 하위로 확장할
 * 자식이 없어 자기 자신 하나만 남는다 — 그러면 같은 구/시 안의 "다른 동" 회사(형제 노드,
 * 하위 확장으로는 절대 못 잡음)를 전부 놓친다(실제 사례: "원천동" 선택 구직자가 "매탄동"
 * 회사 — 둘 다 "수원시 영통구" 밑인데 매칭 실패). 그래서 먼저 depth 2(시군구) 이하로
 * 조상을 타고 올라간 뒤(이미 depth 2 이하면 그대로 둠) 거기서부터 하위 전체를 모은다 —
 * 실질적으로 "시군구" 단위까지만 매칭하고 읍면동 단위 구분은 무시한다(대부분의 채용
 * 플랫폼도 이 정도 granularity로 지역을 다룬다).
 */
export async function resolveRegionFilterIds(categoryId) {
  if (!categoryId) return [];

  let anchorId = categoryId;
  for (let i = 0; i < 5; i += 1) {
    const { data: current, error } = await supabase
      .from('categories')
      .select('depth, parent_id')
      .eq('id', anchorId)
      .maybeSingle();
    if (error) {
      console.error('resolveRegionFilterIds anchor lookup error', error);
      break;
    }
    if (!current || current.depth <= 2 || !current.parent_id) break;
    anchorId = current.parent_id;
  }

  const ids = [anchorId];
  const queue = [anchorId];

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
