import { useEffect, useState } from "react";
import { fetchModels, groupModels } from "../lib/models";
import { isHiddenEditVariant } from "../lib/modelPairs";
import type { CloudModel } from "../types";

export default function ModelSidebar({ onAdd }: { onAdd: (m: CloudModel) => void }) {
  const [models, setModels] = useState<CloudModel[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  // Edit variants ride inside their base card (the run routes by wired inputs).
  const visible = models.filter((m) => !isHiddenEditVariant(m.slug));
  const filtered = q
    ? visible.filter((m) => (m.name + " " + m.slug).toLowerCase().includes(q.toLowerCase()))
    : visible;
  const { textToImage, imageToImage, textToVideo, imageToVideo } = groupModels(filtered);

  const section = (title: string, list: CloudModel[]) =>
    list.length > 0 && (
      <>
        <div className="fc-side-section">{title}</div>
        <div className="fc-model-grid">
          {list.map((m) => (
            <button
              key={m.slug}
              className="fc-model-card"
              title={m.description ?? m.slug}
              onClick={() => onAdd(m)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/freym-model", m.slug);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              {m.icon_url ? <img src={m.icon_url} alt="" /> : <div className="fc-model-card-fallback" />}
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      </>
    );

  return (
    <aside className="fc-sidebar">
      <div className="fc-side-title">Models</div>
      <input
        className="fc-search"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {err && <div className="fc-error">{err}</div>}
      {section("Generate from text", textToImage)}
      {section("Edit with images", imageToImage)}
      {section("Video from text", textToVideo)}
      {section("Video from images", imageToVideo)}
    </aside>
  );
}
