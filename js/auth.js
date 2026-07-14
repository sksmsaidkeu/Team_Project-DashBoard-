import { supabase } from './supabaseClient.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('getSession error', error);
    return null;
  }
  return data.session;
}

/**
 * 로그인한 사용자의 users 행 + (COMPANY/JOBSEEKER에 맞는) 프로필 행을 함께 반환한다.
 * DB.md 3.1/3.3/3.5절 — users.user_type에 따라 company_profiles / jobseeker_profiles 중 하나만 존재한다.
 */
export async function getCurrentUserProfile() {
  const session = await getSession();
  if (!session) return null;
  const authUser = session.user;

  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id, user_type')
    .eq('id', authUser.id)
    .maybeSingle();

  if (userError) {
    console.error('getCurrentUserProfile users error', userError);
    return null;
  }
  if (!userRow) {
    return { authUser, userType: null, profile: null };
  }

  if (userRow.user_type === 'COMPANY') {
    // (REFACT.md P2-5) 실제로 소비되는 컬럼만 명시(js/matching.js, js/tab-company.js 등에서 사용).
    const { data: companyProfile, error: profileError } = await supabase
      .from('company_profiles')
      .select('id, position_category_id, region_category_id')
      .eq('user_id', authUser.id)
      .maybeSingle();
    if (profileError) console.error('company_profiles fetch error', profileError);
    return { authUser, userType: 'COMPANY', profile: companyProfile };
  }

  if (userRow.user_type === 'JOBSEEKER') {
    // (REFACT.md P2-5) 실제로 소비되는 컬럼만 명시(js/matching.js, js/tab-jobseeker.js 등에서 사용).
    const { data: jobseekerProfile, error: profileError } = await supabase
      .from('jobseeker_profiles')
      .select('id, desired_position_category_id, desired_employment_type, region_category_id')
      .eq('user_id', authUser.id)
      .maybeSingle();
    if (profileError) console.error('jobseeker_profiles fetch error', profileError);
    return { authUser, userType: 'JOBSEEKER', profile: jobseekerProfile };
  }

  return { authUser, userType: userRow.user_type, profile: null };
}

export function loginWithPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function logout() {
  return supabase.auth.signOut();
}
