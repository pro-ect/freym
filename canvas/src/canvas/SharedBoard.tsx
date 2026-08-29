import { useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PromptNode from "./PromptNode";
import PromptGenNode from "./PromptGenNode";
import ImageNode from "./ImageNode";
import ModelNode from "./ModelNode";
import CurvedEdge from "./CurvedEdge";
import { loadSharedProject } from "../lib/projects";

const nodeTypes = { prompt: PromptNode, promptgen: PromptGenNode, image: ImageNode, model: ModelNode };
const edgeTypes = { default: CurvedEdge };

/**
 * Read-only board behind a share link (?share=<token>). No auth, no editing:
 * the viewer can pan and zoom, node internals are inert (CSS pointer-events).
 */
export default function SharedBoard({ token }: { token: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "ready"; name: string; nodes: Node[]; edges: Edge[] }
  >({ kind: "loading" });

  useEffect(() => {
    loadSharedProject(token).then((p) => {
      if (!p) return setState({ kind: "missing" });
      setState({ kind: "ready", name: p.name, nodes: p.nodes as Node[], edges: p.edges as Edge[] });
    });
  }, [token]);

  if (state.kind === "loading") return <div className="fc-gate fc-muted">…</div>;
  if (state.kind === "missing")
    return <div className="fc-gate fc-muted">This board link is no longer available.</div>;

  return (
    <div className="fc-root fc-shared">
      <header className="fc-topbar">
        <span className="fc-title fc-shared-title">{state.name}</span>
        <span className="fc-save-state">view only</span>
        <a className="fc-primary fc-shared-cta" href="https://freym.app/canvas/">
          Made with freym canvas →
        </a>
      </header>
      <div className="fc-flow fc-shared-flow">
        <ReactFlowProvider>
          <ReactFlow
            nodes={state.nodes}
            edges={state.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnPinch
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#26262c" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
