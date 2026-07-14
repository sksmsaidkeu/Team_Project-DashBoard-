import { supabase } from './supabaseClient.js';
import { mountCascadeSelects, mountSkillCheckboxes } from './categories.js';

const EMPLOYMENT_TYPE_LABEL = { regular: '정규직', contract: '계약직', intern: '인턴' };

/**
 * 회원가입 1단계(역할 선택) → 2단계(기업/구직자 분기 폼) 플로우를 연결한다.
 * PRD 2장: user_type 선택 후 역할 전환 불가, 자유 텍스트 대신 categories 테이블 선택지만 사용,
 * 이메일 인증 절차 없이 가입 즉시 로그인 상태로 전환.
 */
export function initSignup({ onSuccess }) {
  const step1 = document.getElementById('signup-step1');
  const companyForm = document.getElementById('signup-form-company');
  const jobseekerForm = document.getElementById('signup-form-jobseeker');

  let companyIndustry = null;
  let companyRegion = null;
  let companyPosition = null;
  let companySkills = null;
  let companyMounted = false;

  let jobseekerPosition = null;
  let jobseekerRegion = null;
  let jobseekerSkills = null;
  let jobseekerMounted = false;

  document.querySelectorAll('.role-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      step1.hidden = true;

      if (role === 'COMPANY') {
        companyForm.hidden = false;
        jobseekerForm.hidden = true;
        if (!companyMounted) {
          companyIndustry = mountCascadeSelects({
            container: document.getElementById('company-industry-select'),
            categoryType: 'INDUSTRY',
            maxDepth: 3,
            placeholderLabels: ['대분류', '중분류', '소분류'],
          });
          companyRegion = mountCascadeSelects({
            container: document.getElementById('company-region-select'),
            categoryType: 'REGION',
            maxDepth: 3,
            placeholderLabels: ['시도', '시군구', '읍면동'],
          });
          companyPosition = mountCascadeSelects({
            container: document.getElementById('company-position-select'),
            categoryType: 'JOB',
            maxDepth: 2,
            placeholderLabels: ['직군', '직무'],
          });
          mountSkillCheckboxes({
            container: document.getElementById('company-skills'),
          }).then((api) => { companySkills = api; });
          companyMounted = true;
        }
      } else {
        jobseekerForm.hidden = false;
        companyForm.hidden = true;
        if (!jobseekerMounted) {
          jobseekerPosition = mountCascadeSelects({
            container: document.getElementById('jobseeker-position-select'),
            categoryType: 'JOB',
            maxDepth: 2,
            placeholderLabels: ['직군', '직무'],
          });
          jobseekerRegion = mountCascadeSelects({
            container: document.getElementById('jobseeker-region-select'),
            categoryType: 'REGION',
            maxDepth: 3,
            placeholderLabels: ['시도', '시군구', '읍면동'],
          });
          mountSkillCheckboxes({
            container: document.getElementById('jobseeker-skills'),
          }).then((api) => { jobseekerSkills = api; });
          jobseekerMounted = true;
        }
      }
    });
  });

  document.querySelectorAll('[data-signup-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      companyForm.hidden = true;
      jobseekerForm.hidden = true;
      step1.hidden = false;
    });
  });

  companyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitSignup({
      userType: 'COMPANY',
      formId: 'signup-form-company',
      statusId: 'company-signup-status',
      fields: [
        { key: 'email', elementId: 'company-email', required: true },
        { key: 'password', elementId: 'company-password', required: true },
        { key: 'industryId', kind: 'select-getter', getValue: () => companyIndustry?.getValue(), required: true },
        { key: 'regionId', kind: 'select-getter', getValue: () => companyRegion?.getValue(), required: true },
        { key: 'positionId', kind: 'select-getter', getValue: () => companyPosition?.getValue(), required: true },
        { key: 'companySize', elementId: 'company-size', required: true },
        { key: 'employmentType', elementId: 'company-employment-type', required: true },
        { key: 'skillIds', kind: 'select-getter', getValue: () => companySkills?.getValue() || [] },
        { key: 'averageSalaryRaw', elementId: 'company-average-salary' },
        { key: 'hiredSalaryRaw', elementId: 'company-hired-salary' },
      ],
      profileTable: 'company_profiles',
      buildProfileRow: (v, authUserId) => ({
        user_id: authUserId,
        industry_category_id: v.industryId,
        company_size: v.companySize,
        region_category_id: v.regionId,
        position_category_id: v.positionId,
        employment_type: v.employmentType,
        average_salary: v.averageSalaryRaw ? Number(v.averageSalaryRaw) : null,
        hired_salary: v.hiredSalaryRaw ? Number(v.hiredSalaryRaw) : null,
      }),
      skillTable: 'company_profile_skills',
      skillFkColumn: 'company_profile_id',
      requiredFieldsMessage: '이메일/비밀번호/업종/위치/직무/고용형태/기업 규모를 모두 입력해주세요.',
      successMessage: '가입이 완료되었습니다. 기업 탭으로 이동합니다.',
      onSuccess,
    });
  });

  jobseekerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitSignup({
      userType: 'JOBSEEKER',
      formId: 'signup-form-jobseeker',
      statusId: 'jobseeker-signup-status',
      fields: [
        { key: 'email', elementId: 'jobseeker-email', required: true },
        { key: 'password', elementId: 'jobseeker-password', required: true },
        { key: 'positionId', kind: 'select-getter', getValue: () => jobseekerPosition?.getValue(), required: true },
        { key: 'regionId', kind: 'select-getter', getValue: () => jobseekerRegion?.getValue(), required: true },
        { key: 'careerYearsRaw', elementId: 'jobseeker-career-years', required: true },
        { key: 'skillIds', kind: 'select-getter', getValue: () => jobseekerSkills?.getValue() || [] },
        { key: 'desiredSalaryRaw', elementId: 'jobseeker-desired-salary' },
        { key: 'desiredEmploymentType', elementId: 'jobseeker-employment-type', required: true },
        { key: 'isSalaryPublic', kind: 'checkbox', elementId: 'jobseeker-salary-public' },
        { key: 'isRegionPublic', kind: 'checkbox', elementId: 'jobseeker-region-public' },
      ],
      profileTable: 'jobseeker_profiles',
      buildProfileRow: (v, authUserId) => ({
        user_id: authUserId,
        desired_position_category_id: v.positionId,
        career_years: Number(v.careerYearsRaw),
        region_category_id: v.regionId,
        desired_salary: v.desiredSalaryRaw ? Number(v.desiredSalaryRaw) : null,
        desired_employment_type: v.desiredEmploymentType,
        is_salary_public: v.isSalaryPublic,
        is_region_public: v.isRegionPublic,
      }),
      skillTable: 'jobseeker_profile_skills',
      skillFkColumn: 'jobseeker_profile_id',
      requiredFieldsMessage: '이메일/비밀번호/희망직무/거주지역/경력연차/희망근무형태를 모두 입력해주세요.',
      successMessage: '가입이 완료되었습니다. 구직자 탭으로 이동합니다.',
      onSuccess,
    });
  });
}

