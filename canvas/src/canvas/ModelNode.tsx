import { useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData, type PromptNodeData, type ImageNodeData } from "../types";
import { startRun } from "../lib/runner";

/** Collect prompt text + input image URLs from nodes wired into this model node. */
export function collectInputs(
  nodeId: string,
  getEdges: () => { source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
) {
  const incoming = getEdges().filter((e) => e.target === nodeId);
  const prompts: string[] = [];
  const imageUrls: string[] = [];
  for (const e of incoming) {
    const src = getNode(e.source);
    if (!src) continue;
    if (src.type === "prompt") {
      const t = (src.data as PromptNodeData).text?.trim();
      if (t) prompts.push(t);
    } else if (src.type === "image") {
      const u = (src.data as ImageNodeData).url;
      if (u) imageUrls.push(u);
    } else if (src.type === "model") {
      // chaining: an upstream model's result feeds this model's image input.
      // A video result is not a usable reference image, so skip it.
      const up = src.data as ModelNodeData;
      const first = up.images?.[0];
      if (first && !isVideo(first, up.category)) imageUrls.push(first);
    }
  }
  return { prompt: prompts.join("\n\n"), imageUrls };
}

/** Shared by the node's own Run button and the properties panel's "Run selected". */
export async function runModelNode(
  id: string,
  d: ModelNodeData,
  getEdges: () => { source: string; target: string; targetHandle?: string | null }[],
  getNode: (id: string) => Node | undefined,
) {
  const { prompt, imageUrls } = collectInputs(id, getEdges, getNode);
  if (d.supportsPrompt && !prompt && !imageUrls.length) {
    patchNodeData(id, { status: "error", errorMessage: "connect a prompt or image first" });
    return;
  }
  try {
    await startRun({
      nodeId: id,
      slug: d.slug,
      provider: d.provider,
      prompt,
      imageUrls: imageUrls.slice(0, Math.max(d.maxRefImages, imageUrls.length ? 1 : 0)),
      imageParamName: d.imageParamName,
      aspect: d.params?.aspect,
      numImages: d.params?.numImages,
      custom: d.params?.custom,
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

  return (
    <div className={`fc-node fc-model ${selected ? "selected" : ""} status-${d.status}`}>
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        <span className="fc-model-name">{d.modelName}</span>
        {d.costCoins != null && <span className="fc-cost">✳ {d.costCoins}</span>}
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
