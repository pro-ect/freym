import { useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData, type PromptNodeData, type ImageNodeData } from "../types";
import { startRun } from "../lib/runner";
import { usd } from "../lib/balance";
import { estimateCoins } from "../lib/pricing";
import { fetchModels } from "../lib/models";
import { ROUTES, VIDEO_INPUT } from "../lib/modelPairs";
import { orderedRefs } from "../lib/refOrder";

/** Collect prompt text + reference URLs (image/video/audio) wired into this
 *  model node. References come back in orderedRefs order (top to bottom by
 *  node position) so wire badges and prompt tags always match the arrays. */
export function collectInputs(
  nodeId: string,
  getEdges: () => { id: string; source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
  opts?: { chainVideo?: boolean },
) {
  const incoming = getEdges()
    .filter((e) => e.target === nodeId)
    .map((e) => ({ edgeId: e.id, src: getNode(e.source) }))
    .filter((x): x is { edgeId: string; src: Node } => !!x.src);

  const prompts = incoming
    .filter((x) => x.src.type === "prompt")
    .map((x) => (x.src.data as PromptNodeData).text?.trim())
    .filter(Boolean) as string[];

  const refs = orderedRefs(incoming, opts?.chainVideo ?? false);
  return {
    prompt: prompts.join("\n\n"),
    imageUrls: refs.filter((r) => r.kind === "image").map((r) => r.url),
    videoUrls: refs.filter((r) => r.kind === "video").map((r) => r.url),
    audioUrls: refs.filter((r) => r.kind === "audio").map((r) => r.url),
  };
}

/** Shared by the node's own Run button and the properties panel's "Run selected". */
export async function runModelNode(
  id: string,
  d: ModelNodeData,
  getEdges: () => { id: string; source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
) {
  // Inputs still cooking? Queue this node — the canvas fires it automatically
  // once every upstream job (model runs, media uploads) has settled.
  const upstreamPending = getEdges()
    .filter((e) => e.target === id)
    .some((e) => {
      const s = getNode(e.source);
      if (!s) return false;
      const sd = s.data as { status?: string; uploading?: boolean };
      if (s.type === "model") return sd.status === "running" || sd.status === "queued";
      if (s.type === "image" || s.type === "video" || s.type === "audio") return !!sd.uploading;
      return false;
    });
  if (upstreamPending) {
    patchNodeData(id, { status: "queued", errorMessage: undefined });
    return;
  }

  const routes = ROUTES[d.slug];
  const videoInput = VIDEO_INPUT[d.slug];
  const { prompt, imageUrls, videoUrls, audioUrls } = collectInputs(id, getEdges, getNode, {
    chainVideo: !!routes?.multi?.videoParam || !!videoInput,
  });
  if (videoInput && !videoUrls.length) {
    patchNodeData(id, { status: "error", errorMessage: "wire a video first (Video node or a video result)" });
    return;
  }
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
  if (routes?.multi && (imageUrls.length >= (routes.multi.minImages ?? 2) || hasAV)) {
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
  if (videoInput && videoUrls.length) {
    extra[videoInput.param] =
      videoInput.max === 1 ? videoUrls[0] : videoUrls.slice(0, videoInput.max);
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
        {(d.status === "running" || d.status === "queued") && !d.images?.length && (
          <div className="fc-placeholder">
            <div className="fc-spinner" />
            {d.status === "queued" ? "waiting for inputs…" : "generating…"}
          </div>
        )}
        {d.status === "error" && <div className="fc-error">{d.errorMessage}</div>}
        {d.images?.length > 0 && (
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
            {(d.status === "running" || d.status === "queued") && (
              <div className="fc-busy-overlay">
                <div className="fc-spinner" />
                {d.status === "queued" ? "waiting for inputs…" : "generating…"}
              </div>
            )}
            {(d.runs?.length ?? 0) > 1 && (
              <div className="fc-runs-nav nodrag">
                <button
                  disabled={(d.runIndex ?? (d.runs!.length - 1)) === 0}
                  onClick={() => {
                    const i = (d.runIndex ?? d.runs!.length - 1) - 1;
                    patchNodeData(id, { runIndex: i, images: d.runs![i] });
                  }}
                >
                  ‹
                </button>
                <span>
                  {(d.runIndex ?? d.runs!.length - 1) + 1}/{d.runs!.length}
                </span>
                <button
                  disabled={(d.runIndex ?? (d.runs!.length - 1)) === d.runs!.length - 1}
                  onClick={() => {
                    const i = (d.runIndex ?? d.runs!.length - 1) + 1;
                    patchNodeData(id, { runIndex: i, images: d.runs![i] });
                  }}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
        {d.status === "idle" && !d.images?.length && (
          <div className="fc-placeholder">connect inputs → run</div>
        )}
      </div>

      <button
        className="fc-run-btn nodrag"
        onClick={d.status === "queued" ? () => patchNodeData(id, { status: "idle" }) : run}
        disabled={d.status === "running"}
      >
        {d.status === "running"
          ? "Running…"
          : d.status === "queued"
            ? "Queued — cancel"
            : "→ Run model"}
      </button>

      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle type="source" position={Position.Right} id="out" className="fc-handle fc-handle-model" />
    </div>
  );
}
