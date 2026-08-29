import { useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { patchNodeData, type ImageNodeData } from "../types";
import { uploadInputMedia } from "../lib/upload";

/**
 * Video and Audio input nodes — reference clips for models whose
 * reference-to-video endpoints take them (Seedance, MiniMax, Wan).
 * Same upload-in-place flow as the Image node.
 */
function MediaNode({ kind, id, data, selected }: NodeProps & { kind: "video" | "audio" }) {
  const d = data as ImageNodeData;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const accept = kind === "video" ? "video/*" : "audio/*";
  const dot = kind === "video" ? "#38bdf8" : "#a3e635";
  const label = kind === "video" ? "Video" : "Audio";

  const handleFile = async (file: File) => {
    patchNodeData(id, { uploading: true, fileName: file.name });
    try {
      const url = await uploadInputMedia(file);
      patchNodeData(id, { url, uploading: false });
    } catch (e) {
      console.error("media upload failed", e);
      patchNodeData(id, { uploading: false });
    }
  };

  return (
    <div
      className={`fc-node fc-image fc-media ${selected ? "selected" : ""} ${dragOver ? "dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.type.startsWith(`${kind}/`)) void handleFile(file);
      }}
    >
      <div className="fc-node-header">
        <span className="fc-dot" style={{ background: dot }} />
        {label}
      </div>
      {d.url ? (
        kind === "video" ? (
          <video src={d.url} controls muted playsInline className="fc-image-preview" />
        ) : (
          <audio src={d.url} controls className="fc-audio-preview" />
        )
      ) : (
        <button className="fc-image-drop nodrag" onClick={() => inputRef.current?.click()}>
          {d.uploading ? "Uploading…" : `Click or drop ${kind === "video" ? "a video" : "an audio file"}`}
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
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Handle type="target" position={Position.Left} id="in" className="fc-handle fc-handle-in" />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className={`fc-handle fc-handle-${kind}`}
      />
    </div>
  );
}

export function VideoNode(props: NodeProps) {
  return <MediaNode kind="video" {...props} />;
}
export function AudioNode(props: NodeProps) {
  return <MediaNode kind="audio" {...props} />;
}
