// A plan file → canvas nodes and edges, through the SAME code the canvas uses:
// nodes.ts builds every node, agentPlan.applyPlan checks slugs, params and ref
// caps, wires and lays out. The CLI adds ops the canvas agent has no need for:
// add_text (a title), add_image (an image) and add_video (a clip: the canvas's Video node).
import type { Edge, Node } from "@xyflow/react";
import { applyPlan, clearDraft, handleMap, type PlanOp } from "../src/lib/agentPlan";
import { isHiddenVariant } from "../src/lib/modelPairs";
import { imageNode, mediaNode, modelToNode, textNode } from "../src/lib/nodes";
import { estimateCoins } from "../src/lib/pricing";
import type { CloudModel, ModelNodeData } from "../src/types";
import { CliError } from "./errors";

export type ImageSrc = { key: string; src: string; kind?: "image" | "video" };
export type PlanFile = { name?: string; ops: Record<string, unknown>[] };

const APPLY_OPS = new Set(["add_prompt", "add_model", "connect", "set_prompt", "set_params", "remove"]);
const IMG_W = 300; // an image node is max 300 wide; its picture fills the width
const IMG_CHROME = 80; // header + Replace button (the Video node has the same)
const IMG_GAP = 60;
const GRID_COLS = 4; // images that feed no model
const TITLE_GAP = 40;

export function parsePlan(text: string): PlanFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CliError(`the plan is not JSON: ${(e as Error).message}`, 1);
  }
  const plan = (Array.isArray(raw) ? { ops: raw } : raw) as PlanFile;
  if (!plan || !Array.isArray(plan.ops)) throw new CliError('the plan needs an "ops" array (see `freym-aigen plan-help`)', 1);
  return plan;
}

const box = (n: Node) => ({
  x: n.position.x,
  y: n.position.y,
  w: n.measured?.width ?? n.width ?? 300,
  h: n.measured?.height ?? n.height ?? 320,
});

/**
 * Build the next board. `resolveImage` turns an add_image src into a public URL
 * (upload) — or, for a check, returns a stand-in after it checked the file.
 * Any problem is an error: there is no review card outside the canvas.
 */
