import type { Edge, Node } from "@xyflow/react";
import { v4 as uuid } from "uuid";
import { isHiddenVariant, refCapacity, ROUTES } from "./modelPairs";
import type { CloudModel, ImageNodeData, ModelNodeData, ParamSchema, PromptNodeData } from "../types";

/**
 * The canvas agent is a PLANNER: canvas-agent returns ops, this module checks
 * them against the real catalog and board, lays the new nodes out and returns
 * the next nodes/edges. Nothing here runs a model or spends coins.
 *
 * Existing board nodes are addressed by short handles (n1, n2…) so the model
 * never has to copy uuids; new nodes carry the key the plan gave them.
 */

export type Chip =
  | { kind: "node"; nodeId: string; label: string; nodeType: string; thumb?: string | null }
  | { kind: "model"; slug: string; label: string; icon?: string | null };

export type PlanOp =
  | { op: "add_prompt"; key: string; text: string }
  | { op: "add_model"; key: string; slug: string; params?: Record<string, unknown> }
  | { op: "connect"; from: string; to: string }
  | { op: "set_prompt"; id: string; text: string }
  | { op: "set_params"; id: string; params: Record<string, unknown> }
  | { op: "remove"; id: string };

export type Plan = { reply: string; questions?: string[]; ops: PlanOp[] };

export const DRAFT_CLASS = "fc-draft";

export function isDraft(n: Node): boolean {
  return !!(n.data as { draft?: boolean }).draft;
}

/** Short visible label for a node — chips, the @ list and the agent context. */
export function nodeLabel(n: Node): string {
  const d = n.data as Record<string, unknown>;
  switch (n.type) {
    case "image": {
      const f = (d as ImageNodeData).fileName;
      const base = f && !f.startsWith("upload failed") ? f.replace(/\.[a-z0-9]+$/i, "") : "";
      return base && !/^\d{10,}_[a-z0-9]+$/i.test(base) && !/^(image|img|photo)$/i.test(base) ? base : "Image";
    }
    case "prompt": {
      const t = ((d as PromptNodeData).text ?? "").trim();
      return t ? t.split(/\s+/).slice(0, 5).join(" ") + (t.split(/\s+/).length > 5 ? "…" : "") : "Prompt";
    }
    case "model":
      return (d as ModelNodeData).modelName ?? "Model";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "text":
      return String(d.text ?? "Text").slice(0, 30) || "Text";
    default:
      return n.type ?? "node";
  }
}

export function nodeThumb(n: Node): string | null {
  const d = n.data as { url?: string | null; images?: string[]; category?: string };
  if (n.type === "image") return d.url ?? null;
  if (n.type === "model" && d.category !== "video" && d.category !== "audio") return d.images?.[0] ?? null;
  return null;
}

export function chipForNode(n: Node): Chip {
  return { kind: "node", nodeId: n.id, nodeType: n.type ?? "", label: nodeLabel(n), thumb: nodeThumb(n) };
}

/** Board nodes the agent can address, with stable short handles. */
export function handleMap(nodes: Node[]): { toHandle: Map<string, string>; toId: Map<string, string> } {
  const toHandle = new Map<string, string>();
  const toId = new Map<string, string>();
  nodes
    .filter((n) => n.type !== "text")
    .forEach((n, i) => {
      const h = `n${i + 1}`;
      toHandle.set(n.id, h);
      toId.set(h, n.id);
    });
  return { toHandle, toId };
}

/** Image-capable output of a node: what a wire from it feeds a model. */
function imageOut(n: Node): boolean {
  if (n.type === "image") return true;
  if (n.type === "model") {
    const c = (n.data as ModelNodeData).category;
    return c !== "video" && c !== "audio";
  }
  return false;
}

