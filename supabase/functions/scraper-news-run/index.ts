// scraper-news-run: fetch official gen-AI company accounts on X via ScrapeCreators,
// classify tweets as model news with Claude Haiku, store in Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRAPER_KEY = Deno.env.get("SCRAPER_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type SourceRef = { handle: string; company: string };

const DEFAULT_SOURCES: SourceRef[] = [
  { handle: "OpenAI", company: "OpenAI" },
  { handle: "sora", company: "OpenAI" },
  { handle: "xai", company: "xAI" },
  { handle: "GoogleDeepMind", company: "Google" },
  { handle: "GoogleLabs", company: "Google" },
  { handle: "AnthropicAI", company: "Anthropic" },
  { handle: "Kling_ai", company: "Kling" },
  { handle: "LTXStudio", company: "LTX" },
  { handle: "krea_ai", company: "Krea" },
  { handle: "ElevenLabs", company: "ElevenLabs" },
  { handle: "ByteDanceOSS", company: "ByteDance" },
  { handle: "Alibaba_Qwen", company: "Alibaba" },
  { handle: "Alibaba_Wan", company: "Alibaba" },
  { handle: "bria_ai_", company: "Bria AI" },
  { handle: "bfl_ai", company: "Black Forest Labs" },
  { handle: "veedstudio", company: "Veed" },
  { handle: "HeyGen", company: "HeyGen" },
  { handle: "LumaLabsAI", company: "Luma AI" },
  { handle: "ideogram_ai", company: "Ideogram" },
  { handle: "PixVerse_", company: "PixVerse" },
  { handle: "midjourney", company: "Midjourney" },
  { handle: "runwayml", company: "Runway" },
  // video models
  { handle: "pika_labs", company: "Pika" },
  { handle: "Hailuo_AI", company: "MiniMax" },
  { handle: "higgsfield_ai", company: "Higgsfield" },
  { handle: "moonvalley", company: "Moonvalley" },
  { handle: "ViduAI", company: "Vidu" },
  { handle: "TencentHunyuan", company: "Tencent" },
  { handle: "genmoai", company: "Genmo" },
  // image models
  { handle: "StabilityAI", company: "Stability AI" },
  { handle: "recraftai", company: "Recraft" },
  { handle: "LeonardoAi", company: "Leonardo" },
  { handle: "Magnific_AI", company: "Magnific" },
  { handle: "freepik", company: "Freepik" },
  { handle: "playground_ai", company: "Playground" },
  // avatars / video editing
  { handle: "synthesiaIO", company: "Synthesia" },
  { handle: "getcaptionsapp", company: "Captions" },
  { handle: "tavus", company: "Tavus" },
  { handle: "Hedra_labs", company: "Hedra" },
];

const SC_BASE = "https://api.scrapecreators.com/v1";

