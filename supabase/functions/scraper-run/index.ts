// scraper-run: fetch creators (Threads, X) via ScrapeCreators, extract prompts with Claude Haiku, store in Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const SCRAPER_KEY = Deno.env.get("SCRAPER_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type CreatorRef = { platform: "threads" | "x"; handle: string };

const DEFAULT_CREATORS: CreatorRef[] = [
  { platform: "threads", handle: "zeifert.style" },
  { platform: "threads", handle: "aleksaa.aich" },
  { platform: "threads", handle: "frameformula" },
  { platform: "threads", handle: "limatraaa" },
  { platform: "x", handle: "0xInk_" },
  { platform: "x", handle: "Dari_Designs" },
  { platform: "x", handle: "madpencil_" },
];

const SC_BASE = "https://api.scrapecreators.com/v1";

async function scGet(path: string, params: Record<string, string>) {
  const url = new URL(`${SC_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": SCRAPER_KEY } });
  if (!res.ok) throw new Error(`ScrapeCreators ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

type Extraction = {
  contains_prompt: boolean;
  prompt_text: string | null;
  model_mentioned: string | null;
  style_tags: string[];
  confidence: "high" | "medium" | "low";
};

async function extractPrompt(caption: string): Promise<Extraction | null> {
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
        "You analyze social media posts from AI image creators. Extract any image-generation prompt the creator shared. " +
        "Prompts may be quoted, in the caption body, in the creator's replies, or split across lines. Set contains_prompt to true only if actual " +
        "prompt text is present, not merely mentioned. prompt_text must be the verbatim prompt (cleaned of surrounding " +
        "commentary, hashtags, and emoji that are not part of the prompt).\n" +
        "model_mentioned: normalize to a canonical name when the post names the generation tool, including via aliases:\n" +
        "- 'GPT Image' (aliases: ChatGPT, Chatgpt Image, DALL-E, gpt-image-1, gpt-image-2, 4o image)\n" +
        "- 'Midjourney' (append the version when given, e.g. 'Midjourney v7')\n" +
        "- 'Nano Banana' / 'Nano Banana Pro' (aliases: Gemini image, Imagen)\n" +
        "- 'Seedream', 'Krea', 'Recraft', 'Flux', 'Sora', 'Ideogram', 'Stable Diffusion'\n" +
        "If a model outside this list is named, return its name verbatim. If no tool is named but the prompt contains " +
        "Midjourney parameter syntax (--ar, --stylize, --chaos, --weird, --sref, --profile, --raw, --v), return 'Midjourney'. " +
        "Otherwise null.\n" +
        "style_tags: 2-5 short lowercase tags describing the visual style.",
      messages: [{ role: "user", content: caption }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              contains_prompt: { type: "boolean" },
              prompt_text: { type: ["string", "null"] },
              model_mentioned: { type: ["string", "null"] },
              style_tags: { type: "array", items: { type: "string" } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["contains_prompt", "prompt_text", "model_mentioned", "style_tags", "confidence"],
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
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Extraction;
  } catch {
    return null;
  }
}

// --- Threads helpers ---

// Threads items carry text in up to three places: caption, text fragments, and
// "snippet attachments" (long-text attachments — where creators usually put prompts).
// deno-lint-ignore no-explicit-any
function textOfItem(item: any): string {
  const parts: string[] = [];
  if (item?.caption?.text) parts.push(item.caption.text);
  // deno-lint-ignore no-explicit-any
  const frags = (f: any) => (f?.fragments ?? []).map((x: any) => x?.plaintext ?? "").join("");
  const tpi = item?.text_post_app_info;
  const main = frags(tpi?.text_fragments);
  if (main && !parts.includes(main)) parts.push(main);
  const snippet = frags(tpi?.snippet_attachment_info?.text_fragments);
  if (snippet) parts.push(snippet);
  return parts.join("\n").trim();
}

// deno-lint-ignore no-explicit-any
function imagesFromThreadsPost(post: any): { url: string; width: number | null; height: number | null }[] {
  const out: { url: string; width: number | null; height: number | null }[] = [];
  // deno-lint-ignore no-explicit-any
  const pick = (iv: any) => {
    const c = iv?.candidates?.[0];
    if (c?.url) out.push({ url: c.url, width: c.width ?? null, height: c.height ?? null });
  };
  if (Array.isArray(post.carousel_media) && post.carousel_media.length) {
    for (const m of post.carousel_media) pick(m.image_versions2);
  } else {
    pick(post.image_versions2);
  }
  return out;
}

type PostRow = {
  platform_post_id: string;
  code: string | null;
  url: string | null;
  caption: string | null;
  taken_at: string | null;
  like_count: number | null;
  reply_count: number | null;
  // deno-lint-ignore no-explicit-any
  raw: any;
  replies_checked?: boolean;
  images: { url: string; width: number | null; height: number | null }[];
};

// deno-lint-ignore no-explicit-any
async function upsertCreator(ref: CreatorRef, fields: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase
    .from("sc_creators")
    .upsert(
      { platform: ref.platform, handle: ref.handle, scraped_at: new Date().toISOString(), ...fields },
      { onConflict: "platform,handle" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertPosts(creatorId: string, rows: PostRow[]): Promise<number> {
  let inserted = 0;
  for (const r of rows) {
    const { images, ...postFields } = r;
    const { data: row, error } = await supabase
      .from("sc_posts")
      .upsert({ creator_id: creatorId, ...postFields }, { onConflict: "platform_post_id" })
      .select("id")
      .single();
    if (error) {
      console.error("post upsert", r.platform_post_id, error.message);
      continue;
    }
    inserted++;
    const { count } = await supabase
      .from("sc_images")
      .select("id", { count: "exact", head: true })
      .eq("post_id", row.id);
    if (!count) {
      await supabase.from("sc_images").insert(
        images.map((im, i) => ({ post_id: row.id, url: im.url, width: im.width, height: im.height, position: i })),
      );
    }
  }
  return inserted;
}

async function scrapeThreads(ref: CreatorRef): Promise<number> {
  const profile = await scGet("/threads/profile", { handle: ref.handle });
  const creator = await upsertCreator(ref, {
    full_name: profile.full_name ?? null,
    bio: profile.biography ?? profile.text_app_biography ?? null,
    profile_pic_url: profile.hd_profile_pic_versions?.at(-1)?.url ?? profile.profile_pic_url ?? null,
    follower_count: profile.follower_count ?? null,
  });

  const postsRes = await scGet("/threads/user/posts", { handle: ref.handle });
  const rows: PostRow[] = [];
  for (const p of postsRes.posts ?? []) {
    const imgs = imagesFromThreadsPost(p);
    if (!imgs.length) continue; // images-only MVP
    rows.push({
      platform_post_id: String(p.pk ?? p.id),
      code: p.code ?? null,
      url: p.url ?? (p.code ? `https://www.threads.com/@${ref.handle}/post/${p.code}` : null),
      caption: textOfItem(p) || null,
      taken_at: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : null,
      like_count: p.like_count ?? null,
      reply_count: p.text_post_app_info?.direct_reply_count ?? null,
      raw: p,
      images: imgs,
    });
  }
  return upsertPosts(creator.id, rows);
}

async function scrapeX(ref: CreatorRef): Promise<number> {
  const prof = await scGet("/twitter/profile", { handle: ref.handle });
  // deno-lint-ignore no-explicit-any
  const u: any = prof.legacy ?? prof.data?.user?.result?.legacy ?? prof;
  const avatar = (u.profile_image_url_https ?? "").replace("_normal", "_400x400") || null;
  const creator = await upsertCreator(ref, {
    full_name: u.name ?? null,
    bio: u.description ?? null,
    profile_pic_url: avatar,
    follower_count: u.followers_count ?? null,
  });

  const tw = await scGet("/twitter/user-tweets", { handle: ref.handle });
  const rows: PostRow[] = [];
  for (const t of tw.tweets ?? []) {
    // deno-lint-ignore no-explicit-any
    const leg: any = t.legacy ?? t;
    const text: string = leg?.full_text ?? "";
    if (!text || leg?.retweeted_status_result || /^RT @/.test(text)) continue; // skip retweets
    // deno-lint-ignore no-explicit-any
    const media = (leg?.extended_entities?.media ?? leg?.entities?.media ?? []).filter(
      (m: any) => m.type === "photo" && m.media_url_https,
    );
    if (!media.length) continue;
    const id = String(t.rest_id ?? leg.id_str);
    rows.push({
      platform_post_id: id,
      code: null,
      url: `https://x.com/${ref.handle}/status/${id}`,
      caption: text.trim() || null,
      taken_at: leg.created_at ? new Date(leg.created_at).toISOString() : null,
      like_count: leg.favorite_count ?? null,
      reply_count: leg.reply_count ?? null,
      raw: t,
      replies_checked: true, // no reply API for X — extract from tweet text only
      // deno-lint-ignore no-explicit-any
      images: media.map((m: any) => ({
        url: m.media_url_https,
        width: m.original_info?.width ?? m.sizes?.large?.w ?? null,
        height: m.original_info?.height ?? m.sizes?.large?.h ?? null,
      })),
    });
  }
  return upsertPosts(creator.id, rows);
}

function parseCreatorsParam(raw: string | null): CreatorRef[] {
  if (raw === null) return DEFAULT_CREATORS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [a, b] = s.includes(":") ? s.split(":", 2) : ["threads", s];
      return { platform: a === "x" ? "x" : "threads", handle: b } as CreatorRef;
    });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const creators = parseCreatorsParam(url.searchParams.get("handles"));
  const extractLimit = Number(url.searchParams.get("extract_limit") ?? "60");

  const summary: Record<string, unknown>[] = [];

  for (const ref of creators) {
    try {
      const posts = ref.platform === "x" ? await scrapeX(ref) : await scrapeThreads(ref);
      summary.push({ platform: ref.platform, handle: ref.handle, posts });
    } catch (e) {
      summary.push({ platform: ref.platform, handle: ref.handle, error: String(e) });
    }
  }

  // Phase 2: for prompt-less Threads posts, fetch the reply thread — creators often post the prompt as a reply.
  // (X posts are inserted with replies_checked=true, so they never enter this phase.)
  const replyLimit = Number(url.searchParams.get("reply_limit") ?? "60");
  const { data: noPrompt } = await supabase
    .from("sc_posts")
    .select("id, url, caption, sc_creators(handle)")
    .eq("has_prompt", false)
    .eq("replies_checked", false)
    .not("url", "is", null)
    .limit(replyLimit);

  let repliesChecked = 0;
  let promptsFromReplies = 0;
  const replyBatch = 4;
  for (let i = 0; i < (noPrompt?.length ?? 0); i += replyBatch) {
    const batch = noPrompt!.slice(i, i + replyBatch);
    await Promise.all(
      batch.map(async (post) => {
        try {
          // deno-lint-ignore no-explicit-any
          const detail: any = await scGet("/threads/post", { url: post.url });
          // deno-lint-ignore no-explicit-any
          const handle = (post.sc_creators as any)?.handle;
          // deno-lint-ignore no-explicit-any
          const ownReplies = (detail.comments ?? [])
            .filter((c: any) => c.user?.username === handle)
            .map((c: any) => textOfItem(c))
            .filter((t: string) => t.length > 0);

          if (!ownReplies.length) {
            await supabase.from("sc_posts").update({ replies_checked: true }).eq("id", post.id);
            repliesChecked++;
            return;
          }

          const replyText = ownReplies.join("\n---\n");
          const combined = `${post.caption ?? ""}\n\n[Creator's own replies to this post]\n${replyText}`;
          const ex = await extractPrompt(combined);
          await supabase
            .from("sc_posts")
            .update({
              replies_checked: true,
              reply_text: replyText,
              ...(ex
                ? {
                    has_prompt: ex.contains_prompt,
                    prompt_text: ex.prompt_text,
                    model_name: ex.model_mentioned,
                    style_tags: ex.style_tags ?? [],
                    confidence: ex.confidence,
                    extracted_at: new Date().toISOString(),
                  }
                : {}),
            })
            .eq("id", post.id);
          repliesChecked++;
          if (ex?.contains_prompt) promptsFromReplies++;
        } catch (e) {
          console.error("reply check failed", post.id, String(e));
        }
      }),
    );
  }

  // Extract prompts for posts that haven't been processed yet (or were reset for re-extraction).
  const { data: pending } = await supabase
    .from("sc_posts")
    .select("id, caption, reply_text")
    .is("extracted_at", null)
    .not("caption", "is", null)
    .limit(extractLimit);

  let extracted = 0;
  const batchSize = 5;
  for (let i = 0; i < (pending?.length ?? 0); i += batchSize) {
    const batch = pending!.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (post) => {
        const source = post.reply_text
          ? `${post.caption}\n\n[Creator's own replies to this post]\n${post.reply_text}`
          : post.caption;
        const ex = await extractPrompt(source);
        if (!ex) return;
        const { error } = await supabase
          .from("sc_posts")
          .update({
            has_prompt: ex.contains_prompt,
            prompt_text: ex.prompt_text,
            model_name: ex.model_mentioned,
            style_tags: ex.style_tags ?? [],
            confidence: ex.confidence,
            extracted_at: new Date().toISOString(),
          })
          .eq("id", post.id);
        if (!error) extracted++;
      }),
    );
  }

  // Phase 4: mirror images into Supabase Storage — the source CDNs block cross-origin
  // rendering and/or expire their URLs.
  const mirrorLimit = Number(url.searchParams.get("mirror_limit") ?? "120");
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
    .from("sc_images")
    .select("id, url")
    .is("stored_path", null)
    .limit(mirrorLimit);
  const mBatch = 8;
  for (let i = 0; i < (toMirror?.length ?? 0); i += mBatch) {
    await Promise.all(
      toMirror!.slice(i, i + mBatch).map(async (im) => {
        try {
          const path = await mirrorOne(im.url, `posts/${im.id}`);
          if (path) {
            await supabase.from("sc_images").update({ stored_path: path }).eq("id", im.id);
            mirrored++;
          }
        } catch (e) {
          console.error("mirror image", im.id, String(e));
        }
      }),
    );
  }

  const { data: avs } = await supabase
    .from("sc_creators")
    .select("id, profile_pic_url")
    .is("stored_avatar_path", null)
    .not("profile_pic_url", "is", null);
  for (const a of avs ?? []) {
    try {
      const path = await mirrorOne(a.profile_pic_url, `avatars/${a.id}`);
      if (path) await supabase.from("sc_creators").update({ stored_avatar_path: path }).eq("id", a.id);
    } catch (e) {
      console.error("mirror avatar", a.id, String(e));
    }
  }

  return new Response(JSON.stringify({ summary, extracted, repliesChecked, promptsFromReplies, mirrored }, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
