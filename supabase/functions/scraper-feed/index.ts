// scraper-feed: public read-only feed of creators, posts, images and extracted prompts.
// Default: all creators EXCEPT `nextunyte` (that gallery lives at freym.app/next).
// ?creator=<handle> returns only that creator's posts (used by /next).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/scraper-images/`;
const SIDE_GALLERY_HANDLE = "nextunyte";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const wanted = new URL(req.url).searchParams.get("creator");

  const { data: allCreators, error: cErr } = await supabase
    .from("sc_creators")
    .select("id, handle, full_name, bio, profile_pic_url, stored_avatar_path, follower_count")
    .order("handle");

  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  const creators = (allCreators ?? []).filter((c) =>
    wanted ? c.handle === wanted : c.handle !== SIDE_GALLERY_HANDLE,
  );

  let postsQuery = supabase
    .from("sc_posts")
    .select(
      "id, creator_id, url, caption, taken_at, like_count, has_prompt, prompt_text, model_name, style_tags, confidence, sc_images(url, stored_path, width, height, position)",
    )
    .order("taken_at", { ascending: false })
    .limit(2000);

  if (wanted) {
    // Unknown handle → empty feed rather than an error.
    postsQuery = postsQuery.in("creator_id", creators.map((c) => c.id));
  } else {
    const excluded = (allCreators ?? []).find((c) => c.handle === SIDE_GALLERY_HANDLE);
    if (excluded) postsQuery = postsQuery.neq("creator_id", excluded.id);
  }

  const { data: posts, error: pErr } = await postsQuery;

  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  // Prefer mirrored copies — IG CDN blocks cross-origin rendering and its URLs expire.
  for (const c of creators) {
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