async function scGet(path: string, params: Record<string, string>) {
  const url = new URL(`${SC_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": SCRAPER_KEY } });
  if (!res.ok) throw new Error(`ScrapeCreators ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

type Classification = {
  is_news: boolean;
  headline: string | null;
  summary: string | null;
  model_name: string | null;
  category: "model-release" | "model-update" | "feature" | "research" | "availability" | "other";
  confidence: "high" | "medium" | "low";
};

async function classify(company: string, text: string): Promise<Classification | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system:
        "You classify tweets from official accounts of AI companies for a 'gen-AI model news' feed aimed at creators. " +
        "is_news=true ONLY when the tweet announces or substantively describes news about an AI MODEL or a generation capability: " +
        "a model release/version/preview (image, video, audio, music, voice, 3D, world, or LLM foundation models), " +
        "an update to a model's quality or capabilities, a new generation feature or creative tool powered by the company's models, " +
        "model API/pricing/availability/open-weights changes, or model research results (papers, benchmarks, techniques).\n" +
        "is_news=false for everything else, including: enterprise/business platform products with no model component, " +
        "partnership or integration announcements that don't ship a new model capability, grants/philanthropy/funding/" +
        "acquisitions/company milestones, policy/safety/legal news, hiring, event/webinar promo without model news, " +
        "community showcases and user-made content reposts, memes, generic marketing, tips/tutorials for existing features, and holiday posts.\n" +
        "headline: a plain-language headline (max ~80 chars) written like a news item, e.g. 'Kling 2.5 adds native audio generation'. " +
        "summary: 1-2 sentences with the substance. Both null when is_news=false.\n" +
        "model_name: the specific model/product name with version when stated (e.g. 'Seedream 4.0', 'GPT-5.3', 'Kling 2.5 Turbo'), else null.\n" +
        "category: model-release (brand-new model or major version), model-update (improvements to existing model), " +
        "feature (product/app/tool feature), research (paper, benchmark, technique), availability (API, pricing, regions, platforms), other.",
      messages: [{ role: "user", content: `Company: ${company}\n\nTweet:\n${text}` }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              is_news: { type: "boolean" },
              headline: { type: ["string", "null"] },
              summary: { type: ["string", "null"] },
              model_name: { type: ["string", "null"] },
              category: {
                type: "string",
                enum: ["model-release", "model-update", "feature", "research", "availability", "other"],
              },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["is_news", "headline", "summary", "model_name", "category", "confidence"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!res.ok) {
    console.error("anthropic error", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text2 = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text2) return null;
  try {
    return JSON.parse(text2) as Classification;
  } catch {
    return null;
  }
}

async function scrapeSource(ref: SourceRef, sinceMs: number): Promise<{ fetched: number; kept: number }> {
  const prof = await scGet("/twitter/profile", { handle: ref.handle });
  // deno-lint-ignore no-explicit-any
  const u: any = prof.legacy ?? prof.data?.user?.result?.legacy ?? prof;
  if (!u?.name && !u?.screen_name) throw new Error("profile not found / renamed");
  const avatar = (u.profile_image_url_https ?? "").replace("_normal", "_400x400") || null;

  const { data: source, error: sErr } = await supabase
    .from("news_sources")
    .upsert(
      {
        handle: ref.handle,
        company: ref.company,
        name: u.name ?? null,
        bio: u.description ?? null,
        profile_pic_url: avatar,
        follower_count: u.followers_count ?? null,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "handle" },
    )
    .select()
    .single();
  if (sErr) throw sErr;

  const tw = await scGet("/twitter/user-tweets", { handle: ref.handle });
  const fetched = (tw.tweets ?? []).length;
  let inserted = 0;
  for (const t of tw.tweets ?? []) {
    // deno-lint-ignore no-explicit-any
    const leg: any = t.legacy ?? t;
    const text: string = leg?.full_text ?? "";
    if (!text || leg?.retweeted_status_result || /^RT @/.test(text)) continue; // skip retweets
    const takenAt = leg.created_at ? new Date(leg.created_at) : null;
    if (takenAt && takenAt.getTime() < sinceMs) continue;
    const id = String(t.rest_id ?? leg.id_str);
    // First media thumbnail — media_url_https is the poster frame for videos too.
    // deno-lint-ignore no-explicit-any
    const media = (leg?.extended_entities?.media ?? leg?.entities?.media ?? []) as any[];
    const imageUrl = media.find((m) => m.media_url_https)?.media_url_https ?? null;
    const { error } = await supabase.from("news_items").upsert(
      {
        source_id: source.id,
        platform_post_id: id,
        url: `https://x.com/${ref.handle}/status/${id}`,
        text: text.trim(),
        taken_at: takenAt ? takenAt.toISOString() : null,
        like_count: leg.favorite_count ?? null,
        reply_count: leg.reply_count ?? null,
        retweet_count: leg.retweet_count ?? null,
        view_count: Number(t.views?.count ?? leg.view_count ?? null) || null,
        image_url: imageUrl,
        raw: t,
      },
      { onConflict: "platform_post_id", ignoreDuplicates: false },
    );
    if (error) console.error("item upsert", id, error.message);
    else inserted++;
  }
  return { fetched, kept: inserted };
}

function parseSourcesParam(raw: string | null): SourceRef[] {
  if (raw === null) return DEFAULT_SOURCES;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((handle) => DEFAULT_SOURCES.find((d) => d.handle.toLowerCase() === handle.toLowerCase()) ?? { handle, company: handle });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ?debug=<handle> — return trimmed raw tweets to diagnose response-shape issues.
  const debugHandle = url.searchParams.get("debug");
  if (debugHandle) {
    const param = /^\d+$/.test(debugHandle) ? { user_id: debugHandle } : { handle: debugHandle };
    const tw = await scGet("/twitter/user-tweets", param);
    // deno-lint-ignore no-explicit-any
    const sample = (tw.tweets ?? []).slice(0, 6).map((t: any) => {
      const leg = t.legacy ?? t;
      return {
        keys: Object.keys(t),
        rest_id: t.rest_id ?? leg?.id_str ?? null,
        created_at: leg?.created_at ?? null,
        is_rt: Boolean(leg?.retweeted_status_result) || /^RT @/.test(leg?.full_text ?? ""),
        text: (leg?.full_text ?? "").slice(0, 120),
      };
    });
    return new Response(JSON.stringify({ topKeys: Object.keys(tw), count: (tw.tweets ?? []).length, sample }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  const sources = parseSourcesParam(url.searchParams.get("handles"));
  const days = Number(url.searchParams.get("days") ?? "14");
  const sinceMs = Date.now() - days * 86400_000;

  const summary: Record<string, unknown>[] = [];
  for (const ref of sources) {
    try {
      const r = await scrapeSource(ref, sinceMs);
      summary.push({ handle: ref.handle, ...r });
    } catch (e) {
      summary.push({ handle: ref.handle, error: String(e) });
    }
  }

  // Classify unprocessed items.
  const classifyLimit = Number(url.searchParams.get("classify_limit") ?? "120");
  const { data: pending } = await supabase
    .from("news_items")
    .select("id, text, news_sources(company)")
    .is("classified_at", null)
    .limit(classifyLimit);

  let classified = 0;
  const batchSize = 5;
  for (let i = 0; i < (pending?.length ?? 0); i += batchSize) {
    await Promise.all(
      pending!.slice(i, i + batchSize).map(async (item) => {
        // deno-lint-ignore no-explicit-any
        const company = (item.news_sources as any)?.company ?? "";
        const c = await classify(company, item.text);
        if (!c) return;
        const { error } = await supabase
          .from("news_items")
          .update({
            is_news: c.is_news,
            headline: c.headline,
            summary: c.summary,
            model_name: c.model_name,
            category: c.category,
            confidence: c.confidence,
            classified_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (!error) classified++;
      }),
    );
  }

  // Mirror media + avatars into Storage — X CDN blocks hotlinking / URLs rot.
  const mirrorOne = async (srcUrl: string, pathBase: string): Promise<string | null> => {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const path = `${pathBase}.${ext}`;
    const buf = await r.arrayBuffer();
    const { error } = await supabase.storage
      .from("scraper-images")
      .upload(path, buf, { contentType: ct, upsert: true });
    return error ? null : path;
  };

  let mirrored = 0;
  const { data: toMirror } = await supabase
    .from("news_items")
    .select("id, image_url")
    .is("stored_image_path", null)
    .not("image_url", "is", null)
    .eq("is_news", true)
    .limit(Number(url.searchParams.get("mirror_limit") ?? "120"));
  const mBatch = 8;
  for (let i = 0; i < (toMirror?.length ?? 0); i += mBatch) {
    await Promise.all(
      toMirror!.slice(i, i + mBatch).map(async (im) => {
        try {
          const path = await mirrorOne(im.image_url, `news/${im.id}`);
          if (path) {
            await supabase.from("news_items").update({ stored_image_path: path }).eq("id", im.id);
            mirrored++;
          }
        } catch (e) {
          console.error("mirror image", im.id, String(e));
        }
      }),
    );
  }

  const { data: avs } = await supabase
    .from("news_sources")
    .select("id, profile_pic_url")
    .is("stored_avatar_path", null)
    .not("profile_pic_url", "is", null);
  for (const a of avs ?? []) {
    try {
      const path = await mirrorOne(a.profile_pic_url, `news-avatars/${a.id}`);
      if (path) await supabase.from("news_sources").update({ stored_avatar_path: path }).eq("id", a.id);
    } catch (e) {
      console.error("mirror avatar", a.id, String(e));
    }
  }

  return new Response(JSON.stringify({ summary, classified, mirrored }, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
