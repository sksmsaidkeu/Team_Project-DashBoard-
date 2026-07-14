import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #3 핫 스킬 조회 API.
// 데이터 소스: job_posting_position_details(구직자 희망 직무와 일치) + job_postings(최근 30일,
// status=active) + company_profiles.company_profile_skills(요구 스킬) — DB.md 5장 원칙대로
// 새 변수를 만들지 않고 기존 테이블 조합만 사용한다.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await db
    .from("jobseeker_profiles")
    .select("id, desired_position_category_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "구직자 프로필이 없습니다." }, 403);

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 5;

  const now = Date.now();
  const cutoffCurrent = new Date(now - 30 * 86_400_000).toISOString();
  const cutoffPrevStart = new Date(now - 60 * 86_400_000).toISOString();

  async function fetchSkillCounts(sinceIso: string, untilIso: string) {
    const { data, error } = await db
      .from("job_posting_position_details")
      .select(`
        job_postings!inner (
          posted_at,
          company_profiles ( company_profile_skills ( categories ( title ) ) )
        )
      `)
      .eq("position_detail_category_id", profile.desired_position_category_id)
      .eq("job_postings.status", "active")
      .gte("job_postings.posted_at", sinceIso)
      .lt("job_postings.posted_at", untilIso);
    if (error) throw error;

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const skills = (row as any).job_postings?.company_profiles?.company_profile_skills ?? [];
      for (const s of skills) {
        const title = s.categories?.title;
        if (!title) continue;
        counts.set(title, (counts.get(title) ?? 0) + 1);
      }
    }
    return counts;
  }

  let currentCounts: Map<string, number>;
  let prevCounts: Map<string, number>;
  try {
    currentCounts = await fetchSkillCounts(cutoffCurrent, new Date(now + 86_400_000).toISOString());
    prevCounts = await fetchSkillCounts(cutoffPrevStart, cutoffCurrent);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  const skills = [...currentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, frequency], idx) => {
      const prevFreq = prevCounts.get(name) ?? 0;
      const changeRate = prevFreq > 0 ? Math.round(((frequency - prevFreq) / prevFreq) * 1000) / 10 : null;
      return { rank: idx + 1, name, frequency, change_rate: changeRate };
    });

  return json({ skills });
});
