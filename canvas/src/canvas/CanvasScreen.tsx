import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { v4 as uuid } from "uuid";
import PromptNode from "./PromptNode";
import ImageNode from "./ImageNode";
import ModelNode, { runModelNode } from "./ModelNode";
import CurvedEdge from "./CurvedEdge";
import ModelSidebar from "./ModelSidebar";
import PropertiesPanel from "./PropertiesPanel";
import { loadProject, saveProject, renameProject } from "../lib/projects";
import { resumeJobs } from "../lib/runner";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabase";
import type { CloudModel, ModelNodeData } from "../types";

const nodeTypes = { prompt: PromptNode, image: ImageNode, model: ModelNode };
const edgeTypes = { default: CurvedEdge };

function modelToNode(m: CloudModel, position: { x: number; y: number }): Node {
  return {
    id: uuid(),
    type: "model",
    position,
    data: {
      slug: m.slug,
      modelName: m.name,
      provider: m.provider,
      costCoins: m.coin_cost,
      supportsPrompt: m.supports_prompt !== false,
      maxRefImages: m.reference_images_max ?? 0,
      imageParamName: m.image_parameter_name,
      status: "idle",
      images: [],
      params: {},
    } satisfies ModelNodeData,
  };
}

function Canvas({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("…");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const { screenToFlowPosition, getEdges, getNode } = useReactFlow();
  const saveTimer = useRef<number | null>(null);
  const modelsRef = useRef<Map<string, CloudModel>>(new Map());
  // Latest state for the synchronous pagehide flush.
  const flushRef = useRef<{ nodes: Node[]; edges: Edge[]; dirty: boolean; token: string }>({
    nodes: [],
    edges: [],
    dirty: false,
    token: "",
  });
  const vpKey = `freym_canvas_vp_${projectId}`;
  const savedVp = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(vpKey) || "null");
    } catch {
      return null;
    }
  }, [vpKey]);

  // Load once.
  useEffect(() => {
    loadProject(projectId).then((p) => {
      if (!p) return onBack();
      setName(p.name);
      // Runs that were in flight when the tab closed: resume watching those
      // with a job id (the job kept running server-side), un-stick the rest.
      const inFlight: { jobId: string; nodeId: string }[] = [];
      const restored = (p.nodes as Node[]).map((n) => {
        if (n.type !== "model") return n;
        const d = n.data as ModelNodeData;
        if (d.status !== "running") return n;
        if (d.jobId) {
          inFlight.push({ jobId: d.jobId, nodeId: n.id });
          return n;
        }
        return { ...n, data: { ...d, status: "idle" } };
      });
      setNodes(restored);
      setEdges(p.edges as Edge[]);
      setLoaded(true);
      if (inFlight.length) void resumeJobs(inFlight);
    });
  }, [projectId]);

  // Flush unsaved changes when the tab is closed/reloaded/backgrounded —
  // the 1.2s debounce would otherwise drop the last edits.
  useEffect(() => {
    flushRef.current.nodes = nodes;
    flushRef.current.edges = edges;
  }, [nodes, edges]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      flushRef.current.token = data.session?.access_token ?? "";
    });
    const flush = () => {
      const f = flushRef.current;
      if (!f.dirty || !f.token) return;
      f.dirty = false;
      void fetch(`${SUPABASE_URL}/rest/v1/canvas_projects?id=eq.${projectId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${f.token}`,
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          nodes: f.nodes,
          edges: f.edges,
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [projectId]);

  // nigma-style child→parent patches.
  useEffect(() => {
    const onPatch = (e: Event) => {
      const { id, data } = (e as CustomEvent).detail;
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)));
    };
    window.addEventListener("node-data-update", onPatch);
    return () => window.removeEventListener("node-data-update", onPatch);
  }, [setNodes]);

  // Debounced autosave.
  useEffect(() => {
    if (!loaded) return;
    setSaveState("dirty");
    flushRef.current.dirty = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState("saving");
      await saveProject(projectId, nodes, edges);
      flushRef.current.dirty = false;
      const { data } = await supabase.auth.getSession();
      flushRef.current.token = data.session?.access_token ?? flushRef.current.token;
      setSaveState("saved");
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, loaded, projectId]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, type: "default" }, es)),
    [setEdges],
  );

  const centerPos = useCallback(
    () =>
      screenToFlowPosition({
        x: window.innerWidth / 2 + (Math.random() * 80 - 40),
        y: window.innerHeight / 2 + (Math.random() * 80 - 40),
      }),
    [screenToFlowPosition],
  );

  const addPrompt = () =>
    setNodes((ns) => [
      ...ns,
      { id: uuid(), type: "prompt", position: centerPos(), data: { text: "" } },
    ]);
  const addImage = () =>
    setNodes((ns) => [
      ...ns,
      { id: uuid(), type: "image", position: centerPos(), data: { url: null } },
    ]);
  const addModel = useCallback(
    (m: CloudModel, position?: { x: number; y: number }) => {
      modelsRef.current.set(m.slug, m);
      setNodes((ns) => [...ns, modelToNode(m, position ?? centerPos())]);
    },
    [centerPos, setNodes],
  );

  const selectedNode = useMemo(() => nodes.find((n) => n.selected) ?? null, [nodes]);

  return (
    <div className="fc-root">
      <header className="fc-topbar">
        <button className="fc-back" onClick={onBack}>
          ←
        </button>
        <input
          className="fc-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => renameProject(projectId, name.trim() || "untitled")}
        />
        <span className={`fc-save-state ${saveState}`}>
          {saveState === "saved" ? "saved" : saveState === "saving" ? "saving…" : "…"}
        </span>
      </header>

      <ModelSidebar onAdd={(m) => addModel(m)} />

      <div
        className="fc-flow"
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes("application/freym-model") ||
            e.dataTransfer.types.includes("Files")
          )
            e.preventDefault();
        }}
        onDrop={async (e) => {
          const slug = e.dataTransfer.getData("application/freym-model");
          const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (!slug && !files.length) return;
          e.preventDefault();
          const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          if (slug) {
            const { fetchModels } = await import("../lib/models");
            const m = (await fetchModels()).find((x) => x.slug === slug);
            if (m) addModel(m, pos);
            return;
          }
          // Image files dropped from the OS: one Image node per file, uploading in place.
          const { uploadInputImage } = await import("../lib/upload");
          files.forEach((file, i) => {
            const nodeId = uuid();
            setNodes((ns) => [
              ...ns,
              {
                id: nodeId,
                type: "image",
                position: { x: pos.x + i * 260, y: pos.y },
                data: { url: null, uploading: true, fileName: file.name },
              },
            ]);
            uploadInputImage(file)
              .then((url) =>
                window.dispatchEvent(
                  new CustomEvent("node-data-update", {
                    detail: { id: nodeId, data: { url, uploading: false } },
                  }),
                ),
              )
              .catch((err) => {
                console.error("canvas drop upload failed", err);
                window.dispatchEvent(
                  new CustomEvent("node-data-update", {
                    detail: { id: nodeId, data: { uploading: false } },
                  }),
                );
              });
          });
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView={!savedVp}
          defaultViewport={savedVp ?? undefined}
          onMoveEnd={(_e, vp) => localStorage.setItem(vpKey, JSON.stringify(vp))}
          minZoom={0.1}
          maxZoom={2}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomOnPinch
          multiSelectionKeyCode="Meta"
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#26262c" />
          <Controls showInteractive={false} />
        </ReactFlow>

        <div className="fc-toolbar">
          <button onClick={addPrompt}>+ Prompt</button>
          <button onClick={addImage}>+ Image</button>
        </div>
      </div>

      <PropertiesPanel
        node={selectedNode}
        onRun={() => {
          if (selectedNode?.type === "model")
            void runModelNode(
              selectedNode.id,
              selectedNode.data as unknown as ModelNodeData,
              getEdges,
              getNode,
            );
        }}
      />
    </div>
  );
}

export default function CanvasScreen(props: { projectId: string; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
