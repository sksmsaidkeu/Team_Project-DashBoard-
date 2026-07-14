import { supabase } from '../supabaseClient.js';

// FEATURE_JOBSEEKER.md #5 API 클라이언트 함수. 각 함수는 supabase/functions/<name> Edge
// Function을 호출한다 — user_id는 넘기지 않는다(서버가 호출자의 세션 JWT에서 직접 판별하므로
// 클라이언트가 지정할 필요도, 지정해서도 안 된다. supabase/functions/jobseeker-applications 등 참고).
// Edge Function 호출 실패(네트워크/함수 자체 에러) 시 error를 던지고, 함수가 200으로 응답했지만
// 바디에 error 필드를 담아 보낸 경우(예: 403 구직자 프로필 없음)도 동일하게 던진다.
async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function getApplications({ status } = {}) {
  return invoke('jobseeker-applications', status ? { status } : {});
}

export function getInsights({ period } = {}) {
  return invoke('jobseeker-insights', period ? { period } : {});
}

export function getTrendingSkills({ limit } = {}) {
  return invoke('jobseeker-trending-skills', limit ? { limit } : {});
}

export function getRecommendations({ limit } = {}) {
  return invoke('recommendations', limit ? { limit } : {});
}

export function getNews({ industryId, limit } = {}) {
  const body = {};
  if (industryId) body.industry_id = industryId;
  if (limit) body.limit = limit;
  return invoke('news', body);
}
