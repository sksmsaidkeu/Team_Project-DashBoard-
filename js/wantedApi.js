import { supabase } from './supabaseClient.js';

async function callWantedApi(path, query) {
  const { data, error } = await supabase.functions.invoke('wanted-proxy', {
    body: { path, query },
  });
  if (error) throw error;
  return data;
}

export const wantedApi = {
  getCategories: () => callWantedApi('/v1/tags/categories'),
  getSkills: () => callWantedApi('/v1/tags/skills'),
  getCompanyInsight: (companyId) => callWantedApi('/v1/insight/company', { company_id: companyId }),
};
