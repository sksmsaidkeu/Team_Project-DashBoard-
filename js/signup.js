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
    await submitCompanySignup({
      companyIndustry, companyRegion, companyPosition, companySkills, onSuccess,
    });
  });

  jobseekerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitJobseekerSignup({
      jobseekerPosition, jobseekerRegion, jobseekerSkills, onSuccess,
    });
  });
}

async function submitCompanySignup({ companyIndustry, companyRegion, companyPosition, companySkills, onSuccess }) {
  const form = document.getElementById('signup-form-company');
  const statusEl = document.getElementById('company-signup-status');
  const submitBtn = form.querySelector('button[type="submit"]');
  statusEl.textContent = '';

  const email = document.getElementById('company-email').value.trim();
  const password = document.getElementById('company-password').value;
  const industryId = companyIndustry?.getValue();
  const regionId = companyRegion?.getValue();
  const positionId = companyPosition?.getValue();
  const companySize = document.getElementById('company-size').value.trim();
  const employmentType = document.getElementById('company-employment-type').value;
  const skillIds = companySkills?.getValue() || [];
  const averageSalaryRaw = document.getElementById('company-average-salary').value;
  const hiredSalaryRaw = document.getElementById('company-hired-salary').value;

  if (!email || !password || !industryId || !regionId || !positionId || !employmentType || !companySize) {
    statusEl.textContent = '이메일/비밀번호/업종/위치/직무/고용형태/기업 규모를 모두 입력해주세요.';
    return;
  }

  submitBtn.disabled = true;
  statusEl.textContent = '가입 처리 중입니다...';

  try {
    // NOTE: Supabase Auth의 이메일 컨펌(Email Confirmations)이 프로젝트 설정에서 꺼져 있어야
    // signUp 직후 세션이 즉시 발급된다(PRD 2장). 이 설정은 Supabase 대시보드에서 별도로 처리한다.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) throw signUpError;

    const authUserId = signUpData.user?.id;
    if (!authUserId) throw new Error('계정 생성에 실패했습니다.');

    const { error: userInsertError } = await supabase
      .from('users')
      .insert({ id: authUserId, user_type: 'COMPANY' });
    if (userInsertError) throw userInsertError;

    const { data: companyProfile, error: profileError } = await supabase
      .from('company_profiles')
      .insert({
        user_id: authUserId,
        industry_category_id: industryId,
        company_size: companySize,
        region_category_id: regionId,
        position_category_id: positionId,
        employment_type: employmentType,
        average_salary: averageSalaryRaw ? Number(averageSalaryRaw) : null,
        hired_salary: hiredSalaryRaw ? Number(hiredSalaryRaw) : null,
      })
      .select()
      .single();
    if (profileError) throw profileError;

    if (skillIds.length > 0) {
      const rows = skillIds.map((skillId) => ({
        company_profile_id: companyProfile.id,
        skill_category_id: skillId,
      }));
      const { error: skillError } = await supabase.from('company_profile_skills').insert(rows);
      if (skillError) throw skillError;
    }

    statusEl.textContent = '가입이 완료되었습니다. 기업 탭으로 이동합니다.';
    onSuccess?.('COMPANY');
  } catch (err) {
    console.error(err);
    statusEl.textContent = `가입 중 오류가 발생했습니다: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitJobseekerSignup({ jobseekerPosition, jobseekerRegion, jobseekerSkills, onSuccess }) {
  const form = document.getElementById('signup-form-jobseeker');
  const statusEl = document.getElementById('jobseeker-signup-status');
  const submitBtn = form.querySelector('button[type="submit"]');
  statusEl.textContent = '';

  const email = document.getElementById('jobseeker-email').value.trim();
  const password = document.getElementById('jobseeker-password').value;
  const positionId = jobseekerPosition?.getValue();
  const regionId = jobseekerRegion?.getValue();
  const careerYearsRaw = document.getElementById('jobseeker-career-years').value;
  const skillIds = jobseekerSkills?.getValue() || [];
  const desiredSalaryRaw = document.getElementById('jobseeker-desired-salary').value;
  const desiredEmploymentType = document.getElementById('jobseeker-employment-type').value;
  const isSalaryPublic = document.getElementById('jobseeker-salary-public').checked;
  const isRegionPublic = document.getElementById('jobseeker-region-public').checked;

  if (!email || !password || !positionId || !regionId || !desiredEmploymentType || careerYearsRaw === '') {
    statusEl.textContent = '이메일/비밀번호/희망직무/거주지역/경력연차/희망근무형태를 모두 입력해주세요.';
    return;
  }

  submitBtn.disabled = true;
  statusEl.textContent = '가입 처리 중입니다...';

  try {
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) throw signUpError;

    const authUserId = signUpData.user?.id;
    if (!authUserId) throw new Error('계정 생성에 실패했습니다.');

    const { error: userInsertError } = await supabase
      .from('users')
      .insert({ id: authUserId, user_type: 'JOBSEEKER' });
    if (userInsertError) throw userInsertError;

    const { data: jobseekerProfile, error: profileError } = await supabase
      .from('jobseeker_profiles')
      .insert({
        user_id: authUserId,
        desired_position_category_id: positionId,
        career_years: Number(careerYearsRaw),
        region_category_id: regionId,
        desired_salary: desiredSalaryRaw ? Number(desiredSalaryRaw) : null,
        desired_employment_type: desiredEmploymentType,
        is_salary_public: isSalaryPublic,
        is_region_public: isRegionPublic,
      })
      .select()
      .single();
    if (profileError) throw profileError;

    if (skillIds.length > 0) {
      const rows = skillIds.map((skillId) => ({
        jobseeker_profile_id: jobseekerProfile.id,
        skill_category_id: skillId,
      }));
      const { error: skillError } = await supabase.from('jobseeker_profile_skills').insert(rows);
      if (skillError) throw skillError;
    }

    statusEl.textContent = '가입이 완료되었습니다. 구직자 탭으로 이동합니다.';
    onSuccess?.('JOBSEEKER');
  } catch (err) {
    console.error(err);
    statusEl.textContent = `가입 중 오류가 발생했습니다: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

export function employmentTypeLabel(type) {
  return EMPLOYMENT_TYPE_LABEL[type] || type;
}
