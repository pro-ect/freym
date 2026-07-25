// scraper-tiktok-creators: popular TikTok creators via ScrapeCreators, cached 24h per query.
// ?country=GB (default) ?sortBy=engagement|follower|avg_views ?refresh=1 forces refetch.
// Fetches all follower bands >= 10K and merges them.
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRAPER_KEY = Deno.env.get("SCRAPER_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BANDS = ["10K-100K", "100K-1M", "1M-10M", "10M+"];
const PAGES_PER_BAND = 2;
const TTL_MS = 24 * 3600_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const params = new URL(req.url).searchParams;
  const country = (params.get("country") ?? "GB").toUpperCase();
  const sortBy = params.get("sortBy") ?? "engagement";
  const refresh = params.get("refresh") === "1";
  const cacheKey = `${country}|${sortBy}`;

  if (!refresh) {
    const { data: hit } = await supabase
      .from("tt_popular_cache")
      .select("fetched_at, data")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TTL_MS) {
      return json({ cached: true, fetched_at: hit.fetched_at, ...hit.data });
    }
  }

  // deno-lint-ignore no-explicit-any
  const creators: any[] = [];
  const errors: string[] = [];
  for (const band of BANDS) {
    for (let page = 1; page <= PAGES_PER_BAND; page++) {
      try {
        const url = new URL("https://api.scrapecreators.com/v1/tiktok/creators/popular");
        url.searchParams.set("creatorCountry", country);
        url.searchParams.set("followerCount", band);
        url.searchParams.set("sortBy", sortBy);
        url.searchParams.set("page", String(page));
        const res = await fetch(url, { headers: { "x-api-key": SCRAPER_KEY } });
        if (!res.ok) throw new Error(`${band} p${page}: ${res.status} ${await res.text()}`);
        const data = await res.json();
        const list = data.creators ?? data.data?.creators ?? data.list ?? data.data ?? [];
        for (const c of Array.isArray(list) ? list : []) creators.push({ ...c, follower_band: band });
        const hasMore = data.has_more ?? data.pagination?.has_more;
        if (hasMore === false) break;
      } catch (e) {
        errors.push(String(e));
        break; // don't burn credits on a failing band
      }
    }
  }

  // Dedupe by user_id (a creator can't really appear in two bands, but pages can overlap).
  const seen = new Set<string>();
  const merged = creators.filter((c) => {
    const id = String(c.user_id ?? c.tcm_id ?? c.nick_name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const payload = { country, sortBy, count: merged.length, errors, creators: merged };
  if (merged.length) {
    await supabase.from("tt_popular_cache").upsert({
      cache_key: cacheKey,
      fetched_at: new Date().toISOString(),
      data: payload,
    });
  }
  return json({ cached: false, fetched_at: new Date().toISOString(), ...payload });
});
