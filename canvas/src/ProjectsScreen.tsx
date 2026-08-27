import { useEffect, useState } from "react";
import { listProjects, createProject, deleteProject } from "./lib/projects";
import { signOut } from "./lib/auth";
import BalancePill from "./BalancePill";
import type { ProjectRow } from "./types";

const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|$)/i.test(u);

/**
 * Card preview from the board itself: the newest model result wins, then any
 * uploaded reference image. Boards with no imagery keep the node glyph.
 */
function previewOf(nodes: unknown[]): string | null {
  const list = (nodes ?? []) as { type?: string; data?: { images?: string[]; url?: string | null } }[];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.type === "model" && n.data?.images?.length) return n.data.images[0];
  }
  for (const n of list) {
    if (n.type === "image" && n.data?.url) return n.data.url;
  }
  return null;
}

export default function ProjectsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);

  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const p = await createProject("untitled");
    onOpen(p.id);
  };

  return (
    <div className="fc-projects">
      <header className="fc-projects-head">
        <h1>freym canvas</h1>
        <BalancePill />
        <button
          className="fc-signout"
          onClick={async () => {
            await signOut();
            window.location.assign(window.location.pathname);
          }}
        >
          Sign out
        </button>
        <button className="fc-primary" onClick={create}>
          + New project
        </button>
      </header>

      {!projects && <div className="fc-muted">loading…</div>}
      {projects?.length === 0 && (
        <div className="fc-muted">No projects yet — create your first one.</div>
      )}

      <div className="fc-project-grid">
        {projects?.map((p) => {
          const preview = previewOf(p.nodes as unknown[]);
          return (
            <div key={p.id} className="fc-project-card" onClick={() => onOpen(p.id)}>
              <div className="fc-project-thumb">
                {preview ? (
                  isVideoUrl(preview) ? (
                    <video src={preview} muted loop playsInline preload="metadata" autoPlay />
                  ) : (
                    <img
                      src={preview}
                      loading="lazy"
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )
                ) : (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="9" width="6" height="6" rx="1.5" stroke="#55555e" strokeWidth="1.5" />
                    <rect x="16" y="3" width="6" height="6" rx="1.5" stroke="#55555e" strokeWidth="1.5" />
                    <rect x="16" y="15" width="6" height="6" rx="1.5" stroke="#55555e" strokeWidth="1.5" />
                    <path d="M8 12h4m0 0V6h4m-4 6v6h4" stroke="#55555e" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <div className="fc-project-meta">
                <span className="fc-project-name">{p.name}</span>
                <span className="fc-project-date">
                  {new Date(p.updated_at).toLocaleDateString()} ·{" "}
                  {(p.nodes as unknown[])?.length ?? 0} nodes
                </span>
              </div>
              <button
                className="fc-project-delete"
                title="Delete project"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete "${p.name}"?`)) {
                    await deleteProject(p.id);
                    void refresh();
                  }
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
