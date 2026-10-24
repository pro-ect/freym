import { useEffect, useState } from "react";
import { fetchModels, groupModels } from "../lib/models";
import { isHiddenVariant } from "../lib/modelPairs";
import { loadFavorites, onFavoritesChange, toggleFavorite } from "../lib/favorites";
import type { CloudModel } from "../types";

export default function ModelSidebar({
  onAdd,
  onClose,
}: {
  onAdd: (m: CloudModel) => void;
  onClose?: () => void;
}) {
  const [models, setModels] = useState<CloudModel[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [favs, setFavs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setErr(String(e.message ?? e)));
    const refresh = () => void loadFavorites().then((f) => setFavs(new Set(f))).catch(() => {});
    refresh();
    return onFavoritesChange(refresh);
  }, []);

  // Edit variants ride inside their base card (the run routes by wired inputs).
  const visible = models.filter((m) => !isHiddenVariant(m.slug));
  const filtered = q
    ? visible.filter((m) => (m.name + " " + m.slug).toLowerCase().includes(q.toLowerCase()))
    : visible;
  const { text, audio, image, video, tools } = groupModels(filtered);
  const favorites = filtered.filter((m) => favs.has(m.slug) && m.category !== "text");

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
              {m.category !== "text" && (
                <span
                  role="button"
                  tabIndex={0}
                  className={`fc-fav${favs.has(m.slug) ? " on" : ""}`}
                  title={favs.has(m.slug) ? "Remove from favorites" : "Add to favorites"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFavorite(m.slug).catch(() => {});
                  }}
                >
                  {favs.has(m.slug) ? "★" : "☆"}
                </span>
              )}
            </button>
          ))}
        </div>
      </>
    );

  return (
    <aside className="fc-sidebar">
      <div className="fc-side-title">
        Models
        {onClose && (
          <button className="fc-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <input
        className="fc-search"
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {err && <div className="fc-error">{err}</div>}
      {section("Favorites", favorites)}
      {section("Prompt writers", text)}
      {section("Image models", image)}
      {section("Video models", video)}
      {section("Music", audio)}
      {section("Tools", tools)}
    </aside>
  );
}
