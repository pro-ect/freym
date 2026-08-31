import { useEffect, useState } from "react";
import { listProjects, createProject, deleteProject } from "./lib/projects";
import { getSession, signOut } from "./lib/auth";
import BalancePill from "./BalancePill";
import FounderMessage from "./FounderMessage";
import type { ProjectRow } from "./types";

/** Guest accounts sign in through the access-key door; their synthetic
 *  deviceId@guest.local address means nothing to the user. */
function accountLabel(email: string | null | undefined): string {
  if (!email) return "account";
  return email.endsWith("@guest.local") ? "access-key account" : email;
}

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
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Two-step delete: first ✕ arms the card, the second click deletes. No
  // window.confirm — browsers can suppress it, which made delete look broken.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    void refresh();
    getSession().then((s) => setEmail(s?.user.email ?? null));
    const close = () => {
      setMenuOpen(false);
      setArmedId(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const create = async () => {
    const p = await createProject("untitled");
    onOpen(p.id);
  };

  return (
    <div className="fc-projects">
      <header className="fc-projects-head">
        <h1>freym canvas</h1>
        <FounderMessage />
        <BalancePill />
        <div className="fc-account">
          <button
            className="fc-signout"
            title={email ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {accountLabel(email)}
          </button>
          <div className={`fc-account-menu${menuOpen ? " open" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="fc-account-email">{email ?? "signed in"}</div>
            <button
              className="fc-account-out"
              onClick={async () => {
                await signOut();
                window.location.assign(window.location.pathname);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        <button className="fc-primary" onClick={create}>
          + New project
        </button>
      </header>

      {deleteError && <div className="fc-error">could not delete: {deleteError}</div>}
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
                className={`fc-project-delete${armedId === p.id ? " armed" : ""}`}
                title="Delete project"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (armedId !== p.id) {
                    setArmedId(p.id);
                    setDeleteError(null);
                    return;
                  }
                  setArmedId(null);
                  // Optimistic: drop the card now, restore on failure.
                  setProjects((ps) => (ps ?? []).filter((x) => x.id !== p.id));
                  try {
                    await deleteProject(p.id);
                  } catch (err) {
                    setDeleteError(String((err as Error).message ?? err));
                    void refresh();
                  }
                }}
              >
                {armedId === p.id ? "delete?" : "✕"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
