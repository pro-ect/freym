// scraper-top-creators: multi-network AI creator discovery (Instagram profile search +
// Reddit top authors from AI subreddits). TikTok lives in scraper-tiktok-creators (endpoint
// currently down upstream). Cached 24h. ?refresh=1 forces refetch; ?raw=ig|reddit debug sample.
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRAPER_KEY = Deno.env.get("SCRAPER_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CACHE_KEY = "top-creators";
const TTL_MS = 24 * 3600_000;
const IG_QUERIES = ["ai artist", "ai art creator", "ai video creator", "midjourney artist"];
const SUBREDDITS = ["StableDiffusion", "aivideo", "midjourney", "comfyui"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });

// Upstream search endpoints are flaky (DuckDuckGo-challenge 500s) — retry a few times.
async function scGet(path: string, params: Record<string, string>, attempts = 3) {
  const url = new URL(`https://api.scrapecreators.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { "x-api-key": SCRAPER_KEY } });
    if (res.ok) return res.json();
    lastErr = `${path} ${res.status}: ${await res.text()}`;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(lastErr);
}

// IG CDN blocks cross-origin rendering — mirror avatars into public storage.
async function mirrorAvatar(srcUrl: string, name: string): Promise<string | null> {
  try {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    const path = `discover/ig/${name}.jpg`;
    const { error } = await supabase.storage
      .from("scraper-images")
      .upload(path, await r.arrayBuffer(), { contentType: ct, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const params = new URL(req.url).searchParams;

  const raw = params.get("raw");
  if (raw === "ig") {
    const data = await scGet("/v1/instagram/search/profiles", { query: "ai artist" });
    return json({ topKeys: Object.keys(data), sample: JSON.stringify(data).slice(0, 2500) });
  }
  if (raw === "reddit") {
    const data = await scGet("/v1/reddit/subreddit", { subreddit: "StableDiffusion", sort: "top", timeframe: "week" });
    return json({ topKeys: Object.keys(data), sample: JSON.stringify(data).slice(0, 2500) });
  }

  if (params.get("refresh") !== "1") {
    const { data: hit } = await supabase
      .from("tt_popular_cache")
      .select("fetched_at, data")
      .eq("cache_key", CACHE_KEY)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TTL_MS) {
      return json({ cached: true, fetched_at: hit.fetched_at, ...hit.data });
    }
  }

  const errors: string[] = [];
  const STORAGE_BASE = `${Deno.env.get("SUPABASE_URL")!}/storage/v1/object/public/scraper-images/`;

  // --- Instagram: bio keyword search, dedupe, rank by followers ---
  // deno-lint-ignore no-explicit-any
  const igByUser = new Map<string, any>();
  for (const q of IG_QUERIES) {
    try {
      const data = await scGet("/v1/instagram/search/profiles", { query: q });
      // deno-lint-ignore no-explicit-any
      const list = (data.profiles ?? data.results ?? data.users ?? []) as any[];
      for (const p of list) {
        const username = p.username ?? p.user?.username;
        if (!username || igByUser.has(username)) continue;
        const src = p.user ?? p;
        if (src.is_private) continue;
        igByUser.set(username, {
          username,
          full_name: src.full_name ?? null,
          biography: (src.biography ?? "").slice(0, 200) || null,
          follower_count: src.follower_count ?? null,
          media_count: src.media_count ?? null,
          is_verified: src.is_verified ?? false,
          category: src.category_name ?? null,
          profile_pic_url: src.profile_pic_url ?? null,
          url: src.url ?? `https://www.instagram.com/${username}/`,
          matched_query: q,
        });
      }
    } catch (e) {
      errors.push(`ig "${q}": ${String(e)}`);
    }
  }
  const instagram = [...igByUser.values()].sort(
    (a, b) => (b.follower_count ?? 0) - (a.follower_count ?? 0),
  ).slice(0, 40);
  for (const p of instagram) {
    if (!p.profile_pic_url) continue;
    const path = await mirrorAvatar(p.profile_pic_url, p.username.replace(/[^a-zA-Z0-9_.-]/g, "_"));
    if (path) p.profile_pic_url = STORAGE_BASE + path;
    else p.profile_pic_url = null;
  }

  // --- Reddit: top authors of the week across AI subreddits ---
  // deno-lint-ignore no-explicit-any
  const byAuthor = new Map<string, any>();
  for (const sub of SUBREDDITS) {
    try {
      const data = await scGet("/v1/reddit/subreddit", { subreddit: sub, sort: "top", timeframe: "week" });
      // deno-lint-ignore no-explicit-any
      let list = (data.posts ?? data.data?.children ?? data.results ?? []) as any[];
      list = list.map((x) => x.data ?? x);
      for (const post of list) {
        const author = post.author ?? post.author_fullname;
        if (!author || author === "[deleted]" || author === "AutoModerator") continue;
        const score = Number(post.score ?? post.ups ?? 0);
        const entry = byAuthor.get(author) ?? { author, total_score: 0, posts: [] };
        entry.total_score += score;
        entry.posts.push({
          title: post.title ?? "",
          score,
          subreddit: post.subreddit ?? sub,
          num_comments: post.num_comments ?? null,
          url: post.permalink
            ? (String(post.permalink).startsWith("http") ? post.permalink : `https://www.reddit.com${post.permalink}`)
            : post.url ?? null,
        });
        byAuthor.set(author, entry);
      }
    } catch (e) {
      errors.push(`reddit r/${sub}: ${String(e)}`);
    }
  }
  const reddit = [...byAuthor.values()]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 30)
    // deno-lint-ignore no-explicit-any
    .map((a: any) => ({
      ...a,
      posts: a.posts.sort((x: { score: number }, y: { score: number }) => y.score - x.score).slice(0, 3),
      profile_url: `https://www.reddit.com/user/${a.author}/`,
    }));

  const payload = { errors, instagram, reddit };
  if (instagram.length || reddit.length) {
    await supabase.from("tt_popular_cache").upsert({
      cache_key: CACHE_KEY,
      fetched_at: new Date().toISOString(),
      data: payload,
    });
  }
  return json({ cached: false, fetched_at: new Date().toISOString(), ...payload });
});
