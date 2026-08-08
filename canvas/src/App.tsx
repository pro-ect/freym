import { useEffect, useState } from "react";
import { getSession, signInWithPassphrase } from "./lib/auth";
import ProjectsScreen from "./ProjectsScreen";
import CanvasScreen from "./canvas/CanvasScreen";

type Stage = "checking" | "gate" | "ready";

function readProjectFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("project");
}

export default function App() {
  const [stage, setStage] = useState<Stage>("checking");
  const [projectId, setProjectId] = useState<string | null>(readProjectFromUrl());
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then((s) => setStage(s ? "ready" : "gate"));
    const onPop = () => setProjectId(readProjectFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = (id: string | null) => {
    const url = id ? `?project=${id}` : window.location.pathname;
    history.pushState({}, "", url);
    setProjectId(id);
  };

  if (stage === "checking") return <div className="fc-gate fc-muted">…</div>;

  if (stage === "gate")
    return (
      <div className="fc-gate">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!pass.trim() || busy) return;
            setBusy(true);
            setErr(null);
            const { error } = await signInWithPassphrase(pass);
            setBusy(false);
            if (error) setErr(error);
            else setStage("ready");
          }}
        >
          <h1>freym canvas</h1>
          <input
            type="password"
            placeholder="access key"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
          />
          <button className="fc-primary" disabled={busy}>
            {busy ? "…" : "Enter"}
          </button>
          {err && <div className="fc-error">{err}</div>}
        </form>
      </div>
    );

  return projectId ? (
    <CanvasScreen projectId={projectId} onBack={() => open(null)} />
  ) : (
    <ProjectsScreen onOpen={open} />
  );
}
