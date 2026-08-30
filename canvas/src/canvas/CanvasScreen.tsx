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
  type OnConnectStart,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { v4 as uuid } from "uuid";
import PromptNode from "./PromptNode";
import PromptGenNode from "./PromptGenNode";
import ImageNode from "./ImageNode";
import { VideoNode, AudioNode } from "./MediaNode";
import ModelNode, { runModelNode } from "./ModelNode";
import BalancePill from "../BalancePill";
import CurvedEdge from "./CurvedEdge";
import ModelSidebar from "./ModelSidebar";
import PropertiesPanel from "./PropertiesPanel";
import { loadProject, saveProject, renameProject, ensureShareToken } from "../lib/projects";
import { resumeJobs } from "../lib/runner";
import { generatePrompts } from "../lib/promptgen";
import { fetchModels } from "../lib/models";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabase";
import { ROUTES, refCapacity } from "../lib/modelPairs";
import { orderedRefs } from "../lib/refOrder";
import { patchNodeData } from "../types";
import type { CloudModel, ModelNodeData, PromptGenNodeData, PromptNodeData } from "../types";

const nodeTypes = { prompt: PromptNode, promptgen: PromptGenNode, image: ImageNode, video: VideoNode, audio: AudioNode, model: ModelNode };
const edgeTypes = { default: CurvedEdge };

/** Seed a new model node with the schema's own defaults so runs match the app. */
function defaultsFor(schema: CloudModel["param_schema"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    if (field?.default !== undefined) out[key] = field.default;
  }
  return out;
}

function modelToNode(m: CloudModel, position: { x: number; y: number }): Node {
  return {
    id: uuid(),
    type: "model",
    position,
    data: {
      slug: m.slug,
      modelName: m.name,
      category: m.category,
      provider: m.provider,
      costCoins: m.coin_cost,
      perSecondCents: m.price_per_second_cents != null ? Number(m.price_per_second_cents) : null,
      rateTable: m.rate_table ?? null,
      supportsPrompt: m.supports_prompt !== false,
      // Dual-mode image models accept the edit variant's reference count.
      maxRefImages: refCapacity(m.slug, m.reference_images_max ?? 0),
      imageParamName: m.image_parameter_name,
      status: "idle",
      images: [],
      params: { custom: defaultsFor(m.param_schema) },
      paramSchema: m.param_schema ?? null,
    } satisfies ModelNodeData,
  };
}

