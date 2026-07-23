// scraper-feed: public read-only feed of creators, posts, images and extracted prompts.
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

  const [{ data: creators, error: cErr }, { data: posts, error: pErr }] = await Promise.all([
    supabase
      .from("sc_creators")
      .select("id, handle, full_name, bio, profile_pic_url, stored_avatar_path, follower_count")
      .order("handle"),
    supabase
      .from("sc_posts")
      .select(
        "id, creator_id, url, caption, taken_at, like_count, has_prompt, prompt_text, model_name, style_tags, confidence, sc_images(url, stored_path, width, height, position)",
      )
      .order("taken_at", { ascending: false })
      .limit(500),
  ]);

  if (cErr || pErr) {
    return new Response(JSON.stringify({ error: (cErr ?? pErr)!.message }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  // Prefer mirrored copies — IG CDN blocks cross-origin rendering and its URLs expire.
  for (const c of creators ?? []) {
    if (c.stored_avatar_path) c.profile_pic_url = STORAGE_BASE + c.stored_avatar_path;
    delete c.stored_avatar_path;
  }
  for (const p of posts ?? []) {
    for (const im of p.sc_images ?? []) {
      if (im.stored_path) im.url = STORAGE_BASE + im.stored_path;
      delete im.stored_path;
    }
  }

  return new Response(JSON.stringify({ creators, posts }), {
    headers: {
      ...cors,
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
});