/** Compact catalog line per runnable image/video model. */
export function catalogForAgent(models: CloudModel[], favorites: Set<string>) {
  return models
    .filter((m) => (m.category === "image" || m.category === "video") && !isHiddenVariant(m.slug))
    .filter((m) => !(m.tags ?? []).includes("tool"))
    .map((m) => ({
      slug: m.slug,
      name: m.name,
      category: m.category,
      provider: m.provider,
      max_images: refCapacity(m.slug, m.reference_images_max ?? 0),
      frames: m.category === "video" && !!ROUTES[m.slug]?.image,
      coins: m.coin_cost,
      favorite: favorites.has(m.slug),
      new: !!m.is_new,
      params: Object.fromEntries(
        Object.entries(m.param_schema ?? {})
          .filter(([, f]) => f.type !== "note")
          .map(([k, f]) => [k, f.options?.length ? f.options : f.type]),
      ),
    }));
}

/** What the agent sees of the board: every node with its handle and wiring. */
export function boardForAgent(nodes: Node[], edges: Edge[], toHandle: Map<string, string>) {
  return nodes
    .filter((n) => toHandle.has(n.id))
    .slice(0, 120)
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      const inputs = edges
        .filter((e) => e.target === n.id)
        .map((e) => toHandle.get(e.source))
        .filter(Boolean);
      return {
        handle: toHandle.get(n.id),
        type: n.type,
        label: nodeLabel(n),
        ...(n.type === "prompt" ? { text: String((d as PromptNodeData).text ?? "").slice(0, 400) } : {}),
        ...(n.type === "model"
          ? {
              slug: (d as ModelNodeData).slug,
              params: (d as ModelNodeData).params?.custom ?? {},
              has_result: !!(d as ModelNodeData).images?.length,
            }
          : {}),
        ...(n.type === "image" ? { has_image: !!(d as ImageNodeData).url } : {}),
        ...(inputs.length ? { inputs } : {}),
        ...(isDraft(n) ? { draft: true } : {}),
      };
    });
}

/** Keep only params the model declares, with values its schema allows. */
function cleanParams(schema: ParamSchema | null | undefined, params: Record<string, unknown> | undefined, warn: (s: string) => void) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const f = schema?.[k];
    if (!f) {
      warn(`ignored unknown setting "${k}"`);
      continue;
    }
    if (f.type === "boolean") out[k] = v === true || v === "true";
    else if (f.options?.length) {
      const hit = f.options.find((o) => String(o) === String(v));
      if (hit === undefined) warn(`"${k}" has no option "${String(v)}"`);
      else out[k] = hit;
    } else if (f.type === "number" || f.type === "slider") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else out[k] = v;
  }
  return out;
}

const COL = 400;
const PROMPT_W = 300;
const PROMPT_H = 200;
const PROMPT_GAP = 230;
const MODEL_GAP = 440;

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (n: Node): Box => ({
  x: n.position.x,
  y: n.position.y,
  w: n.measured?.width ?? n.width ?? 300,
  h: n.measured?.height ?? n.height ?? 320,
});
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export type ApplyResult = {
  nodes: Node[];
  edges: Edge[];
  created: string[];
  changed: number;
  removed: number;
  warnings: string[];
};

/**
 * Apply a checked plan. `makeModelNode` builds a model node exactly like the
 * sidebar does (defaults, pricing, ref capacity).
 */
