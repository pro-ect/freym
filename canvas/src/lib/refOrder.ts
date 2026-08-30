import type { Node } from "@xyflow/react";

/**
 * The single source of truth for reference ordering: references are numbered
 * in CONNECTION ORDER — the first wire you connect is reference 1 and stays
 * reference 1; later wires append. (Callers pass edges in store order, which
 * is creation order and survives save/load.) The same order feeds the run's
 * reference arrays, the wire badges, and therefore the prompt tags
 * (@Image1, image 2, …).
 */
export type RefKind = "image" | "video" | "audio";
export type RefEntry = { edgeId: string; url: string; kind: RefKind };

export function orderedRefs(
  incoming: { edgeId: string; src: Node }[],
  chainVideo: boolean,
): RefEntry[] {
  const out: RefEntry[] = [];
  for (const { edgeId, src } of incoming) {
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
