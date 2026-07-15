import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #2 인사이트 조회 API.
// "진행 중" 지표는 현재 스냅샷 값만 제공한다 — 과거 특정 시점의 파이프라인 단계를 별도로
// 이력 저장하지 않는 한(jobseeker_applications는 현재 상태만 들고 있음) 정확한 전기간 대비
// 변화량을 계산할 방법이 없어 change를 null로 둔다. 총 지원/합격률은 applied_at 기준으로
// 기간을 나눠 비교할 수 있어 change를 계산한다.

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

function signed(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

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

  const url = new URL(req.url);
  let body: { period?: string } = {};
  try { body = await req.json(); } catch { /* body 없음 */ }
  const periodParam = body.period ?? url.searchParams.get("period");
  const period = periodParam === "week" ? "week" : "month";
  const periodDays = period === "week" ? 7 : 30;

  const now = Date.now();
  const periodStart = new Date(now - periodDays * 86_400_000);
  const prevPeriodStart = new Date(now - periodDays * 2 * 86_400_000);

  const { data: apps, error } = await db
    .from("jobseeker_applications")
    .select("pipeline_stage, outcome, applied_at")
    .eq("jobseeker_profile_id", profile.id);
  if (error) return json({ error: error.message }, 500);

  const list = apps ?? [];
  const totalCurrent = list.filter((a) => new Date(a.applied_at) >= periodStart).length;
  const totalPrev = list.filter(
    (a) => new Date(a.applied_at) >= prevPeriodStart && new Date(a.applied_at) < periodStart,
  ).length;

  const inProgress = list.filter((a) => a.pipeline_stage === "review" || a.pipeline_stage === "interview").length;

  const resultRows = list.filter((a) => a.pipeline_stage === "result" && a.outcome);
  const passedCurrent = resultRows.filter((a) => a.outcome === "passed").length;
  const passRateCurrent = resultRows.length > 0 ? Math.round((passedCurrent / resultRows.length) * 100) : 0;

  const resultRowsPrev = resultRows.filter((a) => new Date(a.applied_at) < periodStart);
  const passedPrev = resultRowsPrev.filter((a) => a.outcome === "passed").length;
  const passRatePrev = resultRowsPrev.length > 0 ? Math.round((passedPrev / resultRowsPrev.length) * 100) : 0;

  const stats = [
    { label: "총 지원", value: list.length, change: signed(totalCurrent - totalPrev) },
    { label: "진행 중", value: inProgress, change: null },
    { label: "합격률", value: passRateCurrent, change: `${signed(passRateCurrent - passRatePrev)}%` },
  ];

  return json({ stats });
});
