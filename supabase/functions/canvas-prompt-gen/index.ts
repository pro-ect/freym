// canvas-prompt-gen: turn a one-line brief into N ready-to-run image prompts
// for the freym canvas "Prompt writer" node. Requires a signed-in user.
//
// The LLM is a `text`-category row in the shared models table (canvas_models
// view), served through Pika's OpenAI-compatible chat surface — one API key
// for text, image and video. `model_configs.replicate_version` holds the Pika
// model id ("anthropic/claude-opus-5", "openai/gpt-5.5", …). Each run costs a
// flat `model_pricing.coin_cost`: reserved before the call, deducted on
// success, released on any failure. No generation_queue row — the call is
// synchronous and returns text, not media.
import { createClient } from "jsr:@supabase/supabase-js@2";

const PIKA_API_BASE = "https://api.dev.pika.art";
const DEFAULT_MODEL = "claude-opus-5-pika";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const SYSTEM =
  "You write prompts for text-to-image models. Given a brief, return that many distinct, " +
  "ready-to-run prompts.\n" +
  "Each prompt is one self-contained paragraph of 35-70 words in plain prose — no numbering, " +
  "no titles, no commentary, no markdown. Name the subject, the composition and framing, the " +
  "lighting, the lens or camera treatment, the colour palette, and the mood. Prefer concrete " +
  "visual nouns over adjectives like 'beautiful' or 'stunning', and never mention prompt " +
  "engineering, aspect ratios, or model names.\n" +
  "The set must be genuinely varied: change the angle, the palette, the time of day, the scale " +
  "of the subject, or the material treatment between prompts rather than rewording one idea. " +
  "Every prompt must still satisfy the brief on its own.\n" +
  'Respond with ONLY a JSON object of the shape {"prompts": ["...", "..."]} — no prose before ' +
  "or after it, no code fences.";

/** Pull {"prompts":[...]} out of a model reply, tolerating fences and chatter. */
function parsePrompts(text: string, count: number): string[] {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as { prompts?: unknown };
      const list = Array.isArray(parsed.prompts) ? parsed.prompts : [];
      const prompts = list.map((p) => String(p).trim()).filter(Boolean).slice(0, count);
      if (prompts.length) return prompts;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: { brief?: string; count?: number; context?: string[]; model?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }

  const brief = (body.brief ?? "").trim();
  if (!brief) return json({ error: "brief is required" }, 400);

  const count = Math.min(10, Math.max(1, Math.round(Number(body.count) || 1)));
  const context = (body.context ?? [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .slice(0, 8);
  const slug = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "not signed in" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "not signed in" }, 401);

  const pikaKey = Deno.env.get("PIKA_API_KEY");
  if (!pikaKey) return json({ error: "PIKA_API_KEY is not configured" }, 500);

  // The text model row: Pika model id + flat coin price.
  const [{ data: config }, { data: pricing }] = await Promise.all([
    admin.from("model_configs").select("replicate_version, provider, is_active").eq("model_id", slug).maybeSingle(),
    admin.from("model_pricing").select("coin_cost, is_active").eq("model_id", slug).maybeSingle(),
  ]);
  if (!config?.is_active || config.provider !== "pika" || !config.replicate_version || !pricing?.is_active) {
    return json({ error: `unknown text model: ${slug}` }, 404);
  }
  const pikaModel = config.replicate_version as string;
  const coins = Math.max(0, Number(pricing.coin_cost ?? 0));

  // Reserve first — the same ledger the image/video runs use.
  let reserveId: string | null = null;
  if (coins > 0) {
    const { data: reserved, error: reserveError } = await userClient.rpc("reserve_coins", {
      p_user_id: user.id,
      p_amount: coins,
      p_description: `Reserve for ${slug} prompt writing`,
    });
    if (reserveError) {
      if (reserveError.message?.includes("Insufficient coins")) {
        return json({ error: "Insufficient coin balance", code: "COINS_INSUFFICIENT_BALANCE" }, 402);
      }
      return json({ error: reserveError.message || "could not reserve coins" }, 500);
    }
    reserveId = reserved as string;
  }
  const release = async (why: string) => {
    if (!reserveId) return;
    await admin.rpc("release_reserved_coins", {
      p_reserve_transaction_id: reserveId,
      p_description: `Release - prompt writing failed: ${why}`,
    });
  };

  const userText =
    `Brief: ${brief}\n\nWrite exactly ${count} prompt${count === 1 ? "" : "s"}.` +
    (context.length
      ? `\n\nExisting prompts wired into this generator — treat them as style reference, ` +
        `stay in their register, and do not repeat them verbatim:\n` +
        context.map((c) => `- ${c}`).join("\n")
      : "");

  try {
    const res = await fetch(`${PIKA_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": pikaKey },
      body: JSON.stringify({
        model: pikaModel,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userText },
        ],
        // No max_tokens / temperature: GPT-5.x rejects max_tokens (wants
        // max_completion_tokens) and pins temperature; the reply is small anyway.
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = payload?.message ?? payload?.error?.message ?? `Pika returned ${res.status}`;
      console.error("prompt-gen pika", res.status, msg);
      await release(msg);
      const friendly =
        res.status === 403
          ? "The writing service is temporarily unavailable. Your coins were not charged."
          : res.status === 429
            ? "The service is busy right now. Your coins were not charged — please retry."
            : `Could not write prompts (${msg}). Your coins were not charged.`;
      return json({ error: friendly }, 502);
    }

    const text: string = payload?.choices?.[0]?.message?.content ?? "";
    const prompts = parsePrompts(text, count);
    if (!prompts.length) {
      await release("no prompts in the reply");
      return json({ error: "no prompts returned — try rewording the brief" }, 502);
    }

    if (reserveId) {
      const { error: deductError } = await admin.rpc("deduct_reserved_coins", {
        p_reserve_transaction_id: reserveId,
        p_description: `Deduct for ${slug} prompt writing (${prompts.length} prompt${prompts.length === 1 ? "" : "s"})`,
      });
      if (deductError) console.error("prompt-gen deduct", deductError.message);
    }
    return json({ prompts, model: slug, coins });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error("prompt-gen", e);
    await release(msg);
    return json({ error: `Could not reach the writing service. Your coins were not charged.` }, 502);
  }
});
