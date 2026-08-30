import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

/**
 * Curved wire. When the edge carries a reference badge (its target is a model
 * node and the source is a wired reference), a small numbered chip rides near
 * the model end — the number is the reference's position in the prompt tags
 * (@Image2, <IMAGE_REF_1>, …), assigned top-to-bottom by node position.
 */
export default function CurvedEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.5,
  });
  const badge = (props.data as { refBadge?: string } | undefined)?.refBadge;
  return (
    <>
      <BaseEdge id={props.id} path={path} style={{ stroke: "#4a4a52", strokeWidth: 1.5 }} />
      {badge && (
        <EdgeLabelRenderer>
          <div
            className="fc-ref-badge"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {badge}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
