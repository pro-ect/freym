import type { Node } from "@xyflow/react";
import { v4 as uuid } from "uuid";
import { refCapacity } from "./modelPairs";
import type { CloudModel, ImageNodeData, ModelNodeData, TextNodeData } from "../types";

/**
 * The ONE place that builds board nodes. The canvas (sidebar, toolbar, paste,
 * agent) and the `freym-aigen` CLI both use it, so a board made outside the browser
 * has exactly the nodes the canvas makes.
 */

type Pos = { x: number; y: number };

/** Seed a new model node with the schema's own defaults so runs match the app. */
export function defaultsFor(schema: CloudModel["param_schema"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    if (field?.default !== undefined) out[key] = field.default;
  }
  return out;
}

export function modelToNode(m: CloudModel, position: Pos): Node {
  return {
    id: uuid(),
    type: "model",
    position,
    data: {
      slug: m.slug,
      modelName: m.name,
      category: m.category,
      provider: m.provider,
      costCoins: m.coin_cost,
      perSecondCents: m.price_per_second_cents != null ? Number(m.price_per_second_cents) : null,
      rateTable: m.rate_table ?? null,
      supportsPrompt: m.supports_prompt !== false,
      // Dual-mode image models accept the edit variant's reference count.
      maxRefImages: refCapacity(m.slug, m.reference_images_max ?? 0),
      imageParamName: m.image_parameter_name,
      status: "idle",
      images: [],
      params: { custom: defaultsFor(m.param_schema) },
      paramSchema: m.param_schema ?? null,
    } satisfies ModelNodeData,
  };
}

/** An image input. `url` null = an empty drop target. */
export function imageNode(url: string | null, position: Pos, extra: Partial<ImageNodeData> = {}): Node {
  return { id: uuid(), type: "image", position, data: { url, ...extra } satisfies ImageNodeData };
}

/** A free text block (a label or a title): no wires. */
export function textNode(text: string, position: Pos, fontSize = 24): Node {
  return { id: uuid(), type: "text", position, data: { text, fontSize } satisfies TextNodeData };
}

/** A video or audio input: a clip to look at, or a reference for a model that takes one. `url` null = an empty drop target. */
export function mediaNode(kind: "video" | "audio", url: string | null, position: Pos, extra: Partial<ImageNodeData> = {}): Node {
  return { id: uuid(), type: kind, position, data: { url, ...extra } satisfies ImageNodeData };
}
