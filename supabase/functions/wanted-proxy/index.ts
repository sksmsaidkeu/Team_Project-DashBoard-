import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 원티드(Wanted) Open API 서버사이드 프록시.
// 클라이언트 자격증명(wanted-client-id/secret)은 이 함수 안에서만 다루고
// 브라우저로는 절대 내려보내지 않는다. 값은 Supabase Edge Function secret으로 등록한다:
//   supabase secrets set --env-file .env --project-ref <project-ref>
const WANTED_API_BASE = "https://openapi.wanted.jobs";

// 원티드 API 네임스페이스(v1)만 허용 — 이 함수가 임의 호스트로 요청을 전달하는
// 오픈 프록시가 되지 않도록 제한한다.
const ALLOWED_PATH_PREFIX = "/v1/";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { path?: string; query?: Record<string, string | number | undefined> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { path, query } = body ?? {};
  if (typeof path !== "string" || !path.startsWith(ALLOWED_PATH_PREFIX)) {
    return new Response(
      JSON.stringify({ error: `path must start with ${ALLOWED_PATH_PREFIX}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const clientId = Deno.env.get("WANTED_CLIENT_ID");
  const clientSecret = Deno.env.get("WANTED_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: "Wanted API credentials not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(WANTED_API_BASE + path);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const wantedRes = await fetch(url, {
    method: "GET",
    headers: {
      "wanted-client-id": clientId,
      "wanted-client-secret": clientSecret,
    },
  });

  const data = await wantedRes.text();
  return new Response(data, {
    status: wantedRes.status,
    headers: { "Content-Type": wantedRes.headers.get("Content-Type") ?? "application/json" },
  });
});
