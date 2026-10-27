import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow, type Edge, type Node } from "@xyflow/react";
import { fetchModels } from "../lib/models";
import { isHiddenVariant } from "../lib/modelPairs";
import { loadFavorites } from "../lib/favorites";
import { estimateCoins } from "../lib/pricing";
import { usd } from "../lib/balance";
import { askAgent, type AgentTurn, type LoopContext } from "../lib/agent";
import {
  applyPlan,
  boardForAgent,
  catalogForAgent,
  chipForNode,
  handleMap,
  isDraft,
  nodeThumb,
  type ApplyResult,
  type Chip,
  type Plan,
} from "../lib/agentPlan";
import type { CloudModel, ModelNodeData } from "../types";

/**
 * Canvas chat. The message box takes inline chips — canvas nodes (dragged in
 * from the board, picked with "@", or the current selection) and models
 * (dragged from the sidebar or picked with "@"). Sending asks canvas-agent
 * for a plan, which lands on the board as a DRAFT; the review card shows the
 * cost and runs it only when the user says so.
 *
 * LOOP: a message with a budget ("10 character options, budget $3", or the
 * Loop switch) runs on its own — plan a round, run it, wait for the results,
 * let the agent look at them (vision), keep the good ones, plan fixes for
 * the rest, and repeat until the goal is met, the budget is spent or the
 * round cap is hit. The canvas enforces the budget: a round is trimmed to
 * what is left before it starts.
 */

const MAX_ROUNDS = 5;
/** Coins held back each round for the next review step. */
const REVIEW_RESERVE = 80;
const MAX_BUDGET_USD = 25;

type LoopState = {
  budgetCoins: number;
  spent: number;
  round: number;
  target?: number;
  status: "running" | "done" | "stopped" | "error";
  phase: string;
  /** Node ids of kept results. */
  picks: string[];
  log: string[];
};

/** "$3", "3$", "3 бакса", "3 dollars", "3 usd" → 3. */
function parseBudget(text: string): number | null {
  const m = text.match(/\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:\$|usd\b|бакс\p{L}*|доллар\p{L}*|dollars?\b|bucks?\b)/iu);
  if (!m) return null;
  const v = Number((m[1] ?? m[2]).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}
const LOOP_WORDS = /бюджет|budget|loop|итерац|iterat|в рамках|within/i;

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  chips?: Chip[];
  status?: "thinking" | "error";
  questions?: string[];
  warnings?: string[];
  /** Nodes this answer drafted (the review card works on these). */
  draftIds?: string[];
  /** Run / Keep / Discard already chosen for this draft. */
  settled?: "run" | "kept" | "discarded" | "replaced";
  summary?: string;
  /** A budgeted loop this message runs. */
  loop?: LoopState;
};

type Option = { chip: Chip; group: string; sub?: string };

const CHIP_ATTR = "data-chip";

function chipEl(chip: Chip): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `fc-chip fc-chip-${chip.kind}`;
  el.contentEditable = "false";
  el.setAttribute(CHIP_ATTR, JSON.stringify(chip));
  const pic = chip.kind === "node" ? chip.thumb : chip.icon;
  if (pic) {
    const img = document.createElement("img");
    img.src = pic;
    img.alt = "";
    el.appendChild(img);
  } else {
    const dot = document.createElement("i");
    el.appendChild(dot);
  }
  el.appendChild(document.createTextNode(chip.label));
  return el;
}

/** Text with chip tokens + the chips in order. */
function serialize(root: HTMLElement): { text: string; chips: Chip[] } {
  const chips: Chip[] = [];
  let text = "";
  const walk = (n: ChildNode) => {
    if (n.nodeType === 3 /* TEXT_NODE */) text += n.textContent ?? "";
    else if (n instanceof HTMLElement) {
      const raw = n.getAttribute(CHIP_ATTR);
      if (raw) {
        try {
          chips.push(JSON.parse(raw) as Chip);
          text += `\u0000${chips.length - 1}\u0000`;
        } catch { /* broken chip */ }
        return;
      }
      if (n.tagName === "BR") text += "\n";
      else {
        if (n.tagName === "DIV" && text && !text.endsWith("\n")) text += "\n";
        n.childNodes.forEach(walk);
      }
    }
  };
  root.childNodes.forEach(walk);
  return { text: text.replace(/ /g, " ").trim(), chips };
}

