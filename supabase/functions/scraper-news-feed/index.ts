// scraper-news-feed: public read-only feed of gen-AI model news scraped from official X accounts.
// ?days=N (default 5) limits the window; ?all=1 includes non-news tweets too (debug).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/scraper-images/`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const params = new URL(req.url).searchParams;
  const days = Math.min(Number(params.get("days") ?? "5") || 5, 90);
  const includeAll = params.get("all") === "1";
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: sources, error: sErr } = await supabase
    .from("news_sources")
    .select("id, handle, name, company, profile_pic_url, stored_avatar_path, follower_count")
    .order("company");
  if (sErr) {
    return new Response(JSON.stringify({ error: sErr.message }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  let q = supabase
    .from("news_items")
    .select(
      "id, source_id, url, text, taken_at, like_count, retweet_count, view_count, is_news, headline, summary, model_name, category, image_url, stored_image_path",
    )
    .gte("taken_at", since)
    .order("taken_at", { ascending: false })
    .limit(1000);
  if (!includeAll) q = q.eq("is_news", true);

  const { data: items, error: iErr } = await q;
  if (iErr) {
    return new Response(JSON.stringify({ error: iErr.message }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  for (const s of sources ?? []) {
    if (s.stored_avatar_path) s.profile_pic_url = STORAGE_BASE + s.stored_avatar_path;
    delete s.stored_avatar_path;
  }
  for (const it of items ?? []) {
    if (it.stored_image_path) it.image_url = STORAGE_BASE + it.stored_image_path;
    delete it.stored_image_path;
  }

  return new Response(JSON.stringify({ days, sources, items }), {
    headers: {
      ...cors,
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
});
