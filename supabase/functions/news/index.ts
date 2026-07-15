import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #5 뉴스 조회 API.
// PRD 8장 임시 처리: news 테이블(수동 등록)에서 조회. industry_id가 있으면 해당 업종 뉴스 +
// 업종 무관 일반 뉴스(industry_category_id IS NULL)를 함께 반환한다.
// news 테이블은 공개 SELECT RLS라 인증 없이도 열람 가능한 정보지만, 다른 함수들과 동일하게
// 로그인 세션을 통해서만 호출되도록 verify_jwt를 켜둔다.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const url = new URL(req.url);
  let body: { industry_id?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* body 없음 */ }
  const industryId = body.industry_id ?? url.searchParams.get("industry_id");
  const limit = Number(body.limit ?? url.searchParams.get("limit")) || 10;

  let query = db
    .from("news")
    .select("id, title, source, url, published_at")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (industryId) {
    query = query.or(`industry_category_id.eq.${industryId},industry_category_id.is.null`);
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ items: data ?? [] });
});
