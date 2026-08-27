// scraper-star: admin-only toggle that stars/unstars a scraped post.
// Starred posts feed the freym.app hero (scraper-feed?hero=1).
//
// The sc_* tables have RLS with no policies, so this runs with the service
// role; the caller must present the shared admin key in x-admin-key
// (SCRAPER_ADMIN_KEY secret). The site stores the key in localStorage after a
// one-time ?admin=<key> visit.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const adminKey = Deno.env.get("SCRAPER_ADMIN_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const postId = body?.post_id;
  const starred = body?.starred === true;
  if (typeof postId !== "string" || !postId) return json({ error: "post_id required" }, 400);

  const starredAt = starred ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("sc_posts")
    .update({ starred_at: starredAt })
    .eq("id", postId)
    .select("id, starred_at");

  if (error) return json({ error: error.message }, 500);
  if (!data?.length) return json({ error: "post not found" }, 404);

  return json({ success: true, post_id: postId, starred_at: data[0].starred_at });
});
