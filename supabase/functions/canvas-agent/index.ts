// canvas-agent: the freym canvas chat. Turns one message (with mentioned
// nodes / models) into a PLAN of board edits — add prompt and model nodes,
// wire them, tweak settings. It never runs a model and never touches the
// board itself: the canvas checks the plan, draws it as a draft, and the user
// confirms the cost before anything generates.
//
// LLM: Claude through Pika's Anthropic Messages surface (one Pika key for
// text, image and video). The reply is forced through a single `canvas_plan`
// tool so it is always structured. Each message costs a flat AGENT_COINS:
// reserved first, deducted on success, released on any failure.
//
// LOOP mode (body.mode = "loop"): the canvas runs a goal on its own inside a
// coin budget. Each step the agent sees the goal, the references and the
// last round's RESULTS as images, judges every result (keep / reject + the
// issue), and plans the next round — or says the goal is met. The canvas
// runs the round, waits for the results and calls again. The canvas also
// enforces the budget; this function only prices its own step.
import { createClient } from "jsr:@supabase/supabase-js@2";

const PIKA_MESSAGES = "https://api.dev.pika.art/anthropic/v1/messages";
const MODEL = Deno.env.get("CANVAS_AGENT_MODEL") ?? "anthropic/claude-opus-5.5";
const AGENT_COINS = 30; // ≈ $0.06 per message (500 coins = $1)
const MAX_IMAGES = 6;
// Loop steps look at more images (references + a round of results).
const LOOP_MAX_IMAGES = 16;
const LOOP_BASE_COINS = 30;
const LOOP_COINS_PER_IMAGE = 4;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const SYSTEM = `You are the planning assistant inside freym, a node canvas for AI image and video generation.
The user describes a test or a pipeline; you answer with a PLAN of board edits through the canvas_plan tool.
You never run models and never mention running them yourself — the user reviews your draft and presses Run.

The board:
- Node types: image (an uploaded picture), prompt (text), model (an image or video model), video, audio.
- Existing nodes are addressed by handle (n1, n2…). New nodes get a short key you invent (p1, m1, …).
- A wire goes from a source (image, prompt, video, audio or model) INTO a model. A model's result can feed another model.
- An image wired into an IMAGE model is an edit reference (image 1, image 2… in connection order).
  An image wired into a VIDEO model is the start frame; a second image is the end frame (only when "frames" is true).
- Respect "max_images": never wire more images into a model than it takes. 0 means text only — then do not wire images.

Models:
- Use ONLY slugs from the catalog. Map names loosely: "Nano Banana" → the newest Nano Banana (2.1), "Flux" → the newest FLUX,
  "Seedream" → the newest Seedream, "Krea" → Krea 3, "Kling" → the newest Kling, "GPT Image" → the newest GPT Image.
- "my favorite models" / @favorites = catalog entries with favorite: true. "the main / best image models" = 3–5 strong,
  different families (prefer new and favorite ones).
- If a name could mean clearly different models, or none fits, ask in "questions" and leave ops empty.
- Set params only when the user asks or when the task needs it (e.g. a 9:16 request → that model's aspect option).
  Use only the option values listed for that model. Otherwise leave defaults.

Prompts:
- A model comparison uses ONE shared prompt wired into every model, so the test is fair — unless the user asks for variations,
  then write distinct prompts.
- Each prompt is one self-contained paragraph of 35–80 words in plain prose: subject, composition and framing, lighting,
  lens or camera treatment, palette, mood. Concrete visual nouns; no markdown, no model names, no aspect ratios in the text.
- When reference images are wired, say how to use them ("the character from the reference image", "keep the face and
  outfit from image 1") — follow the user's intent: variations, new poses, restyle, turnaround sheet, etc.
- Video prompts describe motion and camera movement over time.

Op shapes (use exactly these op names):
  {"op":"add_prompt","key":"p1","text":"..."}
  {"op":"add_model","key":"m1","slug":"<catalog slug>","params":{...optional}}
  {"op":"connect","from":"n5","to":"m1"}            (from/to: an existing handle or a new key)
  {"op":"set_prompt","id":"p1","text":"..."}
  {"op":"set_params","id":"m1","params":{...}}
  {"op":"remove","id":"m2"}

Layout is automatic — never think about positions.
For follow-ups ("swap X for Y", "add 2 more", "make it 9:16"), edit the draft: remove (only draft nodes), add, set_params,
set_prompt. Keep what the user did not ask to change.
"reply": 1–3 short plain sentences saying what you set up (or what you need to know). Do not quote prices — the canvas shows them.`;

