// scraper-feed: public read-only feed of creators, posts, images and extracted prompts.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const [{ data: creators, error: cErr }, { data: posts, error: pErr }] = await Promise.all([
    supabase
      .from("sc_creators")
      .select("id, handle, full_name, bio, profile_pic_url, follower_count")
      .order("handle"),
    supabase
      .from("sc_posts")
      .select(
        "id, creator_id, url, caption, taken_at, like_count, has_prompt, prompt_text, model_name, style_tags, confidence, sc_images(url, width, height, position)",
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

  return new Response(JSON.stringify({ creators, posts }), {
    headers: {
      ...cors,
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
});
