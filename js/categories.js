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
 * 카테고리 leaf id로부터 최상위 조상까지의 경로를 [최상위, ..., leaf] 순서로 반환한다.
 * mountCascadeSelects의 initialValue(수정 모달 등에서 기존 선택값 복원)에 사용한다.
 */
async function buildAncestorChain(id) {
  const chain = [];
  let current = await fetchCategoryById(id);
  while (current) {
    chain.unshift(current.id);
    if (!current.parent_id) break;
    current = await fetchCategoryById(current.parent_id);
  }
  return chain;
}

/**
 * 계층형 카테고리(업종/직무/지역)를 대분류→중분류→소분류 순서로 선택하는 select 그룹을 렌더링한다.
 * 자식 카테고리가 더 없으면 그 단계를 최종(leaf) 선택값으로 취급한다.
 *
 * @param {string} [initialValue] 기존 선택값(카테고리 id). 수정 모달 등에서 기존 값을 복원할 때 사용한다.
 */
export function mountCascadeSelects({ container, categoryType, maxDepth, placeholderLabels, onChange, initialValue }) {
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

  async function selectAt(depthIndex, value) {
    clearFrom(depthIndex + 1);
    selects[depthIndex].value = value || '';

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
  }

  async function addSelect(depthIndex, parentId) {
    const rows = parentId === null
      ? await fetchTopCategories(categoryType)
      : await fetchChildCategories(parentId);

    // 최상위 단계인데 선택할 카테고리가 아예 없으면 빈 셀렉트 대신 안내 문구를 노출한다.
    // (하위 단계에서는 selectAt이 children.length > 0일 때만 addSelect를 호출하므로 여기 도달하지 않는다.)
    if (rows.length === 0 && depthIndex === 0) {
      container.innerHTML = '<p class="empty-state">선택할 수 있는 카테고리가 아직 없습니다.</p>';
      return;
    }

    const select = document.createElement('select');
    select.className = 'form-select';
    const label = placeholderLabels?.[depthIndex] || `${categoryType} ${depthIndex + 1}단계`;
    select.setAttribute('aria-label', label);

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = `${label} 선택`;
    select.appendChild(placeholderOption);

    rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.title;
      select.appendChild(option);
    });

    select.addEventListener('change', () => {
      selectAt(depthIndex, select.value || null);
    });

    selects.push(select);
    container.appendChild(select);
  }

  (async () => {
    await addSelect(0, null);
    if (selects.length === 0) return;
    if (initialValue) {
      const chain = await buildAncestorChain(initialValue);
      for (let i = 0; i < chain.length && i < maxDepth; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await selectAt(i, chain[i]);
      }
    }
  })();

  return {
    getValue: () => currentValue,
  };
}

// SKILL 카테고리는 DB.md 3.2절상 계층이 없는 단일 레벨(parent_id 항상 NULL)이라 DB에 "그룹" 개념이
// 없다 — 실제 시드 데이터(원티드 키워드 검색 결과, ~226개)의 title을 훑어보고 프런트에서 키워드 기반으로
// 그룹핑한다(피드백 6번). 완벽한 분류보다 "쭉 나열된 것보다 찾기 쉬움"이 목표이므로, 애매한 항목은
// 아래 규칙 순서대로 첫 매치 그룹에 배정하고 나머지는 '기타'로 묶는다.
// 원티드 키워드 검색 특성상 의도와 다르게 섞여 들어온, 채용 스킬과 명백히 무관한 항목(예: 'C' 키워드
// 검색 결과로 딸려온 'C 형 간염'). DB에서 지우진 않고(삭제 금지 원칙) 선택 목록에서만 제외한다(피드백 3번).
// 'Lawson'/'Lawson General Ledger'(ERP/회계 소프트웨어)는 "AWS"의 부분 문자열("aws"가 "Lawson"에 포함)에
// 우연히 매치되어 '클라우드 · 인프라'로 잘못 분류되던 것도 여기서 함께 제외한다(피드백 5차 3번 확인 중 발견).
const SKILL_HIDDEN_TITLES = new Set([
  'C 형 간염', 'HCV', '스프링클러', '화재 스프링클러 시스템',
  'Lawson', 'Lawson General Ledger',
  // '디자인' 그룹 중 IT/제품·UX와 무관한 다른 분야(전자·기계·건축·제약·인테리어·출판 등) 디자인
  'Altium Designer', 'Design for Assembly', 'RF 디자인', '강철 디자인', '도시 디자인',
  '물리적 디자인', '소매 디자인', '약물 디자인', '인테리어 디자인', '자동차 디자인',
  '잡지 디자인', '조명 디자인', '조명기구 디자인',
  // '기타' 그룹 중 IT와 무관한 일반 업무/학술 용어
  '문학 리뷰', '성능 리뷰', '우수 프로세스', '운영 효율성', '피플 금융',
]);

// IT(개발/제품)와 무관한 그룹은 통째로 숨긴다(피드백 6차 — "IT와 관련된 스킬만 남기기").
const SKILL_HIDDEN_GROUPS = new Set(['마케팅 · 광고', '영업 · 채용 · 인사', '회계 · 재무', '물류']);

const SKILL_GROUP_OVERRIDES = {
  'IT 채용': '영업 · 채용 · 인사',
};

