// scraper-youtube-tutorials: YouTube tutorials for the models currently in the news feed.
// For each distinct model_name in recent news_items, searches "<model> tutorial" (this month).
// Cached 12h. ?refresh=1 forces refetch; ?raw=<query> returns a raw search sample (debug).
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRAPER_KEY = Deno.env.get("SCRAPER_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CACHE_KEY = "yt-tutorials";
const TTL_MS = 12 * 3600_000;
const MAX_MODELS = 10;
const PER_MODEL = 4;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=1800" },
  });

// deno-lint-ignore no-explicit-any
async function ytSearch(query: string): Promise<any> {
  const url = new URL("https://api.scrapecreators.com/v1/youtube/search");
  url.searchParams.set("query", query);
  url.searchParams.set("uploadDate", "this_month");
  url.searchParams.set("type", "videos");
  const res = await fetch(url, { headers: { "x-api-key": SCRAPER_KEY } });
  if (!res.ok) throw new Error(`youtube/search ${res.status}: ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const params = new URL(req.url).searchParams;

  const raw = params.get("raw");
  if (raw) {
    const data = await ytSearch(raw);
    return json({ topKeys: Object.keys(data), sample: (data.videos ?? data.results ?? []).slice(0, 2) });
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

  const days = Number(params.get("days") ?? "14");
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: items } = await supabase
    .from("news_items")
    .select("model_name, headline, url, taken_at, news_sources(company)")
    .eq("is_news", true)
    .not("model_name", "is", null)
    .gte("taken_at", since)
    .order("taken_at", { ascending: false })
    .limit(60);

  // Distinct models, newest first. "A, B" lists → first entry.
  const seen = new Set<string>();
  const models: { model: string; company: string; headline: string | null; news_url: string | null }[] = [];
  for (const it of items ?? []) {
    const model = String(it.model_name).split(",")[0].trim();
    const key = model.toLowerCase();
    if (!model || seen.has(key)) continue;
    seen.add(key);
    models.push({
      model,
      // deno-lint-ignore no-explicit-any
      company: (it.news_sources as any)?.company ?? "",
      headline: it.headline,
      news_url: it.url,
    });
    if (models.length >= MAX_MODELS) break;
  }

  const errors: string[] = [];
  const groups = [];
  for (const m of models) {
    try {
      const data = await ytSearch(`${m.model} tutorial`);
      // deno-lint-ignore no-explicit-any
      const vids = ((data.videos ?? data.results ?? []) as any[])
        .filter((v) => (v.type ?? "video") === "video" && (v.url || v.id))
        .slice(0, PER_MODEL)
        .map((v) => ({
          id: v.id ?? null,
          url: v.url ?? `https://www.youtube.com/watch?v=${v.id}`,
          title: v.title ?? "",
          thumbnail: typeof v.thumbnail === "string" ? v.thumbnail : v.thumbnail?.url ?? v.thumbnails?.at(-1)?.url ?? null,
          channel: v.channel?.title ?? v.channel?.handle ?? null,
          views: v.viewCountText ?? (v.viewCountInt ? `${v.viewCountInt} views` : null),
          published: v.publishedTimeText ?? null,
          length: v.lengthText ?? null,
        }));
      if (vids.length) groups.push({ ...m, videos: vids });
    } catch (e) {
      errors.push(`${m.model}: ${String(e)}`);
    }
  }

  const payload = { days, count: groups.length, errors, groups };
  if (groups.length) {
    await supabase.from("tt_popular_cache").upsert({
      cache_key: CACHE_KEY,
      fetched_at: new Date().toISOString(),
      data: payload,
    });
  }
  return json({ cached: false, fetched_at: new Date().toISOString(), ...payload });
});
