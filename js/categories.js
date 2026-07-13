import { supabase } from './supabaseClient.js';

// DB.md 3.2절 categories 테이블: category_type(INDUSTRY/JOB/SKILL/REGION), parent_id, title, depth.
// 가입 폼/필터 UI는 이 테이블을 조회한 결과로만 선택지를 구성한다(PRD 2장 자유 텍스트 금지 원칙).

export async function fetchTopCategories(categoryType) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, title, depth, parent_id')
    .eq('category_type', categoryType)
    .is('parent_id', null)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('fetchTopCategories error', error);
    return [];
  }
  return data || [];
}

export async function fetchChildCategories(parentId) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, title, depth, parent_id')
    .eq('parent_id', parentId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('fetchChildCategories error', error);
    return [];
  }
  return data || [];
}

export async function fetchCategoryById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('categories')
    .select('id, title, depth, parent_id, category_type')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('fetchCategoryById error', error);
    return null;
  }
  return data;
}

export async function fetchCategoriesByIds(ids) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from('categories')
    .select('id, title, depth, parent_id, category_type')
    .in('id', uniqueIds);

  if (error) {
    console.error('fetchCategoriesByIds error', error);
    return {};
  }

  const map = {};
  (data || []).forEach((row) => {
    map[row.id] = row;
  });
  return map;
}

/**
 * 계층형 카테고리(업종/직무/지역)를 대분류→중분류→소분류 순서로 선택하는 select 그룹을 렌더링한다.
 * 자식 카테고리가 더 없으면 그 단계를 최종(leaf) 선택값으로 취급한다.
 */
export function mountCascadeSelects({ container, categoryType, maxDepth, placeholderLabels, onChange }) {
  container.innerHTML = '';
  let selects = [];
  let currentValue = null;

  function notify(value) {
    currentValue = value;
    onChange?.(value);
  }

  function clearFrom(index) {
    for (let i = selects.length - 1; i >= index; i -= 1) {
      selects[i].remove();
    }
    selects = selects.slice(0, index);
  }

  async function addSelect(depthIndex, parentId) {
    const select = document.createElement('select');
    select.className = 'form-select';
    const label = placeholderLabels?.[depthIndex] || `${categoryType} ${depthIndex + 1}단계`;
    select.setAttribute('aria-label', label);

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = `${label} 선택`;
    select.appendChild(placeholderOption);

    const rows = parentId === null
      ? await fetchTopCategories(categoryType)
      : await fetchChildCategories(parentId);

    rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.title;
      select.appendChild(option);
    });

    select.addEventListener('change', async () => {
      clearFrom(depthIndex + 1);
      const value = select.value || null;

      if (!value) {
        notify(null);
        return;
      }

      if (depthIndex + 1 >= maxDepth) {
        notify(value);
        return;
      }

      const children = await fetchChildCategories(value);
      if (children.length > 0) {
        notify(null);
        await addSelect(depthIndex + 1, value);
      } else {
        notify(value);
      }
    });

    selects.push(select);
    container.appendChild(select);
  }

  addSelect(0, null);

  return {
    getValue: () => currentValue,
  };
}

/**
 * 스킬(SKILL)은 단일 레벨 평면 목록이므로(PRD 3장) 다중 선택 체크박스 그룹으로 렌더링한다.
 */
export async function mountSkillCheckboxes({ container, onChange }) {
  container.innerHTML = '';
  const rows = await fetchTopCategories('SKILL');
  const selected = new Set();

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-state">등록된 스킬 카테고리가 없습니다.</p>';
    return { getValue: () => [] };
  }

  rows.forEach((row) => {
    const inputId = `skill-${row.id}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'tag tag--checkbox';
    wrapper.setAttribute('for', inputId);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId;
    input.value = row.id;
    input.className = 'sr-only-checkbox';

    input.addEventListener('change', () => {
      if (input.checked) {
        selected.add(row.id);
      } else {
        selected.delete(row.id);
      }
      wrapper.classList.toggle('tag--checked', input.checked);
      onChange?.(Array.from(selected));
    });

    wrapper.appendChild(input);
    wrapper.append(row.title);
    container.appendChild(wrapper);
  });

  return {
    getValue: () => Array.from(selected),
  };
}