const SKILL_GROUP_RULES = [
  { name: '클라우드 · 인프라', test: /\bAWS\b|\bDocker\b|\bKubernetes\b|\bNagios\b|시스코/i },
  { name: '데이터 · DB', test: /SQL|Oracle|DB2/i },
  { name: '프레임워크 · 라이브러리', test: /React|Vue|Spring|Node\.js|라이브러리/i },
  { name: '프로그래밍 언어', test: /JavaScript|TypeScript|Python|Kotlin|Swift|C\+\+|C#|ANSI C|Embedded C|C 프로그래밍|자바 스크립트|^C$|^Java$/i },
  { name: '디자인', test: /디자인|Figma|Photoshop|UX|Design/i },
  { name: '마케팅 · 광고', test: /마케팅|광고|홍보|뷰스레터/i },
  { name: '영업 · 채용 · 인사', test: /영업|채용|인사|인터뷰/i },
  { name: '회계 · 재무', test: /회계|Accounting/i },
  { name: '물류', test: /물류|SCM/i },
  { name: '기획', test: /기획/i },
  { name: '오피스 · 생산성', test: /Excel|PowerPoint|엑셀|SnagIt/i },
];

const SKILL_GROUP_ORDER = [...SKILL_GROUP_RULES.map((rule) => rule.name), '기타'].filter(
  (name) => !SKILL_HIDDEN_GROUPS.has(name),
);

function groupSkillTitle(title) {
  if (SKILL_GROUP_OVERRIDES[title]) return SKILL_GROUP_OVERRIDES[title];
  const rule = SKILL_GROUP_RULES.find(({ test }) => test.test(title));
  return rule ? rule.name : '기타';
}

/**
 * 스킬(SKILL)은 단일 레벨 평면 목록이므로(PRD 3장) 다중 선택 체크박스 그룹으로 렌더링한다.
 * 목록이 길어(200개 이상) 위 키워드 규칙으로 소그룹 소제목을 붙이고, 스크롤 가능한 영역으로 감싼다.
 */
export async function mountSkillCheckboxes({ container, onChange }) {
  container.innerHTML = '';
  // 컨테이너가 원래 평면 태그 나열용 .skill-group(flex-wrap) 클래스를 갖고 있을 수 있는데,
  // 여기서는 자식이 태그가 아니라 .skill-group-block(제목+목록) 여러 개라 flex 레이아웃과 충돌해
  // 체크박스가 겹쳐 클릭이 안 되는 버그가 있었다 — 제거하고 스크롤 박스 클래스만 남긴다.
  container.classList.remove('skill-group');
  container.classList.add('skill-picker-scroll');
  const allRows = await fetchTopCategories('SKILL');
  const rows = allRows.filter(
    (row) => !SKILL_HIDDEN_TITLES.has(row.title) && !SKILL_HIDDEN_GROUPS.has(groupSkillTitle(row.title)),
  );
  const selected = new Set();

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-state">등록된 스킬 카테고리가 없습니다.</p>';
    return { getValue: () => [] };
  }

  const grouped = new Map();
  rows.forEach((row) => {
    const groupName = groupSkillTitle(row.title);
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(row);
  });

  SKILL_GROUP_ORDER.forEach((groupName) => {
    const groupRows = grouped.get(groupName);
    if (!groupRows || groupRows.length === 0) return;

    const block = document.createElement('div');
    block.className = 'skill-group-block';

    const heading = document.createElement('h4');
    heading.className = 'skill-group-block__title';
    heading.textContent = groupName;
    block.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'skill-group';
    block.appendChild(list);

    groupRows.forEach((row) => {
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

      // 라벨 클릭의 기본 동작(연결된 체크박스로 포커스 위임)을 브라우저가 그대로 수행하면,
      // 스크롤 가능한 부모(.skill-picker-scroll) 안에서 포커스된(화면에는 안 보이는) 체크박스를
      // 뷰포트에 보이게 하려고 강제로 스크롤하는 버그가 있었다(피드백 5번). 기본 동작을 막고
      // 체크 상태만 직접 토글한 뒤 change 이벤트를 수동으로 발생시켜 위 로직은 그대로 재사용한다.
      wrapper.addEventListener('click', (event) => {
        event.preventDefault();
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      });

      wrapper.appendChild(input);
      wrapper.append(row.title);
      list.appendChild(wrapper);
    });

    container.appendChild(block);
  });

  return {
    getValue: () => Array.from(selected),
  };
}

/**
 * 특정 부모 카테고리(예: JOB 직군, depth 1)의 자식 카테고리(직무 상세, depth 2)를
 * 다중 선택 체크박스 그룹으로 렌더링한다. 채용공고의 `position_detail_category_ids`
 * (DB.md 3.8.1절 job_posting_position_details) 입력에 사용한다.
 *
 * @param {string[]} [initialSelectedIds] 기존에 선택되어 있던 하위 카테고리 id 목록(수정 모달용)
 */
export async function mountCategoryCheckboxesByParent({ container, parentId, initialSelectedIds = [], onChange }) {
  container.innerHTML = '';

  if (!parentId) {
    container.innerHTML = '<p class="empty-state">상위 카테고리를 먼저 선택해주세요.</p>';
    return { getValue: () => [] };
  }

  const rows = await fetchChildCategories(parentId);
  const selected = new Set(initialSelectedIds);

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-state">하위 카테고리가 없습니다.</p>';
    return { getValue: () => [] };
  }

  rows.forEach((row) => {
    const inputId = `detail-${row.id}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'tag tag--checkbox';
    wrapper.setAttribute('for', inputId);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId;
    input.value = row.id;
    input.className = 'sr-only-checkbox';

    if (selected.has(row.id)) {
      input.checked = true;
      wrapper.classList.add('tag--checked');
    }

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
