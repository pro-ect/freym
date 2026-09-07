import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";

/**
 * Snapshot-based undo/redo for the board.
 *
 * Every settled change to nodes/edges (add, delete, move, wire, prompt text,
 * model params) becomes one history step; a drag coalesces into a single
 * step because pushes are debounced. Selection, measured sizes and run
 * bookkeeping (status, jobId, results) are NOT history — undoing must never
 * cancel or resurrect a run, so those fields are carried over from the live
 * node when a snapshot is restored.
 */

type Snap = { nodes: Node[]; edges: Edge[] };

const LIMIT = 100;
const SETTLE_MS = 350;

/** Run bookkeeping that history leaves alone. */
const TRANSIENT = ["status", "jobId", "errorMessage", "images", "runs", "runIndex", "uploading"] as const;

function stripData(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    if (!(TRANSIENT as readonly string[]).includes(k)) out[k] = data[k];
  }
  return out;
}

/** Fingerprint of the user-editable state — what history compares. */
function keyOf(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify([
    nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), stripData(n.data as Record<string, unknown>)]),
    edges.map((e) => [e.id, e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null]),
  ]);
}

export function useHistory(
  nodes: Node[],
  edges: Edge[],
  active: boolean,
  setNodes: (n: Node[]) => void,
  setEdges: (e: Edge[]) => void,
) {
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const present = useRef<Snap | null>(null);
  const presentKey = useRef<string | null>(null);
  const applying = useRef(false);
  const timer = useRef<number | null>(null);
  const live = useRef<Snap>({ nodes, edges });
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });

  live.current = { nodes, edges };

  const sync = () => setCounts({ undo: past.current.length, redo: future.current.length });

  useEffect(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    // The first settled state after load, and states we restored ourselves,
    // become "present" without creating a step.
    if (presentKey.current === null || applying.current) {
      applying.current = false;
      present.current = { nodes, edges };
      presentKey.current = keyOf(nodes, edges);
      return;
    }
    timer.current = window.setTimeout(() => {
      const key = keyOf(nodes, edges);
      if (key === presentKey.current) return;
      if (present.current) {
        past.current.push(present.current);
        if (past.current.length > LIMIT) past.current.shift();
      }
      future.current = [];
      present.current = { nodes, edges };
      presentKey.current = key;
      sync();
    }, SETTLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [nodes, edges, active]);

  const restore = useCallback(
    (snap: Snap) => {
      const liveById = new Map(live.current.nodes.map((n) => [n.id, n]));
      const restored = snap.nodes.map((n) => {
        const cur = liveById.get(n.id);
        if (!cur) return { ...n, selected: false };
        const carried: Record<string, unknown> = {};
        const curData = cur.data as Record<string, unknown>;
        for (const k of TRANSIENT) if (k in curData) carried[k] = curData[k];
        return { ...n, selected: false, data: { ...n.data, ...carried } };
      });
      applying.current = true;
      if (timer.current) clearTimeout(timer.current);
      setNodes(restored);
      setEdges(snap.edges);
    },
    [setNodes, setEdges],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !present.current) return;
    future.current.push(present.current);
    present.current = prev;
    presentKey.current = keyOf(prev.nodes, prev.edges);
    restore(prev);
    sync();
  }, [restore]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !present.current) return;
    past.current.push(present.current);
    present.current = next;
    presentKey.current = keyOf(next.nodes, next.edges);
    restore(next);
    sync();
  }, [restore]);

  return { undo, redo, canUndo: counts.undo > 0, canRedo: counts.redo > 0 };
}
