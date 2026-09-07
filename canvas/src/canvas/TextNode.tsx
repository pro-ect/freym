import { useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { patchNodeData, type TextNodeData } from "../types";

const SIZES = [14, 18, 24, 32, 44, 60, 80];

/**
 * A free text block — a label you drop anywhere on the board ("this week",
 * "client A", …). No wires, nothing runs it. Click to select and drag,
 * double-click to edit; the size chip on a selected block steps the font.
 */
export default function TextNode({ id, data, selected }: NodeProps) {
  const d = data as TextNodeData;
  const size = d.fontSize ?? 24;
  const [editing, setEditing] = useState(!d.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      taRef.current?.focus();
      taRef.current?.select();
    }
  }, [editing]);

  const step = (dir: 1 | -1) => {
    const i = SIZES.findIndex((s) => s >= size);
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i === -1 ? SIZES.length - 1 : i) + dir))];
    patchNodeData(id, { fontSize: next });
  };

  return (
    <div
      className={`fc-node fc-text ${selected ? "selected" : ""}${editing ? " editing" : ""}`}
      style={{ fontSize: size }}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer isVisible={!!selected} minWidth={80} minHeight={40} />
      {selected && !editing && (
        <div className="fc-text-size nodrag">
          <button onClick={() => step(-1)} title="Smaller text" disabled={size <= SIZES[0]}>A−</button>
          <span>{size}</span>
          <button onClick={() => step(1)} title="Bigger text" disabled={size >= SIZES[SIZES.length - 1]}>A+</button>
        </div>
      )}
      {editing ? (
        <textarea
          ref={taRef}
          className="nodrag nowheel"
          value={d.text}
          placeholder="type here…"
          onChange={(e) => patchNodeData(id, { text: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : (
        <div className="fc-text-body">{d.text || <span className="fc-text-empty">double-click to edit</span>}</div>
      )}
    </div>
  );
}
