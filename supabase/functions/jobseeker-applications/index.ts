import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #1 지원 현황 조회 API.
// 입력은 클라이언트가 아니라 요청의 Authorization JWT에서 파생한다 — user_id를 클라이언트가
// 직접 지정하게 하면 타인의 지원 현황을 조회할 수 있게 되므로(IDOR), 반드시 서버에서
// auth.getUser()로 검증한 사용자만 기준으로 삼는다. jobseeker_applications 테이블 자체도
// RLS로 본인 소유만 접근 가능하지만, 여기서는 service_role로 조회하는 대신 이 검증을 1차 방어로 쓴다.

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

const STAGE_DEFS = [
  { key: "applied", name: "지원완료" },
  { key: "review", name: "서류심사" },
  { key: "interview", name: "면접" },
  { key: "result", name: "최종결과" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthedUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: profile } = await db
    .from("jobseeker_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "구직자 프로필이 없습니다." }, 403);

  // supabase-js의 functions.invoke()는 파라미터를 쿼리스트링이 아니라 POST body(JSON)로 보낸다.
  // curl 등 직접 호출 시 쿼리스트링도 계속 동작하도록 둘 다 지원한다(body 우선).
  const url = new URL(req.url);
  let body: { status?: string } = {};
  try { body = await req.json(); } catch { /* body 없음 */ }
  const status = body.status ?? url.searchParams.get("status");

  let query = db
    .from("jobseeker_applications")
    .select(`
      id, pipeline_stage, outcome, applied_at,
      job_postings (
        title,
        company_profiles ( company_name, company_profile_skills ( categories ( title ) ) )
      )
    `)
    .eq("jobseeker_profile_id", profile.id)
    .order("applied_at", { ascending: false });
  if (status) query = query.eq("pipeline_stage", status);

  const { data: apps, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const stages = STAGE_DEFS.map((def) => {
    const rows = (apps ?? []).filter((a: any) => a.pipeline_stage === def.key);
    return {
      stage_name: def.name,
      stage_key: def.key,
      count: rows.length,
      cards: rows.map((a: any) => ({
        id: a.id,
        job_title: a.job_postings?.title ?? "제목 미등록 공고",
        company_name: a.job_postings?.company_profiles?.company_name ?? "기업명 미등록",
        applied_at: a.applied_at,
        outcome: a.outcome,
        skills: (a.job_postings?.company_profiles?.company_profile_skills ?? [])
          .map((s: any) => s.categories?.title)
          .filter(Boolean),
      })),
    };
  });

  return json({ stages });
});
