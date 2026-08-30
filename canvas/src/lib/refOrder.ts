import type { Node } from "@xyflow/react";

/**
 * The single source of truth for reference ordering: wired references are
 * numbered TOP TO BOTTOM by source-node position (then left to right). The
 * same order feeds the run's reference arrays, the wire badges, and therefore
 * the prompt tags (@Image1, <IMAGE_REF_0>, …) — drag a node higher to make it
 * an earlier reference.
 */
export type RefKind = "image" | "video" | "audio";
export type RefEntry = { edgeId: string; url: string; kind: RefKind };

export function orderedRefs(
  incoming: { edgeId: string; src: Node }[],
  chainVideo: boolean,
): RefEntry[] {
  const sorted = [...incoming].sort(
    (a, b) => a.src.position.y - b.src.position.y || a.src.position.x - b.src.position.x,
  );
  const out: RefEntry[] = [];
  for (const { edgeId, src } of sorted) {
    const d = src.data as { url?: string | null; images?: string[]; category?: string };
    if (src.type === "image" && d.url) out.push({ edgeId, url: d.url, kind: "image" });
    else if (src.type === "video" && d.url) out.push({ edgeId, url: d.url, kind: "video" });
    else if (src.type === "audio" && d.url) out.push({ edgeId, url: d.url, kind: "audio" });
    else if (src.type === "model") {
      const first = d.images?.[0];
      if (!first) continue;
      const isVid = d.category === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(first);
      if (!isVid) out.push({ edgeId, url: first, kind: "image" });
      else if (chainVideo) out.push({ edgeId, url: first, kind: "video" });
    }
  }
  return out;
}