/**
 * 회원가입 제출 공용 처리 (REFACT.md P1-3). 기업/구직자 가입 폼은 필드명·테이블명만 다르고
 * "폼 필드 읽기 -> 필수값 검증 -> auth.signUp -> users insert -> 프로필 insert -> 스킬 insert"
 * 구조가 동일해 하나로 통합했다. 이 함수 한 곳에서만 중간 실패 롤백을 처리한다.
 *
 * @param {object} opts
 * @param {'COMPANY'|'JOBSEEKER'} opts.userType
 * @param {string} opts.formId
 * @param {string} opts.statusId
 * @param {Array<{key: string, elementId?: string, kind?: 'text'|'checkbox'|'select-getter', getValue?: () => any, required?: boolean}>} opts.fields
 * @param {string} opts.profileTable
 * @param {(values: object, authUserId: string) => object} opts.buildProfileRow
 * @param {string} opts.skillTable
 * @param {string} opts.skillFkColumn
 * @param {string} opts.requiredFieldsMessage
 * @param {string} opts.successMessage
 * @param {(userType: string) => void} [opts.onSuccess]
 */
async function submitSignup({
  userType,
  formId,
  statusId,
  fields,
  profileTable,
  buildProfileRow,
  skillTable,
  skillFkColumn,
  requiredFieldsMessage,
  successMessage,
  onSuccess,
}) {
  const form = document.getElementById(formId);
  const statusEl = document.getElementById(statusId);
  const submitBtn = form.querySelector('button[type="submit"]');
  statusEl.textContent = '';

  const values = {};
  fields.forEach((f) => {
    if (f.kind === 'select-getter') {
      values[f.key] = f.getValue?.() ?? null;
    } else if (f.kind === 'checkbox') {
      values[f.key] = document.getElementById(f.elementId).checked;
    } else {
      values[f.key] = document.getElementById(f.elementId).value.trim();
    }
  });

  const missingRequired = fields.some((f) => {
    if (!f.required) return false;
    const v = values[f.key];
    return v === '' || v === null || v === undefined;
  });
  if (missingRequired) {
    statusEl.textContent = requiredFieldsMessage;
    return;
  }

  submitBtn.disabled = true;
  statusEl.textContent = '가입 처리 중입니다...';

  let authUserId = null;
  let insertedUserRow = false;
  let insertedProfileId = null;

  try {
    // NOTE: Supabase Auth의 이메일 컨펌(Email Confirmations)이 프로젝트 설정에서 꺼져 있어야
    // signUp 직후 세션이 즉시 발급된다(PRD 2장). 이 설정은 Supabase 대시보드에서 별도로 처리한다.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
    });
    if (signUpError) throw signUpError;

    authUserId = signUpData.user?.id;
    if (!authUserId) throw new Error('계정 생성에 실패했습니다.');

    const { error: userInsertError } = await supabase
      .from('users')
      .insert({ id: authUserId, user_type: userType });
    if (userInsertError) throw userInsertError;
    insertedUserRow = true;

    const { data: profileRow, error: profileError } = await supabase
      .from(profileTable)
      .insert(buildProfileRow(values, authUserId))
      .select()
      .single();
    if (profileError) throw profileError;
    insertedProfileId = profileRow.id;

    const skillIds = values.skillIds || [];
    if (skillIds.length > 0) {
      const rows = skillIds.map((skillId) => ({
        [skillFkColumn]: profileRow.id,
        skill_category_id: skillId,
      }));
      const { error: skillError } = await supabase.from(skillTable).insert(rows);
      if (skillError) throw skillError;
    }

    statusEl.textContent = successMessage;
    onSuccess?.(userType);
  } catch (err) {
    console.error(err);

    // 중간 실패 롤백(REFACT.md P1-3): auth.signUp 이후 만들어진 users/프로필 행을 최선 노력으로 되돌린다.
    // 주의: auth.users 자체는 anon 권한(client_id/secret 없음)으로 삭제할 수 없어 인증 계정은 남을 수
    // 있다 — 이 경우 users/프로필 행만 정리되고 재가입 시 signUp이 "이미 가입된 이메일"로 막힐 수
    // 있으므로, 서비스 운영 단계에서는 관리자가 Supabase Auth 콘솔에서 해당 계정을 정리해야 한다.
    if (insertedProfileId) {
      const { error: rollbackProfileError } = await supabase.from(profileTable).delete().eq('id', insertedProfileId);
      if (rollbackProfileError) console.error('signup rollback: profile delete failed', rollbackProfileError);
    }
    if (insertedUserRow) {
      const { error: rollbackUserError } = await supabase.from('users').delete().eq('id', authUserId);
      if (rollbackUserError) console.error('signup rollback: user delete failed', rollbackUserError);
    }

    statusEl.textContent = `가입 중 오류가 발생했습니다: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

export function employmentTypeLabel(type) {
  return EMPLOYMENT_TYPE_LABEL[type] || type;
}
