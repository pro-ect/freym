import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export default function CurvedEdge(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.5,
  });
  return <BaseEdge id={props.id} path={path} style={{ stroke: "#4a4a52", strokeWidth: 1.5 }} />;
}
