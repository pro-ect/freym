import type { Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData } from "../types";

const ASPECTS = ["default", "1:1", "9:16", "16:9", "4:5", "3:4", "3:2"];

export default function PropertiesPanel({ node, onRun }: { node: Node | null; onRun: () => void }) {
  if (!node || node.type !== "model") return null;
  const d = node.data as unknown as ModelNodeData;
  return (
    <aside className="fc-props">
      <div className="fc-props-title">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        {d.modelName}
        {d.costCoins != null && <span className="fc-cost">✳ {d.costCoins}</span>}
      </div>

      <label className="fc-field">
        <span>Aspect ratio</span>
        <select
          value={d.params?.aspect ?? "default"}
          onChange={(e) => patchNodeData(node.id, { params: { ...d.params, aspect: e.target.value } })}
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a === "default" ? "Default" : a}
            </option>
          ))}
        </select>
      </label>

      <label className="fc-field">
        <span>Images per run</span>
        <select
          value={d.params?.numImages ?? 1}
          onChange={(e) =>
            patchNodeData(node.id, { params: { ...d.params, numImages: Number(e.target.value) } })
          }
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {d.maxRefImages > 0 && (
        <div className="fc-hint">
          Accepts up to {d.maxRefImages} reference image{d.maxRefImages > 1 ? "s" : ""} — wire Image
          or Model nodes into the left handle.
        </div>
      )}

      <div className="fc-props-footer">
        <button className="fc-run-btn" onClick={onRun} disabled={d.status === "running"}>
          {d.status === "running" ? "Running…" : "→ Run selected"}
        </button>
      </div>
    </aside>
  );
}
