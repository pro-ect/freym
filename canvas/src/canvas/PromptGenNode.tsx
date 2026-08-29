import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { patchNodeData, type PromptGenNodeData } from "../types";

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Fired at the canvas, which owns the nodes/edges the run has to read and write. */
export function requestPromptGen(id: string) {
  window.dispatchEvent(new CustomEvent("promptgen-run", { detail: { id } }));
}

export default function PromptGenNode({ id, data, selected }: NodeProps) {
  const d = data as PromptGenNodeData;
  const running = d.status === "running";

  return (
    <div className={`fc-node fc-promptgen ${selected ? "selected" : ""} status-${d.status}`}>
      <NodeResizer isVisible={!!selected} minWidth={230} minHeight={230} />
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#f59e0b" }} />
        Prompt generator
      </div>

      <textarea
        className="nodrag"
        value={d.brief}
        placeholder="make me a prompt of 3d forms with film effects…"
        onChange={(e) => patchNodeData(id, { brief: e.target.value })}
      />

      <label className="fc-pg-count nodrag">
        <span>Number of prompts</span>
        <select
          value={d.count ?? 4}
          onChange={(e) => patchNodeData(id, { count: Number(e.target.value) })}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {d.status === "error" && <div className="fc-error fc-pg-error">{d.errorMessage}</div>}

      <button className="fc-run-btn nodrag" onClick={() => requestPromptGen(id)} disabled={running}>
        {running ? "Writing prompts…" : "✦ Generate prompts"}
      </button>

      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="fc-handle fc-handle-promptgen"
      />
    </div>
  );
}