const LOOP_SYSTEM = `

LOOP MODE — you work on a goal by yourself, round by round, inside a coin budget.
Each step you get the GOAL, the reference images, the BUDGET left, and the RESULTS of the last round as images (with handles).
1. Judge every new result with your own eyes against the goal and the references: likeness to the reference (face, hair,
   outfit, proportions), what the goal asks for (count, variety, pose, style), anatomy (hands, eyes, faces), legible text,
   artifacts, crops. keep=true only for a result you would hand to the client. score 1-10. issue: the main problem in a few words
   (empty when kept). Two kept results must not be near-duplicates — keep the better one.
2. "target": the number of finished results the goal asks for (e.g. "10 character options" → 10; default 4).
   Kept results from earlier rounds still count.
3. If enough results are kept, or the goal is met, set done=true and leave ops empty.
4. Otherwise plan the NEXT round with ops: only what is missing, and fixes for what failed.
   - A near-miss (good overall, one local flaw) → wire that result into an image EDIT model (max_images ≥ 1) with a short,
     targeted fix prompt ("keep everything, fix the left hand to five fingers").
   - A miss → a new run with a better prompt that removes the cause; never repeat a prompt that failed.
   - If one model fails the same way twice, switch to another strong model.
   - Wire the reference images into every model that should keep the character/product (respect max_images).
5. Each model node makes ONE image. For N new results add N model nodes (one prompt each, or one prompt per variation).
6. Budget: the round's cost is the sum of "coins" of the models you add. Keep it within the budget left minus 80 coins
   (the next review). If no useful round fits, set done=true and say so. Prefer cheaper strong models when the budget is tight.
7. "reply": one or two short sentences — what passed, what failed and what this round tries. No prices.
Loop ops may only ADD prompts/models and wires (no remove / set_* of existing nodes).
When ROUND is beyond the max rounds, this is the final review: only judge, set done=true, ops empty.`;

const LOOP_TOOL = {
  name: "loop_step",
  description: "Verdicts on the last round, whether the goal is met, and the next round's board edits.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      target: { type: "integer", description: "How many finished results the goal asks for" },
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            handle: { type: "string" },
            keep: { type: "boolean" },
            score: { type: "integer" },
            issue: { type: "string" },
          },
          required: ["handle", "keep"],
        },
      },
      done: { type: "boolean" },
      ops: { type: "array", items: { type: "object" } },
    },
    required: ["reply", "verdicts", "done", "ops"],
  },
};

const PLAN_TOOL = {
  name: "canvas_plan",
  description: "The board edits to draft, plus a short reply to the user.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      questions: { type: "array", items: { type: "string" } },
      ops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add_prompt", "add_model", "connect", "set_prompt", "set_params", "remove"] },
            key: { type: "string", description: "add_prompt / add_model: new node key" },
            text: { type: "string", description: "add_prompt / set_prompt" },
            slug: { type: "string", description: "add_model: catalog slug" },
            params: { type: "object", description: "add_model / set_params: param values" },
            from: { type: "string", description: "connect: source handle or key" },
            to: { type: "string", description: "connect: target model handle or key" },
            id: { type: "string", description: "set_prompt / set_params / remove: handle or key" },
          },
          required: ["op"],
        },
      },
    },
    required: ["reply", "ops"],
  },
};

// Loop rounds use the same op shapes as a plan.
(LOOP_TOOL.input_schema.properties as Record<string, unknown>).ops = PLAN_TOOL.input_schema.properties.ops;

type Body = {
  message?: string;
  mentions?: unknown[];
  images?: { handle: string; url: string }[];
  board?: unknown[];
  catalog?: unknown[];
  history?: { role: string; text: string }[];
  mode?: "plan" | "loop";
  loop?: {
    round?: number;
    max_rounds?: number;
    budget_coins?: number;
    left_coins?: number;
    kept?: { handle: string; model?: string; note?: string }[];
    results?: { handle: string; url?: string | null; model?: string; prompt?: string; status?: string; error?: string }[];
    log?: string[];
  };
};

