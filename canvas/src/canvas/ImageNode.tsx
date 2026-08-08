import { useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { patchNodeData, type ImageNodeData } from "../types";
import { uploadInputImage } from "../lib/upload";

export default function ImageNode({ id, data, selected }: NodeProps) {
  const d = data as ImageNodeData;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    patchNodeData(id, { uploading: true, fileName: file.name });
    try {
      const url = await uploadInputImage(file);
      patchNodeData(id, { url, uploading: false });
    } catch (e) {
      console.error("upload failed", e);
      patchNodeData(id, { uploading: false });
    }
  };

  return (
    <div
      className={`fc-node fc-image ${selected ? "selected" : ""} ${dragOver ? "dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/")) void handleFile(file);
      }}
    >
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: "#ec4899" }} />
        Image
      </div>
      {d.url ? (
        <img src={d.url} alt={d.fileName ?? "input"} className="fc-image-preview" draggable={false} />
      ) : (
        <button className="fc-image-drop nodrag" onClick={() => inputRef.current?.click()}>
          {d.uploading ? "Uploading…" : "Click or drop an image"}
        </button>
      )}
      {d.url && (
        <button className="fc-mini-btn nodrag" onClick={() => inputRef.current?.click()}>
          Replace
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Handle type="source" position={Position.Right} id="out" className="fc-handle fc-handle-image" />
    </div>
  );
}
