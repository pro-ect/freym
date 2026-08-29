import { useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData, type PromptNodeData, type ImageNodeData } from "../types";
import { startRun } from "../lib/runner";
import { usd } from "../lib/balance";
import { estimateCoins } from "../lib/pricing";
import { fetchModels } from "../lib/models";
import { ROUTES } from "../lib/modelPairs";

/** Collect prompt text + reference URLs (image/video/audio) wired into this
 *  model node. Upstream model video results chain as video references only
 *  when the target can take them (chainVideo). */
export function collectInputs(
  nodeId: string,
  getEdges: () => { source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
  opts?: { chainVideo?: boolean },
) {
  const incoming = getEdges().filter((e) => e.target === nodeId);
  const prompts: string[] = [];
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const audioUrls: string[] = [];
  for (const e of incoming) {
    const src = getNode(e.source);
    if (!src) continue;
    if (src.type === "prompt") {
      const t = (src.data as PromptNodeData).text?.trim();
      if (t) prompts.push(t);
    } else if (src.type === "image") {
      const u = (src.data as ImageNodeData).url;
      if (u) imageUrls.push(u);
    } else if (src.type === "video") {
      const u = (src.data as ImageNodeData).url;
      if (u) videoUrls.push(u);
    } else if (src.type === "audio") {
      const u = (src.data as ImageNodeData).url;
      if (u) audioUrls.push(u);
    } else if (src.type === "model") {
      // chaining: an upstream model's result feeds this model's inputs. Video
      // results become video references where supported, else they are skipped.
      const up = src.data as ModelNodeData;
      const first = up.images?.[0];
      if (!first) continue;
      if (!isVideo(first, up.category)) imageUrls.push(first);
      else if (opts?.chainVideo) videoUrls.push(first);
    }
  }
  return { prompt: prompts.join("\n\n"), imageUrls, videoUrls, audioUrls };
}

/** Shared by the node's own Run button and the properties panel's "Run selected". */
export async function runModelNode(
  id: string,
  d: ModelNodeData,
  getEdges: () => { source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
) {
  const routes = ROUTES[d.slug];
  const { prompt, imageUrls, videoUrls, audioUrls } = collectInputs(id, getEdges, getNode, {
    chainVideo: !!routes?.multi?.videoParam,
  });
  if (d.supportsPrompt && !prompt && !imageUrls.length && !videoUrls.length) {
    patchNodeData(id, { status: "error", errorMessage: "connect a prompt or image first" });
    return;
  }
  // Instant feedback: the spinner starts at click time, not when the submit
  // round-trip (auth + edge function + provider) finally answers. A node left
  // "running" with no jobId is reset to idle on project restore.
  patchNodeData(id, { status: "running", jobId: undefined, errorMessage: undefined });

  // One card, many endpoints: route by what is wired (see modelPairs.ts).
  const hasAV = videoUrls.length > 0 || audioUrls.length > 0;
  let slug = d.slug;
  let imageParam = d.imageParamName;
  let images: string[] = [];
  const extra: Record<string, unknown> = {};
  if (routes?.multi && (imageUrls.length > 1 || hasAV)) {
    const m = routes.multi;
    slug = m.slug;
    imageParam = m.param;
    images = imageUrls.slice(0, m.max);
    if (videoUrls.length && m.videoParam) extra[m.videoParam] = videoUrls.slice(0, m.maxVideos ?? 3);
    if (audioUrls.length && m.audioParam) extra[m.audioParam] = audioUrls.slice(0, m.maxAudios ?? 3);
  } else if (routes?.image && imageUrls.length > 0) {
    slug = routes.image.slug;
    imageParam = routes.image.param;
    images = imageUrls.slice(0, routes.image.max);
  } else if (imageUrls.length > 0) {
    // No route: pass images only when the endpoint itself takes them —
    // a text-only endpoint must never receive an image parameter.
    images = imageUrls.slice(0, d.maxRefImages > 0 ? d.maxRefImages : 0);
  }

  // When the run is re-routed, drop params the routed variant doesn't declare
  // (e.g. Wan's t2v `ratio` doesn't exist on image-to-video).
  let custom = d.params?.custom;
  if (slug !== d.slug && custom) {
    const routed = (await fetchModels().catch(() => []))?.find((x) => x.slug === slug);
    if (routed?.param_schema) {
      const keys = new Set(Object.keys(routed.param_schema));
      custom = Object.fromEntries(Object.entries(custom).filter(([k]) => keys.has(k)));
    }
  }

  try {
    await startRun({
      nodeId: id,
      slug,
      provider: d.provider,
      prompt,
      imageUrls: images,
      imageParamName: imageParam,
      aspect: d.params?.aspect,
      numImages: d.params?.numImages,
      custom,
      extra,
    });
  } catch (e) {
    patchNodeData(id, { status: "error", errorMessage: String((e as Error).message ?? e) });
  }
}

/** Trust the model's category, but fall back to the file extension for nodes
 *  saved before video models existed. */
function isVideo(url: string, category?: string): boolean {
  return category === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

export default function ModelNode({ id, data, selected }: NodeProps) {
  const d = data as ModelNodeData;
  const { getEdges, getNode } = useReactFlow();

  const run = useCallback(() => runModelNode(id, d, getEdges, getNode), [id, d, getEdges, getNode]);
  const coins = estimateCoins(d);

  return (
    <div className={`fc-node fc-model ${selected ? "selected" : ""} status-${d.status}`}>
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        <span className="fc-model-name">{d.modelName}</span>
        {coins != null && <span className="fc-cost">{usd(coins)}</span>}
      </div>

      <div className="fc-model-body">
        {d.status === "running" && (
          <div className="fc-placeholder">
            <div className="fc-spinner" />
            generating…
          </div>
        )}
        {d.status === "error" && <div className="fc-error">{d.errorMessage}</div>}
        {d.status !== "running" && d.images?.length > 0 && (
          <div className={`fc-results n${Math.min(d.images.length, 4)}`}>
            {d.images.map((u, i) =>
              isVideo(u, d.category) ? (
                <video key={i} className="nodrag" src={u} controls loop playsInline preload="metadata" />
              ) : (
                <a key={i} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt={`result ${i + 1}`} draggable={false} />
                </a>
              ),
            )}
          </div>
        )}
        {d.status === "idle" && !d.images?.length && (
          <div className="fc-placeholder">connect inputs → run</div>
        )}
      </div>

      <button className="fc-run-btn nodrag" onClick={run} disabled={d.status === "running"}>
        {d.status === "running" ? "Running…" : "→ Run model"}
      </button>

      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle type="source" position={Position.Right} id="out" className="fc-handle fc-handle-model" />
    </div>
  );
}