export async function buildBoard(
  plan: PlanFile,
  ctx: {
    nodes: Node[];
    edges: Edge[];
    models: CloudModel[];
    /** ratio = picture height / width (the node is 300 wide and as tall as its picture). */
    resolveImage: (img: ImageSrc) => Promise<{ url: string; fileName?: string; ratio?: number }>;
  },
) {
  const problems: string[] = [];
  const bySlug = new Map(ctx.models.map((m) => [m.slug, m]));
  const keys = new Set<string>();
  const texts: { key: string; text: string; size: number }[] = [];
  const images: ImageSrc[] = [];
  const applyOps: PlanOp[] = [];

  plan.ops.forEach((o, i) => {
    const op = String(o.op ?? "");
    const key = String(o.key ?? "");
    const at = `op ${i + 1} (${op || "no op"})`;
    if (op === "add_text" || op === "add_image" || op === "add_video" || op === "add_prompt" || op === "add_model") {
      if (!key) return problems.push(`${at}: needs a "key"`);
      if (keys.has(key)) return problems.push(`${at}: the key "${key}" is used twice`);
      keys.add(key);
    }
    if (op === "add_text") {
      const text = String(o.text ?? "").trim();
      if (!text) return problems.push(`${at}: the text is empty`);
      const size = Number(o.size ?? 48);
      if (!Number.isFinite(size) || size < 8 || size > 400) return problems.push(`${at}: size must be 8–400`);
      texts.push({ key, text, size });
    } else if (op === "add_image") {
      const src = String(o.src ?? "").trim();
      if (!src) return problems.push(`${at}: needs "src" (a local image file or an https URL)`);
      images.push({ key, src, kind: "image" });
    } else if (op === "add_video") {
      const src = String(o.src ?? "").trim();
      if (!src) return problems.push(`${at}: needs "src" (a local .mp4, .mov, .webm or .m4v file, or an https URL)`);
      images.push({ key, src, kind: "video" });
    } else if (APPLY_OPS.has(op)) {
      if (op === "add_prompt" && !String(o.text ?? "").trim()) return problems.push(`${at}: the prompt text is empty`);
      if (op === "add_model") {
        const slug = String(o.slug ?? "");
        const m = bySlug.get(slug);
        if (!m || isHiddenVariant(slug)) return problems.push(`${at}: unknown model "${slug}" (see \`freym-aigen models\`)`);
        if (m.category !== "image" && m.category !== "video")
          return problems.push(`${at}: ${m.name} is a ${m.category} model; the CLI places image and video models only`);
      }
      applyOps.push(o as unknown as PlanOp);
    } else {
      problems.push(`${at}: unknown op (use add_text, add_image, add_video, add_prompt, add_model, connect, set_prompt, set_params)`);
    }
  });
  if (!plan.ops.length) problems.push("the plan has no ops");
  // Keep going after a problem: an agent gets every problem of the plan in one run.

  // Where the new block starts: the top left of an empty board, or under everything.
  const old = ctx.nodes.map(box);
  const origin = old.length
    ? { x: Math.min(...old.map((b) => b.x)), y: Math.max(...old.map((b) => b.y + b.h)) + 200 }
    : { x: 0, y: 0 };

  // Existing nodes are n1, n2… (as `freym-aigen show` prints them); a new key must not hide one.
  const handles = handleMap(ctx.nodes).toId;
  for (const k of keys) if (handles.has(k)) problems.push(`the key "${k}" is the handle of a node already on the board: pick another key`);

  // Titles first, one under the other.
  let y = origin.y;
  const textNodes: Node[] = texts.map((t) => {
    const n = textNode(t.text, { x: origin.x, y }, t.size);
    y += Math.round(t.size * 1.4) + TITLE_GAP;
    return n;
  });
  const top = texts.length ? y + TITLE_GAP : origin.y;

  // Images that feed a model are references: a column on the left, and applyPlan puts what they
  // feed to their right. Images that feed nothing are a set to look at: a grid, above the rest.
  const toId = handles;
  const wired = new Set(
    applyOps
      .filter((o) => (o as { op: string }).op === "connect")
      .map((o) => String((o as Record<string, unknown>).from ?? (o as Record<string, unknown>).source ?? "")),
  );
  const imageNodes: Node[] = [];
  const loose: Node[] = [];
  const refs: Node[] = [];
  for (const img of images) {
    try {
      const r = await ctx.resolveImage(img);
      const h = Math.round(IMG_CHROME + IMG_W * (r.ratio && r.ratio > 0 ? Math.min(r.ratio, 3) : 1));
      const extra = r.fileName ? { fileName: r.fileName } : {};
      const n = img.kind === "video" ? mediaNode("video", r.url, { x: origin.x, y: top }, extra) : imageNode(r.url, { x: origin.x, y: top }, extra);
      // A size estimate until the canvas measures the node: layout (and the next `freym-aigen add`)
      // then knows how tall the picture is.
      n.measured = { width: IMG_W, height: h };
      imageNodes.push(n);
      (wired.has(img.key) ? refs : loose).push(n);
      toId.set(img.key, n.id);
    } catch (e) {
      problems.push(`${img.kind ?? "image"} "${img.key}": ${(e as Error).message}`);
    }
  }
  let rowY = top;
  for (let i = 0; i < loose.length; i += GRID_COLS) {
    const row = loose.slice(i, i + GRID_COLS);
    row.forEach((n, j) => (n.position = { x: origin.x + j * (IMG_W + IMG_GAP), y: rowY }));
    rowY += Math.max(...row.map((n) => n.measured!.height!)) + IMG_GAP;
  }
  const blockTop = loose.length ? rowY + IMG_GAP : top;
  let imgY = blockTop;
  for (const n of refs) {
    n.position = { x: origin.x, y: imgY };
    imgY += n.measured!.height! + IMG_GAP;
  }

  const result = applyPlan(
    { reply: "", ops: applyOps },
    {
      nodes: [...ctx.nodes, ...imageNodes],
      edges: ctx.edges,
      models: ctx.models,
      toId,
      makeModelNode: modelToNode,
      fallbackPos: { x: origin.x + (refs.length ? IMG_W + 80 : 0), y: blockTop },
    },
  );
  const all = [...problems, ...result.warnings];
  if (all.length) throw new CliError(`the plan does not pass the checks (${all.length})`, 1, all);

  const nodes = clearDraft([...result.nodes, ...textNodes]);
  const created = new Set([...result.created, ...imageNodes.map((n) => n.id), ...textNodes.map((n) => n.id)]);

  // What one run of every new model costs (the user starts the runs in the canvas).
  // Wired images, counted like applyPlan counts them (an image node, or an image model's result).
  const imageOut = (n?: Node) =>
    !!n && (n.type === "image" || (n.type === "model" && !["video", "audio"].includes(String((n.data as { category?: string }).category))));
  const images_in = (id: string) =>
    result.edges.filter((e) => e.target === id && imageOut(nodes.find((n) => n.id === e.source))).length;
  const runs = nodes
    .filter((n) => created.has(n.id) && n.type === "model")
    .map((n) => {
      const d = n.data as unknown as ModelNodeData;
      return { model: d.modelName, slug: d.slug, coins: estimateCoins(d, images_in(n.id)) };
    });
  const coins = runs.reduce((s, r) => s + (r.coins ?? 0), 0);

  return {
    nodes,
    edges: result.edges,
    created: [...created],
    counts: {
      titles: textNodes.length,
      images: imageNodes.filter((n) => n.type === "image").length,
      videos: imageNodes.filter((n) => n.type === "video").length,
      prompts: nodes.filter((n) => created.has(n.id) && n.type === "prompt").length,
      models: runs.length,
      wires: result.edges.length - ctx.edges.length,
    },
    runs,
    coins,
  };
}
