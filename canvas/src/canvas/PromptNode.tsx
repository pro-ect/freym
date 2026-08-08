import { Handle, Position, type NodeProps } from "@xyflow/react";
import { patchNodeData, type PromptNodeData } from "../types";

export default function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as PromptNodeData;
  return (
    <div className={`fc-node fc-prompt ${selected ? "selected" : ""}`}>
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#10b981" }} />
        Prompt
      </div>
      <textarea
        className="nodrag"
        value={d.text}
        placeholder="Describe what to generate…"
        onChange={(e) => patchNodeData(id, { text: e.target.value })}
      />
      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle type="source" position={Position.Right} id="out" className="fc-handle fc-handle-prompt" />
    </div>
  );
}