function Canvas({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("…");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [shareState, setShareState] = useState<"idle" | "busy" | "copied">("idle");
  const { screenToFlowPosition, getEdges, getNode, getNodes } = useReactFlow();
  const clipboardRef = useRef<Node[]>([]);
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

  // ⌘C/⌘V node copy-paste (nigma-style).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const isTextField =
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement;
      if (!isCtrl || isTextField) return;

      if (e.key === "c") {
        clipboardRef.current = getNodes().filter((n) => n.selected);
      }
      if (e.key === "v") {
        const toPaste = clipboardRef.current;
        if (!toPaste.length) return;
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...toPaste.map((n) => {
            // Model nodes: never paste in-flight run state.
            const data =
              n.type === "model"
                ? { ...n.data, status: "idle", jobId: undefined, errorMessage: undefined }
                : { ...n.data };
            return {
              ...n,
              id: uuid(),
              position: { x: n.position.x + 40, y: n.position.y + 40 },
              selected: true,
              data,
            };
          }),
        ]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [getNodes, setNodes]);

  // Refresh every model node's controls from the catalog when a project opens:
  // nodes saved before param_schema support have none at all, and older ones
  // predate whatever the catalog offers today. Values the user already chose
  // are kept — only the schema and any new defaults are filled in.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void (async () => {
      const modelNodes = getNodes().filter((n) => n.type === "model");
      if (!modelNodes.length) return;
      const models = await fetchModels().catch(() => [] as CloudModel[]);
      if (cancelled || !models.length) return;
      const bySlug = new Map(models.map((m) => [m.slug, m]));
      for (const n of modelNodes) {
        const d = n.data as unknown as ModelNodeData;
        const m = bySlug.get(d.slug);
        if (!m) continue;
        patchNodeData(n.id, {
          category: m.category,
          paramSchema: m.param_schema ?? null,
          maxRefImages: refCapacity(d.slug, m.reference_images_max ?? 0),
          costCoins: m.coin_cost,
          perSecondCents: m.price_per_second_cents != null ? Number(m.price_per_second_cents) : null,
          rateTable: m.rate_table ?? null,
          params: { ...d.params, custom: { ...defaultsFor(m.param_schema), ...d.params?.custom } },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, getNodes]);

  // Prompt generator: one brief → N prompt nodes wired to the generator.
  // Re-running rewrites the nodes it already owns (so downstream model wiring
  // survives) and adds or drops nodes to match the requested count.
  const runPromptGen = useCallback(
    async (id: string) => {
      const node = getNode(id);
      if (!node) return;
      const d = node.data as PromptGenNodeData;
      const brief = (d.brief ?? "").trim();
      if (!brief) {
        patchNodeData(id, { status: "error", errorMessage: "describe what you want first" });
        return;
      }
      const count = Math.min(10, Math.max(1, d.count ?? 4));

      // Prompt nodes wired into the generator act as style reference.
      const context = getEdges()
        .filter((e) => e.target === id)
        .map((e) => getNode(e.source))
        .filter((n) => n?.type === "prompt")
        .map((n) => (n!.data as PromptNodeData).text?.trim())
        .filter(Boolean) as string[];

      patchNodeData(id, { status: "running", errorMessage: undefined });
      try {
        const prompts = await generatePrompts({ brief, count, context });

        const owned = (d.generatedIds ?? []).filter((gid) => getNode(gid));
        const reused = owned.slice(0, prompts.length);
        const dropped = new Set(owned.slice(prompts.length));

        const created: Node[] = [];
        const ids: string[] = [];
        prompts.forEach((text, i) => {
          if (i < reused.length) {
            ids.push(reused[i]);
            return;
          }
          const nid = uuid();
          ids.push(nid);
          created.push({
            id: nid,
            type: "prompt",
            position: {
              x: node.position.x + 340,
              y: node.position.y + (i - (prompts.length - 1) / 2) * 180,
            },
            data: { text },
          });
        });

        setNodes((ns) => [
          ...ns
            .filter((n) => !dropped.has(n.id))
            .map((n) => {
              const idx = reused.indexOf(n.id);
              return idx === -1 ? n : { ...n, data: { ...n.data, text: prompts[idx] } };
            }),
          ...created,
        ]);
        setEdges((es) => [
          ...es.filter((e) => !dropped.has(e.source) && !dropped.has(e.target)),
          ...created.map((n) => ({
            id: `e-${id}-${n.id}`,
            source: id,
            sourceHandle: "out",
            target: n.id,
            targetHandle: "in",
            type: "default",
          })),
        ]);
        patchNodeData(id, { status: "done", generatedIds: ids });
      } catch (e) {
        patchNodeData(id, { status: "error", errorMessage: String((e as Error).message ?? e) });
      }
    },
    [getNode, getEdges, setNodes, setEdges],
  );

  useEffect(() => {
    const onRun = (e: Event) => void runPromptGen((e as CustomEvent).detail.id);
    window.addEventListener("promptgen-run", onRun);
    return () => window.removeEventListener("promptgen-run", onRun);
  }, [runPromptGen]);

  // Drag-to-create (nigma-style): drop a connection on empty canvas and the
  // complementary node is spawned already wired up.
  const connectingFrom = useRef<{ nodeId: string; nodeType: string; handleId: string | null } | null>(null);

  const onConnectStart: OnConnectStart = useCallback(
    (_, { nodeId, handleId }) => {
      if (!nodeId) return;
      connectingFrom.current = { nodeId, nodeType: getNode(nodeId)?.type ?? "", handleId };
    },
    [getNode],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      const state = connectionState as { toNode?: unknown; isValid?: boolean | null };
      const from = connectingFrom.current;
      connectingFrom.current = null;
      if (!from || state.toNode || state.isValid === true) return;

      const e = event as MouseEvent;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newId = uuid();
      let newNode: Node | null = null;
      let newEdge: Edge | null = null;

      if (from.nodeType === "image" && from.handleId === "out") {
        // image dot → prompt node
        newNode = { id: newId, type: "prompt", position: { x: pos.x, y: pos.y - 30 }, data: { text: "" } };
        newEdge = { id: `e-${from.nodeId}-${newId}`, source: from.nodeId, sourceHandle: "out", target: newId, targetHandle: "in", type: "default" };
      } else if (from.nodeType === "prompt" && from.handleId === "out") {
        // prompt dot → image node
        newNode = { id: newId, type: "image", position: { x: pos.x, y: pos.y - 30 }, data: { url: null } };
        newEdge = { id: `e-${from.nodeId}-${newId}`, source: from.nodeId, sourceHandle: "out", target: newId, targetHandle: "in", type: "default" };
      } else if (from.nodeType === "model" && from.handleId === "in") {
        // pulling backwards out of a model input → prompt node feeding it
        newNode = { id: newId, type: "prompt", position: { x: pos.x - 220, y: pos.y - 30 }, data: { text: "" } };
        newEdge = { id: `e-${newId}-${from.nodeId}`, source: newId, sourceHandle: "out", target: from.nodeId, targetHandle: "in", type: "default" };
      } else if (from.nodeType === "model" && from.handleId === "out") {
        // model output → image node
        newNode = { id: newId, type: "image", position: { x: pos.x, y: pos.y - 30 }, data: { url: null } };
        newEdge = { id: `e-${from.nodeId}-${newId}`, source: from.nodeId, sourceHandle: "out", target: newId, targetHandle: "in", type: "default" };
      }

      if (newNode && newEdge) {
        const node = newNode, edge = newEdge;
        setNodes((nds) => [...nds, node]);
        setEdges((eds) => [...eds, edge]);
      }
    },
    [screenToFlowPosition, setNodes, setEdges],
  );

  const centerPos = useCallback(
    () =>
      screenToFlowPosition({
        x: window.innerWidth / 2 + (Math.random() * 80 - 40),
        y: window.innerHeight / 2 + (Math.random() * 80 - 40),
      }),
    [screenToFlowPosition],
  );

  // ⌘V / Ctrl+V with an image on the clipboard drops it onto the canvas as an
  // Image node, uploading in place — same flow as OS file drops.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter(Boolean) as File[];
      if (!files.length) return;
      e.preventDefault();
      void (async () => {
        const { uploadInputImage } = await import("../lib/upload");
        const pos = centerPos();
        files.forEach((file, i) => {
          const nodeId = uuid();
          setNodes((ns) => [
            ...ns,
            {
              id: nodeId,
              type: "image",
              position: { x: pos.x + i * 260, y: pos.y },
              data: { url: null, uploading: true, fileName: file.name || "pasted image" },
            },
          ]);
          uploadInputImage(file)
            .then((url) => patchNodeData(nodeId, { url, uploading: false }))
            .catch((err) => {
              console.error("canvas paste upload failed", err);
              patchNodeData(nodeId, { uploading: false });
            });
        });
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [centerPos, setNodes]);

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
  const addVideo = () =>
    setNodes((ns) => [
      ...ns,
      { id: uuid(), type: "video", position: centerPos(), data: { url: null } },
    ]);
  const addAudio = () =>
    setNodes((ns) => [
      ...ns,
      { id: uuid(), type: "audio", position: centerPos(), data: { url: null } },
    ]);
  const addPromptGen = () =>
    setNodes((ns) => [
      ...ns,
      {
        id: uuid(),
        type: "promptgen",
        position: centerPos(),
        data: { brief: "", count: 4, status: "idle", generatedIds: [] },
      },
    ]);

  /**
   * Adding a model with prompt/image nodes selected gives each selected node
   * its own model node, already wired — pick 10 prompts, click Krea, get 10
   * runnable pairs. Dropping onto a position stays a single node.
   */
  const addModel = useCallback(
    (m: CloudModel, position?: { x: number; y: number }) => {
      modelsRef.current.set(m.slug, m);
      const targets = position
        ? []
        : getNodes().filter((n) => n.selected && (n.type === "prompt" || n.type === "image"));

      if (!targets.length) {
        setNodes((ns) => [...ns, modelToNode(m, position ?? centerPos())]);
        return;
      }

      const created = targets.map((t) =>
        modelToNode(m, { x: t.position.x + 340, y: t.position.y }),
      );
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        ...created.map((n) => ({ ...n, selected: true })),
      ]);
      setEdges((es) => [
        ...es,
        ...targets.map((t, i) => ({
          id: `e-${t.id}-${created[i].id}`,
          source: t.id,
          sourceHandle: "out",
          target: created[i].id,
          targetHandle: "in",
          type: "default",
        })),
      ]);
    },
    [centerPos, getNodes, setNodes, setEdges],
  );

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  // Reference badges: when a model node has 2+ wired references, each wire
  // carries its number (1, 2… / V1 / A1) — the same order the prompt tags use
  // (top to bottom by node position, see refOrder.ts).
  const displayEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const badges = new Map<string, string>();
    for (const n of nodes) {
      if (n.type !== "model") continue;
      const d = n.data as unknown as ModelNodeData;
      const incoming = edges
        .filter((e) => e.target === n.id)
        .map((e) => ({ edgeId: e.id, src: byId.get(e.source) }))
        .filter((x): x is { edgeId: string; src: Node } => !!x.src);
      const refs = orderedRefs(incoming, !!ROUTES[d.slug]?.multi?.videoParam);
      if (refs.length < 2) continue;
      let img = 0, vid = 0, aud = 0;
      for (const r of refs) {
        badges.set(
          r.edgeId,
          r.kind === "image" ? String(++img) : r.kind === "video" ? `V${++vid}` : `A${++aud}`,
        );
      }
    }
    if (!badges.size) return edges;
    return edges.map((e) =>
      badges.has(e.id) ? { ...e, data: { ...e.data, refBadge: badges.get(e.id) } } : e,
    );
  }, [nodes, edges]);

  const runModels = useCallback(
    async (list: Node[]) => {
      // Parallel submits: every selected node flips to its running state at
      // click time instead of waiting for the previous submit's round trip.
      await Promise.all(
        list.map((n) => runModelNode(n.id, n.data as unknown as ModelNodeData, getEdges, getNode)),
      );
    },
    [getEdges, getNode],
  );

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
        <button
          className="fc-share"
          title="Copy a read-only link to this board"
          disabled={shareState === "busy"}
          onClick={async () => {
            setShareState("busy");
            try {
              const token = await ensureShareToken(projectId);
              await navigator.clipboard.writeText(
                `${window.location.origin}${window.location.pathname}?share=${token}`,
              );
              setShareState("copied");
              setTimeout(() => setShareState("idle"), 2200);
            } catch {
              setShareState("idle");
            }
          }}
        >
          {shareState === "copied" ? "link copied" : "share"}
        </button>
        <BalancePill />
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
          const files = Array.from(e.dataTransfer.files ?? []).filter(
            (f) =>
              f.type.startsWith("image/") ||
              f.type.startsWith("video/") ||
              f.type.startsWith("audio/"),
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
          // Media files dropped from the OS: one node per file, uploading in place.
          const { uploadInputImage, uploadInputMedia } = await import("../lib/upload");
          files.forEach((file, i) => {
            const nodeId = uuid();
            const type = file.type.startsWith("video/")
              ? "video"
              : file.type.startsWith("audio/")
                ? "audio"
                : "image";
            setNodes((ns) => [
              ...ns,
              {
                id: nodeId,
                type,
                position: { x: pos.x + i * 260, y: pos.y },
                data: { url: null, uploading: true, fileName: file.name },
              },
            ]);
            (type === "image" ? uploadInputImage(file) : uploadInputMedia(file))
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
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
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
          <button onClick={addPromptGen}>✦ Prompt generator</button>
          <button onClick={addImage}>+ Image</button>
          <button onClick={addVideo}>+ Video</button>
          <button onClick={addAudio}>+ Audio</button>
        </div>
      </div>

      <PropertiesPanel nodes={selectedNodes} onRun={(list) => void runModels(list)} />
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
