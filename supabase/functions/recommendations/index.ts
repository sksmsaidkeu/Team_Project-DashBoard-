import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #4 추천공고 조회 API — PRD 5장 3단계 매칭 로직.
//
// 1) 하드 필터: status='active' AND 희망 직무 일치(job_posting_position_details, depth2
//    "직무"가 jobseeker_profiles.desired_position_category_id와 동일 — company_profiles의
//    position_category_id 주석과 동일한 depth 개념이라 판단) AND 희망 고용형태 일치
//    AND 거주 지역 일치(company_profiles.region_category_id) AND 보유 스킬 1개 이상 일치.
// 2) 소프트 스코어링(0~100): 스킬 40% + 직무 25%(하드필터로 이미 일치하므로 고정 100) +
//    지역·연봉 15%(지역은 하드필터로 고정 일치, 연봉은 desired_salary와
//    company_profiles.average_salary 근접도) + 활동성 10%(interaction_logs 상호작용 빈도) +
//    최신성 10%(posted_at 경과일).
// 3) 정렬: 점수 내림차순.
//
// salary_range는 원티드 공고 스키마에 급여 필드가 없어(DB.md 1.1절) company_profiles의
// average_salary/hired_salary 두 point-value를 조합해 범위처럼 표시한다(새 변수 생성 없음).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAuthedUser(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await anon.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await db
    .from("jobseeker_profiles")
    .select("id, desired_position_category_id, desired_employment_type, region_category_id, desired_salary")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "구직자 프로필이 없습니다." }, 403);

  const url = new URL(req.url);
  let reqBody: { limit?: number } = {};
  try { reqBody = await req.json(); } catch { /* body 없음 */ }
  const limit = Number(reqBody.limit ?? url.searchParams.get("limit")) || 20;

  const [{ data: skillRows }, { data: appliedRows }] = await Promise.all([
    db.from("jobseeker_profile_skills").select("skill_category_id").eq("jobseeker_profile_id", profile.id),
    db.from("jobseeker_applications").select("job_posting_id").eq("jobseeker_profile_id", profile.id),
  ]);
  const jobseekerSkillIds = new Set((skillRows ?? []).map((r) => r.skill_category_id));
  const appliedJobIds = new Set((appliedRows ?? []).map((r) => r.job_posting_id));

  // 하드 필터: 직무(job_posting_position_details) + 고용형태 + status
  const { data: candidates, error } = await db
    .from("job_posting_position_details")
    .select(`
      job_postings!inner (
        id, title, employment_type, posted_at, status,
        company_profiles (
          company_name, average_salary, hired_salary, region_category_id,
          region:categories!company_profiles_region_category_id_fkey ( title ),
          company_profile_skills ( skill_category_id, categories ( title ) )
        )
      )
    `)
    .eq("position_detail_category_id", profile.desired_position_category_id)
    .eq("job_postings.status", "active")
    .eq("job_postings.employment_type", profile.desired_employment_type);
  if (error) return json({ error: error.message }, 500);

  const [{ data: interactionRows }] = await Promise.all([
    db.from("interaction_logs").select("target_job_posting_id").eq("actor_user_id", user.id),
  ]);
  const interactionCounts = new Map<string, number>();
  for (const row of interactionRows ?? []) {
    if (!row.target_job_posting_id) continue;
    interactionCounts.set(row.target_job_posting_id, (interactionCounts.get(row.target_job_posting_id) ?? 0) + 1);
  }

  const now = Date.now();
  const seenJobIds = new Set<string>();
  const scored: any[] = [];

  for (const row of candidates ?? []) {
    const job = (row as any).job_postings;
    if (!job || seenJobIds.has(job.id) || appliedJobIds.has(job.id)) continue;
    const company = job.company_profiles;
    if (!company) continue;

    // 하드 필터: 거주 지역 일치
    if (company.region_category_id !== profile.region_category_id) continue;

    const companySkillIds: string[] = (company.company_profile_skills ?? []).map((s: any) => s.skill_category_id);
    const overlap = companySkillIds.filter((id) => jobseekerSkillIds.has(id));
    // 하드 필터: 보유 스킬 최소 1개 일치
    if (overlap.length === 0) continue;

    seenJobIds.add(job.id);

    const skillScore = clamp((overlap.length / Math.max(companySkillIds.length, 1)) * 100, 0, 100);
    const positionScore = 100; // 하드 필터로 이미 일치

    let salaryScore = 100;
    if (profile.desired_salary && company.average_salary) {
      const diffRatio = Math.abs(company.average_salary - profile.desired_salary) / profile.desired_salary;
      salaryScore = clamp(100 - diffRatio * 100, 0, 100);
    }

    const activityScore = clamp((interactionCounts.get(job.id) ?? 0) * 25, 0, 100);

    const daysSincePosted = job.posted_at ? (now - new Date(job.posted_at).getTime()) / 86_400_000 : 999;
    const recencyScore = clamp(100 - daysSincePosted * 3, 0, 100);

    const totalScore = Math.round(
      skillScore * 0.4 + positionScore * 0.25 + salaryScore * 0.15 + activityScore * 0.1 + recencyScore * 0.1,
    );

    const salaries = [company.average_salary, company.hired_salary].filter((v) => typeof v === "number");
    const salaryRange = salaries.length > 0
      ? `${Math.min(...salaries)}~${Math.max(...salaries)}만원`
      : null;

    scored.push({
      id: job.id,
      title: job.title ?? "제목 미등록 공고",
      company_name: company.company_name ?? "기업명 미등록",
      location: company.region?.title ?? null,
      salary_range: salaryRange,
      match_score: totalScore,
      required_skills: (company.company_profile_skills ?? []).map((s: any) => s.categories?.title).filter(Boolean),
    });
  }

  scored.sort((a, b) => b.match_score - a.match_score);
  const jobs = scored.slice(0, limit);

  return json({ jobs, total: jobs.length });
});
