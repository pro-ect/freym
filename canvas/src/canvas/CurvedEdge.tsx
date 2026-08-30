import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

/** Same control-point rule React Flow uses for a 0.5-curvature bezier. */
function controlOffset(d: number): number {
  return d >= 0 ? d * 0.5 : 0.5 * 25 * Math.sqrt(-d);
}

/**
 * Curved wire. A reference badge (the number the prompt tags use) rides at
 * t≈0.82 of the curve — close to the model node it feeds, but before the
 * wires converge on the shared input handle. The path is computed here so the
 * badge sits exactly on it, whatever the wire's length.
 */
export default function CurvedEdge(props: EdgeProps) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const off = controlOffset(tx - sx);
  const c1x = sx + off;
  const c2x = tx - off;
  const path = `M ${sx},${sy} C ${c1x},${sy} ${c2x},${ty} ${tx},${ty}`;

  const badge = (props.data as { refBadge?: string } | undefined)?.refBadge;
  let bx = 0;
  let by = 0;
  if (badge) {
    const t = 0.82;
    const u = 1 - t;
    bx = u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx;
    by = u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty;
  }

  return (
    <>
      <BaseEdge id={props.id} path={path} style={{ stroke: "#4a4a52", strokeWidth: 1.5 }} />
      {badge && (
        <EdgeLabelRenderer>
          <div
            className="fc-ref-badge"
            style={{ transform: `translate(-50%, -50%) translate(${bx}px, ${by}px)` }}
          >
            {badge}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
