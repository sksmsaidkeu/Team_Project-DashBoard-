import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FEATURE_JOBSEEKER.md #6 카테고리 조회 API(공유) — 기업/구직자 양쪽 폼의 드롭다운/자동완성이
// 공통으로 쓴다. categories 테이블은 공개 SELECT RLS라 이 함수는 anon 조회로 충분하다.
// children_count는 반환된 각 카테고리의 하위 카테고리 개수(parent_id 기준)로,
// 계층형 드롭다운에서 "펼칠 항목이 있는지" 표시하는 데 쓴다.

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
  const categoryType = url.searchParams.get("category_type");
  const parentId = url.searchParams.get("parent_id");
  const search = url.searchParams.get("search");

  let query = db
    .from("categories")
    .select("id, title, category_type, depth, parent_id")
    .order("sort_order", { ascending: true })
    // 안전장치: 특히 search 모드는 parent_id로 좁히지 않으므로 결과가 커질 수 있다.
    // 결과 수를 제한해야 아래 children_count용 IN 목록도 함께 안전한 크기로 유지된다.
    .limit(50);
  if (categoryType) query = query.eq("category_type", categoryType);
  if (search) {
    // 자동완성 검색은 depth 전체를 대상으로 해야 하므로 parent_id로 좁히지 않는다.
    query = query.ilike("title", `%${search}%`);
  } else if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    // parent_id 미지정 + 검색어 없음 → 계층형 드롭다운의 최상위(depth 1)만 반환.
    // (아니면 JOB/REGION처럼 depth가 여러 단계인 타입 전체가 한 번에 반환돼
    // 아래 children_count 조회의 IN 목록이 비대해져 요청이 실패한다.)
    query = query.is("parent_id", null);
  }

  const { data: rows, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const ids = (rows ?? []).map((r) => r.id);
  const childCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: children, error: childError } = await db
      .from("categories")
      .select("parent_id")
      .in("parent_id", ids);
    if (childError) return json({ error: childError.message }, 500);
    for (const c of children ?? []) {
      if (!c.parent_id) continue;
      childCounts.set(c.parent_id, (childCounts.get(c.parent_id) ?? 0) + 1);
    }
  }

  const categories = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category_type: r.category_type,
    depth: r.depth,
    children_count: childCounts.get(r.id) ?? 0,
  }));

  return json({ categories });
});