/** Supabase storage → a 1024px rendition, so a 22 MB 4K PNG stays small. */
function smallImage(url: string): string {
  const m = url.match(/^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/object\/public\/(.+)$/);
  return m ? `${m[1]}/storage/v1/render/image/public/${m[2]}?width=1024&resize=contain&quality=75` : url;
}

type Extracted = {
  reply: string;
  questions: string[];
  ops: unknown[];
  target?: number;
  verdicts?: unknown[];
  done?: boolean;
};

function extractPlan(payload: any, toolName = "canvas_plan"): Extracted | null {
  const blocks: any[] = payload?.content ?? [];
  const tool = blocks.find((b) => b?.type === "tool_use" && b?.name === toolName);
  let raw: any = tool?.input ?? null;
  if (!raw) {
    const text = blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
    const cleaned = text.replace(/```(?:json)?/gi, "");
    const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try { raw = JSON.parse(cleaned.slice(s, e + 1)); } catch { /* not JSON */ }
    }
    if (!raw && text.trim()) raw = { reply: text.trim(), ops: [] };
  }
  if (!raw) return null;
  return {
    reply: String(raw.reply ?? ""),
    questions: Array.isArray(raw.questions) ? raw.questions.map(String) : [],
    ops: Array.isArray(raw.ops) ? raw.ops : [],
    ...(toolName === "loop_step"
      ? {
          target: Number.isFinite(Number(raw.target)) ? Number(raw.target) : undefined,
          verdicts: Array.isArray(raw.verdicts) ? raw.verdicts : [],
          done: raw.done === true || raw.done === "true",
        }
      : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "expected a JSON body" }, 400); }
  const message = String(body.message ?? "").trim();
  if (!message) return json({ error: "message is required" }, 400);

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

  const isLoop = body.mode === "loop";
  const loop = body.loop ?? {};
  const refImages = (body.images ?? []).filter((i) => i?.url).slice(0, MAX_IMAGES);
  const resultImages = isLoop
    ? (loop.results ?? []).filter((r) => r?.url).slice(0, LOOP_MAX_IMAGES - refImages.length)
    : [];
  const coins = isLoop ? LOOP_BASE_COINS + LOOP_COINS_PER_IMAGE * (refImages.length + resultImages.length) : AGENT_COINS;

  const { data: reserved, error: reserveError } = await userClient.rpc("reserve_coins", {
    p_user_id: user.id,
    p_amount: coins,
    p_description: isLoop ? "Reserve for canvas agent loop step" : "Reserve for canvas agent message",
  });
  if (reserveError) {
    if (reserveError.message?.includes("Insufficient coins")) {
      return json({ error: "Insufficient coin balance", code: "COINS_INSUFFICIENT_BALANCE" }, 402);
    }
    return json({ error: reserveError.message || "could not reserve coins" }, 500);
  }
  const reserveId = reserved as string;
  const release = (why: string) =>
    admin.rpc("release_reserved_coins", {
      p_reserve_transaction_id: reserveId,
      p_description: `Release - canvas agent failed: ${why}`.slice(0, 200),
    });

  const history = (body.history ?? []).slice(-10)
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${String(t.text).slice(0, 1500)}`)
    .join("\n");
  const context =
    `CATALOG (runnable models):\n${JSON.stringify(body.catalog ?? [])}\n\n` +
    `BOARD (existing nodes):\n${JSON.stringify(body.board ?? [])}\n\n` +
    `MENTIONS in the message (@[...] tokens):\n${JSON.stringify(body.mentions ?? [])}\n\n` +
    (history ? `EARLIER IN THIS CHAT:\n${history}\n\n` : "") +
    (isLoop
      ? `GOAL:\n${message}\n\n` +
        `ROUND: ${loop.round ?? 1} of at most ${loop.max_rounds ?? 6}\n` +
        `BUDGET: ${loop.budget_coins ?? 0} coins total, ${loop.left_coins ?? 0} coins left (500 coins = $1)\n\n` +
        `KEPT IN EARLIER ROUNDS (${(loop.kept ?? []).length}):\n${JSON.stringify(loop.kept ?? [])}\n\n` +
        `LAST ROUND RESULTS (judge each one; images follow their handles above):\n${JSON.stringify(
          (loop.results ?? []).map((r) => ({ handle: r.handle, model: r.model, prompt: r.prompt?.slice(0, 300), status: r.status, error: r.error, shown: !!r.url })),
        )}\n\n` +
        ((loop.log ?? []).length ? `LOOP LOG:\n${(loop.log ?? []).slice(-12).join("\n")}\n` : "")
      : `USER MESSAGE:\n${message}`);
  const images = refImages;

  const call = async (withImages: boolean, withTool: boolean) => {
    const content: unknown[] = [];
    if (withImages) {
      for (const img of images) {
        content.push({ type: "text", text: `${isLoop ? "Reference image" : "Image"} of node ${img.handle}:` });
        content.push({ type: "image", source: { type: "url", url: smallImage(img.url) } });
      }
      for (const r of resultImages) {
        content.push({ type: "text", text: `Result ${r.handle} (${r.model ?? "model"}):` });
        content.push({ type: "image", source: { type: "url", url: smallImage(r.url!) } });
      }
    }
    content.push({
      type: "text",
      text: context + (withImages || !images.length ? "" : "\n\n(The referenced images could not be shown to you; rely on their labels.)") +
        (withTool
          ? ""
          : isLoop
            ? '\n\nRespond with ONLY a JSON object {"reply": "...", "target": 4, "verdicts": [{"handle":"n9","keep":true,"score":8,"issue":""}], "done": false, "ops": [...]} using the canvas_plan op shapes.'
            : '\n\nRespond with ONLY a JSON object {"reply": "...", "questions": [], "ops": [...]} using the canvas_plan op shapes.'),
    });
    const res = await fetch(PIKA_MESSAGES, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": pikaKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: isLoop ? 8000 : 4096,
        system: isLoop ? SYSTEM + LOOP_SYSTEM : SYSTEM,
        messages: [{ role: "user", content }],
        ...(withTool
          ? isLoop
            ? { tools: [LOOP_TOOL], tool_choice: { type: "tool", name: "loop_step" } }
            : { tools: [PLAN_TOOL], tool_choice: { type: "tool", name: "canvas_plan" } }
          : {}),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    return { res, payload };
  };

  try {
    // Images + tool first; then fall back step by step if the gateway refuses a feature.
    const attempts: [boolean, boolean][] = images.length || resultImages.length
      ? [[true, true], [false, true], [false, false]]
      : [[false, true], [false, false]];
    let last: { status: number; msg: string } = { status: 0, msg: "" };
    for (const [withImages, withTool] of attempts) {
      const { res, payload } = await call(withImages, withTool);
      if (res.ok) {
        const plan = extractPlan(payload, isLoop ? "loop_step" : "canvas_plan");
        if (!plan) { last = { status: 502, msg: "empty reply" }; continue; }
        console.log("canvas-agent ok", { mode: isLoop ? "loop" : "plan", withImages, withTool, usage: payload?.usage, ops: plan.ops.length, coins });
        const { error: deductError } = await admin.rpc("deduct_reserved_coins", {
          p_reserve_transaction_id: reserveId,
          p_description: isLoop
            ? `Deduct for canvas agent loop step (round ${loop.round ?? 1}, ${plan.ops.length} ops)`
            : `Deduct for canvas agent message (${plan.ops.length} ops)`,
        });
        if (deductError) console.error("canvas-agent deduct", deductError.message);
        return json({ ...plan, coins, saw_images: withImages });
      }
      last = { status: res.status, msg: payload?.error?.message ?? payload?.message ?? `Pika returned ${res.status}` };
      console.error("canvas-agent pika", { withImages, withTool, ...last });
      // Only a request-shape problem is worth retrying with fewer features.
      if (res.status !== 400 && res.status !== 422) break;
    }
    await release(last.msg);
    const friendly =
      last.status === 429
        ? "The assistant is busy right now. Your coins were not charged — please retry."
        : `The assistant could not answer (${last.msg}). Your coins were not charged.`;
    return json({ error: friendly }, 502);
  } catch (e) {
    console.error("canvas-agent", e);
    await release(String((e as Error).message ?? e));
    return json({ error: "Could not reach the assistant. Your coins were not charged." }, 502);
  }
});
