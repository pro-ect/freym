// canvas-prompt-gen: turn a one-line brief into N ready-to-run image prompts
// for the freym canvas "Prompt generator" node. Requires a signed-in user.
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

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
  "Every prompt must still satisfy the brief on its own.";

const SCHEMA = {
  type: "object",
  properties: {
    prompts: { type: "array", items: { type: "string" } },
  },
  required: ["prompts"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: { brief?: string; count?: number; context?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }

  const brief = (body.brief ?? "").trim();
  if (!brief) return json({ error: "brief is required" }, 400);

  const count = Math.min(10, Math.max(1, Math.round(Number(body.count) || 4)));
  const context = (body.context ?? [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .slice(0, 8);

  const userText =
    `Brief: ${brief}\n\nWrite exactly ${count} prompt${count === 1 ? "" : "s"}.` +
    (context.length
      ? `\n\nExisting prompts wired into this generator — treat them as style reference, ` +
        `stay in their register, and do not repeat them verbatim:\n` +
        context.map((c) => `- ${c}`).join("\n")
      : "");

  try {
    // deno-lint-ignore no-explicit-any
    const msg: any = await (anthropic as any).beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content: userText }],
    });

    if (msg.stop_reason === "refusal") {
      return json({ error: "the model declined this brief — try rewording it" }, 422);
    }

    // deno-lint-ignore no-explicit-any
    const text = msg.content?.find((b: any) => b.type === "text")?.text;
    if (!text) return json({ error: "empty response from the model" }, 502);

    const parsed = JSON.parse(text) as { prompts?: unknown };
    const prompts = (Array.isArray(parsed.prompts) ? parsed.prompts : [])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, count);

    if (!prompts.length) return json({ error: "no prompts returned" }, 502);
    return json({ prompts });
  } catch (e) {
    console.error("prompt-gen", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