export function applyPlan(
  plan: Plan,
  ctx: {
    nodes: Node[];
    edges: Edge[];
    models: CloudModel[];
    toId: Map<string, string>;
    makeModelNode: (m: CloudModel, pos: { x: number; y: number }) => Node;
    fallbackPos: { x: number; y: number };
  },
): ApplyResult {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const bySlug = new Map(ctx.models.map((m) => [m.slug, m]));
  let nodes = [...ctx.nodes];
  let edges = [...ctx.edges];
  const newNodes = new Map<string, Node>(); // plan key → node
  const created: string[] = [];
  let changed = 0;
  let removed = 0;

  const resolve = (ref: string): Node | undefined => {
    const key = String(ref ?? "").replace(/^@/, "");
    if (newNodes.has(key)) return newNodes.get(key);
    const id = ctx.toId.get(key) ?? key;
    return nodes.find((n) => n.id === id) ?? [...newNodes.values()].find((n) => n.id === id);
  };

  // Models are loose with field names: accept id/name as the new key and
  // source/target for wires.
  const ops: PlanOp[] = (plan.ops ?? []).map((raw) => {
    const o = raw as Record<string, unknown>;
    const key = String(o.key ?? o.id ?? o.name ?? "");
    const op = String(o.op ?? o.type ?? "");
    if (op === "add_prompt" || op === "add_model") return { ...o, op, key } as PlanOp;
    if (op === "connect") return { op, from: String(o.from ?? o.source ?? ""), to: String(o.to ?? o.target ?? "") };
    return { ...o, op, id: String(o.id ?? o.key ?? o.node ?? "") } as PlanOp;
  });

  // 1) Create nodes (positions are set by the layout pass below).
  for (const op of ops) {
    if (op.op === "add_prompt") {
      if (!op.key || newNodes.has(op.key)) { warn(`skipped a prompt with a missing or repeated key`); continue; }
      newNodes.set(op.key, {
        id: uuid(),
        type: "prompt",
        position: { x: 0, y: 0 },
        width: PROMPT_W,
        height: PROMPT_H,
        className: DRAFT_CLASS,
        data: { text: String(op.text ?? "").trim(), draft: true },
      });
    } else if (op.op === "add_model") {
      const m = bySlug.get(op.slug);
      if (!m || isHiddenVariant(op.slug) || (m.category !== "image" && m.category !== "video")) {
        warn(`unknown model "${op.slug}" — skipped`);
        continue;
      }
      if (!op.key || newNodes.has(op.key)) { warn(`skipped ${m.name}: missing or repeated key`); continue; }
      const n = ctx.makeModelNode(m, { x: 0, y: 0 });
      const d = n.data as unknown as ModelNodeData;
      const custom = { ...(d.params?.custom ?? {}), ...cleanParams(m.param_schema, op.params, (s) => warn(`${m.name}: ${s}`)) };
      newNodes.set(op.key, { ...n, className: DRAFT_CLASS, data: { ...d, params: { ...d.params, custom }, draft: true } });
    }
  }

  // 2) Edits to existing nodes — only drafts and nodes the board already has.
  for (const op of ops) {
    if (op.op === "set_prompt") {
      const t = resolve(op.id);
      if (!t || t.type !== "prompt") { warn(`could not edit prompt ${op.id}`); continue; }
      if (newNodes.has(op.id)) continue;
      nodes = nodes.map((n) => (n.id === t.id ? { ...n, data: { ...n.data, text: String(op.text ?? "").trim() } } : n));
      changed++;
    } else if (op.op === "set_params") {
      const t = resolve(op.id);
      if (!t || t.type !== "model") { warn(`could not change settings of ${op.id}`); continue; }
      const d = t.data as unknown as ModelNodeData;
      const m = bySlug.get(d.slug);
      const clean = cleanParams(m?.param_schema ?? d.paramSchema, op.params, (s) => warn(`${d.modelName}: ${s}`));
      const apply = (n: Node) => ({ ...n, data: { ...n.data, params: { ...d.params, custom: { ...(d.params?.custom ?? {}), ...clean } } } });
      const newKey = [...newNodes.entries()].find(([, n]) => n.id === t.id)?.[0];
      if (newKey) {
        newNodes.set(newKey, apply(t));
        continue;
      }
      nodes = nodes.map((n) => (n.id === t.id ? apply(n) : n));
      changed++;
    } else if (op.op === "remove") {
      const t = resolve(op.id);
      // The agent may only take back what it drafted — never the user's work.
      if (!t || !isDraft(t)) { warn(`did not remove ${op.id} (only draft nodes can be removed)`); continue; }
      nodes = nodes.filter((n) => n.id !== t.id);
      edges = edges.filter((e) => e.source !== t.id && e.target !== t.id);
      removed++;
    }
  }

  // 3) Wires, checked against what each model can take.
  const all = () => [...nodes, ...newNodes.values()];
  const newEdges: Edge[] = [];
  for (const op of ops) {
    if (op.op !== "connect") continue;
    const src = resolve(op.from);
    const dst = resolve(op.to);
    if (!src || !dst) { warn(`could not wire ${op.from} → ${op.to} (${!src ? op.from : op.to} not found)`); continue; }
    if (dst.type !== "model") { warn(`wires must end on a model (${op.to})`); continue; }
    if (src.id === dst.id) continue;
    const exists = [...edges, ...newEdges].some((e) => e.source === src.id && e.target === dst.id);
    if (exists) continue;
    const dd = dst.data as unknown as ModelNodeData;
    if (imageOut(src)) {
      const wiredImages = [...edges, ...newEdges]
        .filter((e) => e.target === dst.id)
        .map((e) => all().find((n) => n.id === e.source))
        .filter((n) => n && imageOut(n)).length;
      const cap = dd.maxRefImages ?? 0;
      if (wiredImages >= cap) {
        warn(cap === 0 ? `${dd.modelName} takes no reference images — not wired` : `${dd.modelName} takes at most ${cap} image${cap === 1 ? "" : "s"}`);
        continue;
      }
    }
    newEdges.push({
      id: `e-${src.id}-${dst.id}`,
      source: src.id,
      sourceHandle: "out",
      target: dst.id,
      targetHandle: "in",
      type: "default",
    });
  }

  // 4) Layout: sources on the left, prompts next, models in columns by depth.
  const placed = [...newNodes.values()];
  if (placed.length) {
    const linkEdges = [...edges, ...newEdges];
    const existingSources = linkEdges
      .filter((e) => placed.some((n) => n.id === e.target))
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is Node => !!n);
    const anchorX = existingSources.length
      ? Math.max(...existingSources.map((n) => boxOf(n).x + boxOf(n).w)) + 80
      : ctx.fallbackPos.x;
    const anchorY = existingSources.length
      ? Math.min(...existingSources.map((n) => n.position.y))
      : ctx.fallbackPos.y;

    const depth = new Map<string, number>();
    const depthOf = (n: Node, seen = new Set<string>()): number => {
      if (depth.has(n.id)) return depth.get(n.id)!;
      if (n.type !== "model" || seen.has(n.id)) return 0;
      seen.add(n.id);
      const ups = linkEdges
        .filter((e) => e.target === n.id)
        .map((e) => placed.find((p) => p.id === e.source))
        .filter((p): p is Node => !!p && p.type === "model");
      const d = 1 + Math.max(0, ...ups.map((u) => depthOf(u, seen)));
      depth.set(n.id, d);
      return d;
    };
    const prompts = placed.filter((n) => n.type === "prompt");
    const models = placed.filter((n) => n.type === "model");
    const hasPrompts = prompts.length > 0;
    const pos = new Map<string, { x: number; y: number }>();
    prompts.forEach((n, i) => pos.set(n.id, { x: anchorX, y: anchorY + i * PROMPT_GAP }));
    const cols = new Map<number, Node[]>();
    for (const m of models) {
      const d = depthOf(m);
      cols.set(d, [...(cols.get(d) ?? []), m]);
    }
    for (const [d, list] of cols) {
      list.forEach((n, i) =>
        pos.set(n.id, { x: anchorX + (hasPrompts ? COL : 0) + (d - 1) * COL, y: anchorY + i * MODEL_GAP }),
      );
    }

    // Slide the whole block down until it clears every existing node.
    const block = (dy: number) =>
      placed.map((n) => {
        const p = pos.get(n.id)!;
        return { x: p.x, y: p.y + dy, w: n.type === "prompt" ? PROMPT_W : 300, h: n.type === "prompt" ? PROMPT_H : 380 };
      });
    const others = nodes.map(boxOf);
    let dy = 0;
    for (let i = 0; i < 60 && block(dy).some((b) => others.some((o) => hit(b, o))); i++) dy += 120;
    for (const n of placed) {
      const p = pos.get(n.id)!;
      n.position = { x: p.x, y: p.y + dy };
    }
  }

  for (const n of placed) created.push(n.id);
  return {
    nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...placed],
    edges: [...edges, ...newEdges],
    created,
    changed,
    removed,
    warnings,
  };
}

/** Drop the draft look (Run all / Keep). */
export function clearDraft(nodes: Node[], ids?: Set<string>): Node[] {
  return nodes.map((n) => {
    if (!isDraft(n) || (ids && !ids.has(n.id))) return n;
    const { draft: _d, ...data } = n.data as Record<string, unknown>;
    return { ...n, className: undefined, data };
  });
}