const storeKey = (projectId: string) => `freym_agent_${projectId}`;
function loadThread(projectId: string): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(projectId)) || "[]") as Msg[];
    return raw
      .filter((m) => m.status !== "thinking")
      .map((m) => (m.loop?.status === "running" ? { ...m, loop: { ...m.loop, status: "stopped", phase: "Stopped (the page was reloaded)" } } : m));
  } catch {
    return [];
  }
}

export default function AgentPanel({
  projectId,
  nodes,
  edges,
  makeModelNode,
  commit,
  runDraft,
  centerPos,
}: {
  projectId: string;
  nodes: Node[];
  edges: Edge[];
  makeModelNode: (m: CloudModel, pos: { x: number; y: number }) => Node;
  commit: (r: { nodes: Node[]; edges: Edge[] }) => void;
  runDraft: (ids: string[]) => void;
  centerPos: () => { x: number; y: number };
}) {
  const { setCenter, getNode, fitView } = useReactFlow();
  const editorRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [thread, setThread] = useState<Msg[]>(() => loadThread(projectId));
  const [open, setOpen] = useState(true);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const [models, setModels] = useState<CloudModel[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [at, setAt] = useState<{ query: string; index: number } | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [budgetUsd, setBudgetUsd] = useState("3");
  const loopStop = useRef(false);
  // The loop is async and long: it reads the live board through refs.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  useEffect(() => {
    fetchModels().then(setModels).catch(() => {});
    loadFavorites().then((f) => setFavs(new Set(f))).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(projectId), JSON.stringify(thread.slice(-40)));
    } catch { /* storage off */ }
    requestAnimationFrame(() => threadRef.current?.scrollTo({ top: 1e6 }));
  }, [thread, projectId]);

  // ---- caret + chip insertion ----
  const rememberCaret = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const insertChips = useCallback((chips: Chip[], range?: Range | null) => {
    const ed = editorRef.current;
    if (!ed || !chips.length) return;
    ed.focus();
    let r = range ?? savedRange.current;
    if (!r || !ed.contains(r.startContainer)) {
      r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
    }
    r.deleteContents();
    const frag = document.createDocumentFragment();
    let last: globalThis.Node | null = null;
    for (const c of chips) {
      frag.appendChild(chipEl(c));
      last = document.createTextNode(" ");
      frag.appendChild(last);
    }
    r.insertNode(frag);
    if (last) {
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRange.current = after.cloneRange();
    }
    setEmpty(false);
    setOpen(true);
  }, []);

  // Canvas nodes dropped on the box (CanvasScreen detects the drag) or the
  // "mention selection" shortcut.
  useEffect(() => {
    const onMention = (e: Event) => insertChips((e as CustomEvent).detail.chips as Chip[]);
    const onHover = (e: Event) => setDropHover(!!(e as CustomEvent).detail);
    window.addEventListener("fc-agent-mention", onMention);
    window.addEventListener("fc-agent-drop-hover", onHover);
    return () => {
      window.removeEventListener("fc-agent-mention", onMention);
      window.removeEventListener("fc-agent-drop-hover", onHover);
    };
  }, [insertChips]);

  // ---- @ menu ----
  const modelChip = (m: CloudModel): Chip => ({ kind: "model", slug: m.slug, label: m.name, icon: m.icon_url });
  const options: Option[] = useMemo(() => {
    if (!at) return [];
    const q = at.query.toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const boardOpts = nodes
      .filter((n) => n.type !== "text")
      .map((n) => ({ chip: chipForNode(n), group: "On the canvas", sub: n.type ?? "" }))
      .filter((o) => match(o.chip.label + " " + o.sub));
    const runnable = models.filter(
      (m) => (m.category === "image" || m.category === "video") && !isHiddenVariant(m.slug) && !(m.tags ?? []).includes("tool"),
    );
    const favOpts = runnable
      .filter((m) => favs.has(m.slug) && match(m.name + " " + m.slug))
      .map((m) => ({ chip: modelChip(m), group: "Favorites", sub: m.category }));
    const modelOpts = runnable
      .filter((m) => !favs.has(m.slug) && match(m.name + " " + m.slug))
      .map((m) => ({ chip: modelChip(m), group: m.category === "video" ? "Video models" : "Image models", sub: m.category }));
    const favAll: Option[] = favs.size && match("favorites")
      ? [{ chip: { kind: "model", slug: "@favorites", label: "My favorites" }, group: "Favorites", sub: `${favs.size} models` }]
      : [];
    return [...boardOpts.slice(0, 8), ...favAll, ...favOpts, ...modelOpts].slice(0, 30);
  }, [at, nodes, models, favs]);

  const detectAt = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== 3 /* TEXT_NODE */ || !editorRef.current?.contains(node)) return setAt(null);
    const before = (node.textContent ?? "").slice(0, sel.anchorOffset);
    const m = before.match(/(?:^|[\s ])@([^\s @]{0,30})$/);
    setAt(m ? { query: m[1], index: 0 } : null);
  };

  const pickOption = (o: Option) => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (sel && node && node.nodeType === 3 /* TEXT_NODE */ && at) {
      const end = sel.anchorOffset;
      const r = document.createRange();
      r.setStart(node, Math.max(0, end - at.query.length - 1));
      r.setEnd(node, end);
      insertChips([o.chip], r);
    } else insertChips([o.chip]);
    setAt(null);
  };

  // ---- sending ----
  const send = async () => {
    const ed = editorRef.current;
    if (!ed || busy) return;
    const { text, chips } = serialize(ed);
    if (!text.replace(/\u0000\d+\u0000/g, "").trim() && !chips.length) return;

    const { toHandle, toId } = handleMap(nodes);
    const mentions = chips.map((c, i) => {
      if (c.kind === "model") {
        return c.slug === "@favorites"
          ? { token: `@[${i + 1}]`, kind: "favorites", slugs: [...favs] }
          : { token: `@[${i + 1}]`, kind: "model", slug: c.slug, name: c.label };
      }
      return { token: `@[${i + 1}]`, kind: "node", handle: toHandle.get(c.nodeId) ?? "(deleted)", type: c.nodeType, label: c.label };
    });
    const message = text.replace(/\u0000(\d+)\u0000/g, (_, i) => `@[${Number(i) + 1}]`);
    const images = chips
      .filter((c): c is Extract<Chip, { kind: "node" }> => c.kind === "node")
      .map((c) => {
        const n = nodes.find((x) => x.id === c.nodeId);
        const url = n ? nodeThumb(n) : null;
        return url ? { handle: toHandle.get(c.nodeId)!, url } : null;
      })
      .filter((x): x is { handle: string; url: string } => !!x);

    const history: AgentTurn[] = thread
      .filter((m) => !m.status)
      .map((m) => ({
        role: m.role,
        text:
          m.role === "assistant"
            ? `${m.text}${m.summary ? ` [${m.summary}]` : ""}`
            : m.text.replace(/\u0000(\d+)\u0000/g, (_, i) => `[${m.chips?.[Number(i)]?.label ?? "mention"}]`),
      }));

    const plain = text.replace(/\u0000\d+\u0000/g, " ");
    const spoken = LOOP_WORDS.test(plain) ? parseBudget(plain) : null;
    if (loopOn || spoken != null) {
      const usdBudget = Math.min(MAX_BUDGET_USD, spoken ?? Number(budgetUsd.replace(",", ".")));
      if (!Number.isFinite(usdBudget) || usdBudget < 0.3) return;
      ed.innerHTML = "";
      setEmpty(true);
      void runLoop({ text, chips, message, mentions, budgetCoins: Math.round(usdBudget * 500) });
      return;
    }

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text, chips };
    const pending: Msg = { id: crypto.randomUUID(), role: "assistant", text: "Thinking…", status: "thinking" };
    setThread((t) => [...t, userMsg, pending]);
    ed.innerHTML = "";
    setEmpty(true);
    setBusy(true);
    setOpen(true);

    try {
      const catalogModels = models.length ? models : await fetchModels();
      const plan: Plan = await askAgent({
        message,
        mentions,
        images,
        board: boardForAgent(nodes, edges, toHandle),
        catalog: catalogForAgent(catalogModels, favs),
        history,
      });
      console.info("[agent] plan", JSON.stringify(plan));
      let result: ApplyResult | null = null;
      if (plan.ops?.length) {
        result = applyPlan(plan, {
          nodes,
          edges,
          models: catalogModels,
          toId,
          makeModelNode,
          fallbackPos: centerPos(),
        });
        commit(result);
        // Bring the new draft into view once React Flow has measured it.
        const ids = result.created;
        if (ids.length) setTimeout(() => void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, duration: 500, maxZoom: 1 }), 120);
      }
      const prevDraft = thread.flatMap((m) => (m.settled ? [] : m.draftIds ?? []));
      const draftIds = result
        ? [...new Set([...prevDraft, ...result.created])].filter((id) => result!.nodes.some((n) => n.id === id))
        : undefined;
      const parts: string[] = [];
      if (result?.created.length) parts.push(`added ${result.created.length} node${result.created.length === 1 ? "" : "s"}`);
      if (result?.changed) parts.push(`changed ${result.changed}`);
      if (result?.removed) parts.push(`removed ${result.removed}`);
      setThread((t) => [
        // A newer draft card replaces older unsettled ones.
        ...t.filter((m) => m.id !== pending.id).map((m) => (draftIds && m.draftIds && !m.settled ? { ...m, settled: "replaced" as const } : m)),
        {
          id: pending.id,
          role: "assistant",
          text: plan.reply || (parts.length ? "Done." : "I have nothing to change."),
          questions: plan.questions,
          warnings: result?.warnings,
          draftIds: draftIds?.length ? draftIds : undefined,
          summary: parts.join(", "),
        },
      ]);
    } catch (e) {
      setThread((t) => [
        ...t.filter((m) => m.id !== pending.id),
        { id: pending.id, role: "assistant", text: String((e as Error).message ?? e), status: "error" },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // ---- loop ----
  const runLoop = async (a: {
    text: string;
    chips: Chip[];
    message: string;
    mentions: unknown[];
    budgetCoins: number;
  }) => {
    const msgId = crypto.randomUUID();
    let st: LoopState = { budgetCoins: a.budgetCoins, spent: 0, round: 0, status: "running", phase: "Planning round 1…", picks: [], log: [] };
    const show = (patch: Partial<LoopState>, text?: string) => {
      st = { ...st, ...patch };
      const snap = st;
      setThread((t) => t.map((m) => (m.id === msgId ? { ...m, loop: snap, ...(text ? { text } : {}) } : m)));
    };
    setThread((t) => [
      ...t,
      { id: crypto.randomUUID(), role: "user", text: a.text, chips: a.chips },
      { id: msgId, role: "assistant", text: "Starting the loop…", loop: st },
    ]);
    loopStop.current = false;
    setBusy(true);
    setOpen(true);

    const refIds = a.chips.filter((c): c is Extract<Chip, { kind: "node" }> => c.kind === "node").map((c) => c.nodeId);
    const kept: string[] = [];
    let lastRound: string[] = [];
    const costOf = new Map<string, number>();

    const promptFor = (id: string) => {
      const p = edgesRef.current
        .filter((e) => e.target === id)
        .map((e) => nodesRef.current.find((n) => n.id === e.source))
        .find((n) => n?.type === "prompt");
      return p ? String((p.data as { text?: string }).text ?? "") : undefined;
    };

    try {
      const catalogModels = models.length ? models : await fetchModels();
      for (let round = 1; round <= MAX_ROUNDS + 1; round++) {
        if (loopStop.current) { show({ status: "stopped", phase: "Stopped" }); break; }
        const left = st.budgetCoins - st.spent;
        const cur = nodesRef.current;
        const { toHandle, toId } = handleMap(cur);
        const images = refIds
          .map((id) => cur.find((n) => n.id === id))
          .map((n) => (n ? { handle: toHandle.get(n.id)!, url: nodeThumb(n) } : null))
          .filter((x): x is { handle: string; url: string } => !!x?.url);
        const results = lastRound
          .map((id) => cur.find((n) => n.id === id))
          .filter((n): n is Node => !!n)
          .map((n) => {
            const d = n.data as unknown as ModelNodeData;
            return {
              handle: toHandle.get(n.id)!,
              url: d.status === "done" && d.category !== "video" && d.category !== "audio" ? d.images?.[0] ?? null : null,
              model: d.modelName,
              prompt: promptFor(n.id),
              status: d.status,
              ...(d.errorMessage ? { error: d.errorMessage } : {}),
            };
          });
        const loop: LoopContext = {
          round,
          max_rounds: MAX_ROUNDS,
          budget_coins: st.budgetCoins,
          left_coins: left,
          kept: kept
            .map((id) => cur.find((n) => n.id === id))
            .filter((n): n is Node => !!n)
            .map((n) => ({ handle: toHandle.get(n.id)!, model: (n.data as unknown as ModelNodeData).modelName, note: promptFor(n.id)?.slice(0, 160) })),
          results,
          log: st.log,
        };
        show({ round, phase: lastRound.length ? `Looking at round ${round - 1} results…` : "Planning round 1…" });
        const ans = await askAgent({
          message: a.message,
          mentions: a.mentions,
          images,
          board: boardForAgent(cur, edgesRef.current, toHandle),
          catalog: catalogForAgent(catalogModels, favs),
          history: [],
          mode: "loop",
          loop,
        });
        console.info("[agent] loop step", round, JSON.stringify(ans));
        st.spent += ans.coins ?? 0;

        // Verdicts on the last round.
        const keepIds: string[] = [];
        const rejectIds: string[] = [];
        const issues: string[] = [];
        for (const v of ans.verdicts ?? []) {
          const id = toId.get(String(v.handle).replace(/^@/, ""));
          if (!id || !lastRound.includes(id)) continue;
          if (v.keep) keepIds.push(id);
          else {
            rejectIds.push(id);
            if (v.issue) issues.push(v.issue);
          }
        }
        kept.push(...keepIds.filter((id) => !kept.includes(id)));
        // Mark kept / rejected results; this board is the base for the next
        // round too (one commit, so no mark is lost to a stale board).
        const board = nodesRef.current.map((n) =>
          keepIds.includes(n.id) ? { ...n, className: "fc-pick" } : rejectIds.includes(n.id) ? { ...n, className: "fc-reject" } : n,
        );
        if (keepIds.length || rejectIds.length) commit({ nodes: board, edges: edgesRef.current });
        const line = lastRound.length
          ? `Round ${round - 1}: kept ${keepIds.length} of ${lastRound.length}${issues.length ? ` — ${issues.slice(0, 3).join("; ")}` : ""}`
          : "";
        show({ picks: [...kept], target: ans.target ?? st.target, log: line ? [...st.log, line] : st.log }, ans.reply || undefined);

        if (round > MAX_ROUNDS) { show({ status: "done", phase: `Stopped after ${MAX_ROUNDS} rounds` }); break; }
        if (ans.done) { show({ status: "done", phase: "Goal met" }); break; }
        if (loopStop.current) { show({ status: "stopped", phase: "Stopped" }); break; }

        // The next round: additions only, trimmed to the budget left.
        const ops = (ans.ops ?? []).filter((o) => !/^(remove|set_|delete)/.test(String((o as { op?: string }).op ?? "")));
        if (!ops.length) { show({ status: "done", phase: "The agent planned nothing more" }); break; }
        const result = applyPlan({ reply: ans.reply, ops }, {
          nodes: board,
          edges: edgesRef.current,
          models: catalogModels,
          toId,
          makeModelNode,
          fallbackPos: centerPos(),
        });
        let created = result.created;
        const roundModels = result.nodes.filter((n) => created.includes(n.id) && n.type === "model");
        const allowed = st.budgetCoins - st.spent - REVIEW_RESERVE;
        let cost = 0;
        const run: string[] = [];
        for (const n of roundModels) {
          const c = estimateCoins(n.data as unknown as ModelNodeData) ?? 0;
          if (cost + c > allowed) continue;
          cost += c;
          costOf.set(n.id, c);
          run.push(n.id);
        }
        const dropped = roundModels.filter((n) => !run.includes(n.id)).map((n) => n.id);
        let outNodes = result.nodes.filter((n) => !dropped.includes(n.id));
        let outEdges = result.edges.filter((e) => !dropped.includes(e.source) && !dropped.includes(e.target));
        // Prompts this round added that now feed nothing go too.
        const orphan = outNodes
          .filter((n) => created.includes(n.id) && n.type === "prompt" && !outEdges.some((e) => e.source === n.id))
          .map((n) => n.id);
        outNodes = outNodes.filter((n) => !orphan.includes(n.id));
        outEdges = outEdges.filter((e) => !orphan.includes(e.source));
        created = created.filter((id) => !dropped.includes(id) && !orphan.includes(id));
        if (!run.length) {
          show({ status: "done", phase: roundModels.length ? "The budget left is too small for another round" : "Nothing to run" });
          break;
        }
        commit({ nodes: outNodes, edges: outEdges });
        setTimeout(() => void fitView({ nodes: created.map((id) => ({ id })), padding: 0.25, duration: 500, maxZoom: 1 }), 120);
        await new Promise((r) => setTimeout(r, 250));
        runDraft(created);
        st.spent += cost;
        show({
          phase: `Round ${round}: running ${run.length} model${run.length === 1 ? "" : "s"}${dropped.length ? ` (${dropped.length} cut to fit the budget)` : ""}…`,
        });

        await waitForRuns(run, () => nodesRef.current, () => loopStop.current);
        // Failed runs are refunded by the backend.
        for (const id of run) {
          const n = nodesRef.current.find((x) => x.id === id);
          if (!n || (n.data as unknown as ModelNodeData).status === "error") st.spent -= costOf.get(id) ?? 0;
        }
        show({});
        lastRound = run;
      }
    } catch (e) {
      show({ status: "error", phase: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
      window.dispatchEvent(new CustomEvent("fc-balance-refresh"));
    }
  };

  // ---- draft review ----
  const draftNodes = (ids: string[]) => nodes.filter((n) => ids.includes(n.id) && isDraft(n));
  const settle = (msgId: string, how: Msg["settled"]) =>
    setThread((t) => t.map((m) => (m.id === msgId ? { ...m, settled: how } : m)));

  const focusNode = (id: string) => {
    const n = getNode(id);
    if (!n) return;
    setCenter(n.position.x + 150, n.position.y + 120, { zoom: 0.9, duration: 400 });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (at && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setAt({ ...at, index: (at.index + d + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickOption(options[Math.min(at.index, options.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAt(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const selected = nodes.filter((n) => n.selected && n.type !== "text");
  const hasThread = thread.length > 0;

  return (
    <div className="fc-agent">
      {open && hasThread && (
        <div className="fc-agent-thread" ref={threadRef}>
          {thread.map((m) => (
            <div key={m.id} className={`fc-agent-msg ${m.role}${m.status ? ` ${m.status}` : ""}`}>
              <div className="fc-agent-text">
                {m.role === "user" ? <UserText msg={m} onChip={(c) => c.kind === "node" && focusNode(c.nodeId)} /> : m.text}
              </div>
              {m.questions?.length ? (
                <ul className="fc-agent-questions">{m.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              ) : null}
              {m.warnings?.length ? (
                <details className="fc-agent-warnings">
                  <summary>{m.warnings.length} step{m.warnings.length === 1 ? "" : "s"} skipped</summary>
                  <ul>{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </details>
              ) : null}
              {m.loop && (
                <LoopCard
                  loop={m.loop}
                  nodes={nodes}
                  onFocus={focusNode}
                  onStop={() => {
                    loopStop.current = true;
                    setThread((t) => t.map((x) => (x.id === m.id && x.loop ? { ...x, loop: { ...x.loop, phase: "Stopping after this step…" } } : x)));
                  }}
                />
              )}
              {m.draftIds && (
                <DraftCard
                  msg={m}
                  nodes={draftNodes(m.draftIds)}
                  onFocus={focusNode}
                  onRun={(ids) => {
                    runDraft(ids);
                    settle(m.id, "run");
                  }}
                  onKeep={(ids) => {
                    commit({ nodes: nodes.map((n) => (ids.includes(n.id) ? stripDraft(n) : n)), edges });
                    settle(m.id, "kept");
                  }}
                  onDiscard={(ids) => {
                    commit({
                      nodes: nodes.filter((n) => !ids.includes(n.id)),
                      edges: edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
                    });
                    settle(m.id, "discarded");
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className={`fc-agent-box${dropHover ? " drop" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/freym-model")) {
            e.preventDefault();
            e.stopPropagation();
            setDropHover(true);
          }
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={(e) => {
          const slug = e.dataTransfer.getData("application/freym-model");
          if (!slug) return;
          e.preventDefault();
          e.stopPropagation();
          setDropHover(false);
          const m = models.find((x) => x.slug === slug);
          if (!m) return;
          const r = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
            .caretRangeFromPoint?.(e.clientX, e.clientY);
          insertChips([modelChip(m)], r && editorRef.current?.contains(r.startContainer) ? r : null);
        }}
      >
        {hasThread && (
          <button className="fc-agent-toggle" onClick={() => setOpen((o) => !o)} title={open ? "Hide chat" : "Show chat"}>
            {open ? "▾" : "▴"}
          </button>
        )}
        <div
          ref={editorRef}
          className="fc-agent-input"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Ask the canvas agent"
          data-placeholder={loopOn ? "Give the agent a goal — it runs, checks and iterates within the budget" : "Ask the agent — drag nodes or models here, or type @"}
          data-empty={empty ? "1" : undefined}
          onInput={() => {
            setEmpty(!editorRef.current?.textContent?.trim() && !editorRef.current?.querySelector(`[${CHIP_ATTR}]`));
            detectAt();
            rememberCaret();
          }}
          onKeyUp={rememberCaret}
          onMouseUp={rememberCaret}
          onBlur={() => setTimeout(() => setAt(null), 150)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
        <div className="fc-agent-actions">
          <button
            className={`fc-agent-loop-toggle${loopOn ? " on" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLoopOn((v) => !v)}
            title="Loop: the agent runs, checks the results and iterates within a budget"
          >
            Loop
          </button>
          {loopOn && (
            <label className="fc-agent-budget" title="Loop budget in dollars">
              $
              <input
                value={budgetUsd}
                inputMode="decimal"
                onChange={(e) => setBudgetUsd(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
              />
            </label>
          )}
          {selected.length > 0 && (
            <button className="fc-agent-mention" onMouseDown={(e) => e.preventDefault()} onClick={() => insertChips(selected.map(chipForNode))}>
              @ selection ({selected.length})
            </button>
          )}
          <button className="fc-agent-send" disabled={busy || empty} onClick={() => void send()}>
            {busy ? "…" : "↑"}
          </button>
        </div>

        {at && options.length > 0 && (
          <div className="fc-agent-menu">
            {options.map((o, i) => (
              <div key={`${o.group}-${o.chip.kind === "node" ? o.chip.nodeId : o.chip.slug}`}>
                {(i === 0 || options[i - 1].group !== o.group) && <div className="fc-agent-menu-group">{o.group}</div>}
                <button
                  className={`fc-agent-menu-item${i === at.index ? " active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickOption(o);
                  }}
                >
                  {(o.chip.kind === "node" ? o.chip.thumb : o.chip.icon) ? (
                    <img src={(o.chip.kind === "node" ? o.chip.thumb : o.chip.icon)!} alt="" />
                  ) : (
                    <i />
                  )}
                  <span>{o.chip.label}</span>
                  {o.sub && <em>{o.sub}</em>}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function stripDraft(n: Node): Node {
  const { draft: _d, ...data } = n.data as Record<string, unknown>;
  return { ...n, className: undefined, data };
}

function UserText({ msg, onChip }: { msg: Msg; onChip: (c: Chip) => void }) {
  const parts = msg.text.split(/\u0000(\d+)\u0000/);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <span key={i}>{p}</span>;
        const c = msg.chips?.[Number(p)];
        if (!c) return null;
        const pic = c.kind === "node" ? c.thumb : c.icon;
        return (
          <button key={i} className={`fc-chip fc-chip-${c.kind}`} onClick={() => onChip(c)}>
            {pic ? <img src={pic} alt="" /> : <i />}
            {c.label}
          </button>
        );
      })}
    </>
  );
}

function DraftCard({
  msg,
  nodes,
  onFocus,
  onRun,
  onKeep,
  onDiscard,
}: {
  msg: Msg;
  nodes: Node[];
  onFocus: (id: string) => void;
  onRun: (ids: string[]) => void;
  onKeep: (ids: string[]) => void;
  onDiscard: (ids: string[]) => void;
}) {
  if (msg.settled) {
    const label =
      msg.settled === "run" ? "Started"
        : msg.settled === "kept" ? "Kept on the canvas"
          : msg.settled === "replaced" ? "Updated in the next answer"
            : "Discarded";
    return <div className="fc-agent-settled">{label}</div>;
  }
  const modelNodes = nodes.filter((n) => n.type === "model");
  const prompts = nodes.filter((n) => n.type === "prompt");
  if (!nodes.length) return <div className="fc-agent-settled">The draft is no longer on the canvas.</div>;
  const total = modelNodes.reduce((s, n) => s + (estimateCoins(n.data as unknown as ModelNodeData) ?? 0), 0);
  const ids = nodes.map((n) => n.id);
  return (
    <div className="fc-agent-draft">
      <div className="fc-agent-draft-list">
        {prompts.length > 0 && (
          <button className="fc-agent-draft-row" onClick={() => onFocus(prompts[0].id)}>
            <span>{prompts.length} prompt{prompts.length === 1 ? "" : "s"}</span>
          </button>
        )}
        {modelNodes.map((n) => {
          const d = n.data as unknown as ModelNodeData;
          const c = estimateCoins(d);
          return (
            <button key={n.id} className="fc-agent-draft-row" onClick={() => onFocus(n.id)}>
              <span>{d.modelName}</span>
              {c != null && <em>{usd(c)}</em>}
            </button>
          );
        })}
      </div>
      <div className="fc-agent-draft-total">
        {modelNodes.length} run{modelNodes.length === 1 ? "" : "s"} · <b>{usd(total)}</b> · {total} coins
      </div>
      <div className="fc-agent-draft-actions">
        <button className="fc-agent-run" disabled={!modelNodes.length} onClick={() => onRun(ids)}>
          Run all
        </button>
        <button onClick={() => onKeep(ids)} title="Keep the nodes without running them">Keep</button>
        <button onClick={() => onDiscard(ids)}>Discard</button>
      </div>
    </div>
  );
}

/** Resolves when every run settled (done / error / gone), on stop, or after 20 min. */
function waitForRuns(ids: string[], getNodes: () => Node[], stopped: () => boolean): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const ns = getNodes();
      const settled = ids.every((id) => {
        const n = ns.find((x) => x.id === id);
        if (!n) return true;
        const s = (n.data as unknown as ModelNodeData).status;
        // A node still idle after 15 s never started.
        return s === "done" || s === "error" || (s === "idle" && Date.now() - started > 15000);
      });
      if (settled || stopped() || Date.now() - started > 20 * 60 * 1000) resolve();
      else setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
  });
}

function LoopCard({
  loop,
  nodes,
  onFocus,
  onStop,
}: {
  loop: LoopState;
  nodes: Node[];
  onFocus: (id: string) => void;
  onStop: () => void;
}) {
  const pct = Math.min(100, Math.round((loop.spent / Math.max(1, loop.budgetCoins)) * 100));
  const picks = loop.picks
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is Node => !!n);
  return (
    <div className={`fc-agent-loop ${loop.status}`}>
      <div className="fc-agent-loop-head">
        <b>Loop</b>
        <span>round {Math.min(loop.round, MAX_ROUNDS)}</span>
        <span>{usd(loop.spent)} of {usd(loop.budgetCoins)}</span>
        {loop.target ? <span>kept {loop.picks.length}/{loop.target}</span> : null}
      </div>
      <div className="fc-agent-loop-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="fc-agent-loop-phase">{loop.status === "running" && <span className="fc-agent-loop-dot" />}{loop.phase}</div>
      {loop.log.length > 0 && (
        <ul className="fc-agent-loop-log">{loop.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      )}
      {picks.length > 0 && (
        <div className="fc-agent-loop-picks">
          {picks.map((n) => {
            const t = nodeThumb(n);
            return (
              <button key={n.id} onClick={() => onFocus(n.id)} title={(n.data as unknown as ModelNodeData).modelName}>
                {t ? <img src={t} alt="" /> : <span>▶</span>}
              </button>
            );
          })}
        </div>
      )}
      {loop.status === "running" && (
        <div className="fc-agent-draft-actions">
          <button onClick={onStop}>Stop</button>
        </div>
      )}
    </div>
  );
}
