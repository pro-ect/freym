import { useMemo, useRef, useState } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  useStore,
  type NodeProps,
  type ReactFlowState,
} from "@xyflow/react";
import { patchNodeData, type ModelNodeData, type PromptNodeData } from "../types";
import { ROUTES, refTag } from "../lib/modelPairs";
import { orderedRefs } from "../lib/refOrder";

type Chip = { tag: string; kind: "image" | "video" | "audio"; url: string };

const selectEdges = (s: ReactFlowState) => s.edges;
const selectNodes = (s: ReactFlowState) => s.nodes;

export default function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as PromptNodeData;
  const edges = useStore(selectEdges);
  const nodes = useStore(selectNodes);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [atIndex, setAtIndex] = useState<number | null>(null);

  // References wired into the model(s) this prompt feeds, in tag order —
  // shown as chips below the prompt and offered by the "@" menu.
  const chips: Chip[] = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const model = edges
      .filter((e) => e.source === id)
      .map((e) => byId.get(e.target))
      .find((n) => n?.type === "model");
    if (!model) return [];
    const md = model.data as unknown as ModelNodeData;
    const incoming = edges
      .filter((e) => e.target === model.id && e.source !== id)
      .map((e) => ({ edgeId: e.id, src: byId.get(e.source)! }))
      .filter((x) => x.src && x.src.type !== "prompt" && x.src.type !== "promptgen");
    const refs = orderedRefs(incoming, !!ROUTES[md.slug]?.multi?.videoParam);
    let img = 0;
    let vid = 0;
    let aud = 0;
    return refs.map((r) => ({
      tag: refTag(
        md.slug,
        r.kind,
        r.kind === "image" ? ++img : r.kind === "video" ? ++vid : ++aud,
      ),
      kind: r.kind,
      url: r.url,
    }));
  }, [edges, nodes, id]);

  /** Insert a tag at the caret; replaceAt swallows the "@" that opened the menu. */
  const insert = (tag: string, replaceAt?: number) => {
    const text = d.text ?? "";
    const caret = taRef.current?.selectionStart ?? text.length;
    const cut = replaceAt != null ? replaceAt : caret;
    const before = text.slice(0, cut);
    const after = text.slice(replaceAt != null ? replaceAt + 1 : caret);
    const next = `${before}${tag} ${after}`;
    patchNodeData(id, { text: next });
    setAtIndex(null);
    requestAnimationFrame(() => {
      const pos = before.length + tag.length + 1;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={`fc-node fc-prompt ${selected ? "selected" : ""}`}>
      <NodeResizer isVisible={!!selected} minWidth={210} minHeight={140} />
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#10b981" }} />
        Prompt
      </div>
      <textarea
        ref={taRef}
        className="nodrag nowheel"
        value={d.text}
        placeholder="Describe what to generate…"
        onChange={(e) => {
          patchNodeData(id, { text: e.target.value });
          const caret = e.target.selectionStart;
          setAtIndex(
            chips.length && caret > 0 && e.target.value[caret - 1] === "@" ? caret - 1 : null,
          );
        }}
        onBlur={() => setTimeout(() => setAtIndex(null), 200)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAtIndex(null);
        }}
      />
      {atIndex != null && chips.length > 0 && (
        <div className="fc-at-menu nodrag">
          {chips.map((c) => (
            <button key={c.tag} onMouseDown={(e) => { e.preventDefault(); insert(c.tag, atIndex); }}>
              {c.kind === "image" ? (
                <img src={c.url} alt="" />
              ) : c.kind === "video" ? (
                <video src={c.url} muted preload="metadata" />
              ) : (
                <span className="fc-at-note">♪</span>
              )}
              {c.tag}
            </button>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="fc-ref-chips nodrag">
          {chips.map((c) => (
            <button
              key={c.tag}
              className="fc-ref-chip"
              title="Insert into the prompt"
              onClick={() => insert(c.tag)}
            >
              {c.tag}
              <span className="fc-ref-pop">
                {c.kind === "image" ? (
                  <img src={c.url} alt="" />
                ) : c.kind === "video" ? (
                  <video src={c.url} muted loop autoPlay playsInline preload="metadata" />
                ) : (
                  <span className="fc-at-note">♪ audio</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle type="source" position={Position.Right} id="out" className="fc-handle fc-handle-prompt" />
    </div>
  );
}
