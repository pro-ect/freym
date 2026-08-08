import type { Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData } from "../types";

const ASPECTS = ["default", "1:1", "9:16", "16:9", "4:5", "3:4", "3:2"];

export default function PropertiesPanel({
  nodes,
  onRun,
}: {
  nodes: Node[];
  onRun: (models: Node[]) => void;
}) {
  const models = nodes.filter((n) => n.type === "model");
  if (!models.length) return null;

  const many = models.length > 1;
  const first = models[0].data as unknown as ModelNodeData;
  const running = models.some((n) => (n.data as unknown as ModelNodeData).status === "running");

  // With a multi-selection the controls write the same value to every model.
  const patchAll = (params: Partial<ModelNodeData["params"]>) =>
    models.forEach((n) => {
      const d = n.data as unknown as ModelNodeData;
      patchNodeData(n.id, { params: { ...d.params, ...params } });
    });

  const names = [...new Set(models.map((n) => (n.data as unknown as ModelNodeData).modelName))];
  const totalCoins = models.reduce(
    (sum, n) => sum + ((n.data as unknown as ModelNodeData).costCoins ?? 0),
    0,
  );

  return (
    <aside className="fc-props">
      <div className="fc-props-title">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        {many ? `${models.length} models` : first.modelName}
        {totalCoins > 0 && <span className="fc-cost">✳ {totalCoins}</span>}
      </div>

      {many && <div className="fc-hint">{names.join(" · ")}</div>}

      <label className="fc-field">
        <span>Aspect ratio</span>
        <select
          value={first.params?.aspect ?? "default"}
          onChange={(e) => patchAll({ aspect: e.target.value })}
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
          value={first.params?.numImages ?? 1}
          onChange={(e) => patchAll({ numImages: Number(e.target.value) })}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {!many && first.maxRefImages > 0 && (
        <div className="fc-hint">
          Accepts up to {first.maxRefImages} reference image{first.maxRefImages > 1 ? "s" : ""} —
          wire Image or Model nodes into the left handle.
        </div>
      )}

      <div className="fc-props-footer">
        <button className="fc-run-btn" onClick={() => onRun(models)} disabled={running}>
          {running ? "Running…" : many ? `→ Run ${models.length} models` : "→ Run selected"}
        </button>
      </div>
    </aside>
  );
}
