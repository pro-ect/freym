import { ROUTES, VIDEO_INPUT, refTag } from "./modelPairs";
import type { RefEntry } from "./refOrder";
import type { ModelNodeData } from "../types";

/**
 * Every video model on Pika takes wired media in exactly one of two roles:
 *
 *   frames — an image the clip STARTS on, optionally one it ENDS on
 *            (image-to-video; Pikaframes: 2-5 keyframes in order)
 *   refs   — images / videos / audio the model LOOKS AT while the prompt
 *            names them (reference-to-video / omni)
 *
 * The two never mix in one run (different endpoints), so the node has one
 * mode: auto (resolved from what is wired), frames, or refs. This resolver is
 * the single source of truth for the run, the wire badges, the node's state
 * line, the prompt chips and the panel text.
 */
export type InputMode = "auto" | "frames" | "refs";

export type Resolved = {
  mode: "text" | "frames" | "refs";
  /** Endpoint variant to run + how the media is keyed. */
  slug: string;
  imageParam: string | null;
  images: string[];
  endParam?: string;
  end?: string;
  videoParam?: string;
  videos: string[];
  audioParam?: string;
  audios: string[];
  /** Per-wire badge (edgeId → label). "not used" marks media beyond a cap. */
  labels: Map<string, string>;
  /** Short state line for the node ("Frames · start → end"). */
  summary: string;
  /** What this model can do at all — drives the mode control. */
  canFrames: boolean;
  canRefs: boolean;
  hasEnd: boolean;
  framesCap: number;
  refCaps: { images: number; videos: number; audios: number } | null;
};

export function resolveInputs(
  d: Pick<ModelNodeData, "slug" | "imageParamName" | "maxRefImages" | "inputMode" | "frameSwap">,
  refs: RefEntry[],
): Resolved {
  const r = ROUTES[d.slug];
  const frames = r?.image;
  const multi = r?.multi;
  const videoInput = VIDEO_INPUT[d.slug];

  const imgs = refs.filter((x) => x.kind === "image");
  const vids = refs.filter((x) => x.kind === "video");
  const auds = refs.filter((x) => x.kind === "audio");

  const framesCap = frames ? (frames.endParam ? 2 : frames.max) : Math.max(0, d.maxRefImages);
  const canFrames = framesCap > 0;
  const canRefs = !!multi;
  const hasEnd = !!frames?.endParam || (!!frames && !frames.endParam && frames.max === 2);
  const refCaps = multi
    ? { images: multi.max, videos: multi.videoParam ? (multi.maxVideos ?? 3) : 0, audios: multi.audioParam ? (multi.maxAudios ?? 3) : 0 }
    : null;

  // ---- which role
  let mode: Resolved["mode"];
  const forced = d.inputMode ?? "auto";
  if (forced === "frames" && canFrames) mode = imgs.length ? "frames" : "text";
  else if (forced === "refs" && canRefs) mode = refs.length ? "refs" : "text";
  else if ((vids.length || auds.length) && canRefs) mode = "refs";
  else if (!imgs.length) mode = "text";
  else if (imgs.length === 1) mode = canFrames ? "frames" : "refs";
  else if (imgs.length === 2) mode = framesCap >= 2 ? "frames" : canRefs ? "refs" : "frames";
  else mode = canRefs ? "refs" : "frames";
  if (!canFrames && !canRefs && !videoInput) mode = imgs.length ? "frames" : "text";

  const labels = new Map<string, string>();
  const base: Resolved = {
    mode,
    slug: d.slug,
    imageParam: d.imageParamName,
    images: [],
    videos: [],
    audios: [],
    labels,
    summary: "Text only",
    canFrames,
    canRefs,
    hasEnd,
    framesCap,
    refCaps,
  };

  // Edit/extend cards: the wired video is the source, images are ignored.
  if (videoInput) {
    const src = vids.slice(0, videoInput.max);
    src.forEach((v) => labels.set(v.edgeId, "source"));
    vids.slice(videoInput.max).forEach((v) => labels.set(v.edgeId, "not used"));
    imgs.forEach((i) => labels.set(i.edgeId, "not used"));
    return {
      ...base,
      mode: src.length ? "refs" : "text",
      videoParam: videoInput.param,
      videos: src.map((v) => v.url),
      summary: src.length ? "Source video" : "Wire a video",
    };
  }

  if (mode === "text") return base;

  if (mode === "frames") {
    let ordered = imgs;
    if (d.frameSwap && imgs.length >= 2) ordered = [imgs[1], imgs[0], ...imgs.slice(2)];
    const take = ordered.slice(0, framesCap);
    const dropped = [...ordered.slice(framesCap), ...vids, ...auds];
    dropped.forEach((x) => labels.set(x.edgeId, "not used"));
    const keyframes = framesCap > 2; // Pikaframes
    if (take.length >= 2 || dropped.length) {
      take.forEach((x, i) =>
        labels.set(x.edgeId, keyframes ? `key ${i + 1}` : i === 0 ? "start" : "end"),
      );
    }
    const summary = keyframes
      ? `Keyframes · ${take.length}`
      : take.length >= 2
        ? "Frames · start → end"
        : "Frames · start";
    const note = dropped.length ? ` · ${dropped.length} not used` : "";
    if (frames?.endParam) {
      return {
        ...base,
        slug: frames.slug,
        imageParam: frames.param,
        images: [take[0].url],
        endParam: frames.endParam,
        end: take[1]?.url,
        summary: summary + note,
      };
    }
    return {
      ...base,
      slug: frames?.slug ?? d.slug,
      imageParam: frames?.param ?? d.imageParamName,
      images: take.map((x) => x.url),
      summary: summary + note,
    };
  }

  // refs
  const m = multi!;
  const takeI = imgs.slice(0, m.max);
  const takeV = m.videoParam ? vids.slice(0, m.maxVideos ?? 3) : [];
  const takeA = m.audioParam ? auds.slice(0, m.maxAudios ?? 3) : [];
  const dropped = [
    ...imgs.slice(takeI.length),
    ...vids.slice(takeV.length),
    ...auds.slice(takeA.length),
  ];
  dropped.forEach((x) => labels.set(x.edgeId, "not used"));
  const total = takeI.length + takeV.length + takeA.length;
  if (total >= 2 || dropped.length) {
    takeI.forEach((x, i) => labels.set(x.edgeId, String(i + 1)));
    takeV.forEach((x, i) => labels.set(x.edgeId, `V${i + 1}`));
    takeA.forEach((x, i) => labels.set(x.edgeId, `A${i + 1}`));
  }
  const parts: string[] = [];
  if (takeI.length) parts.push(`${takeI.length} image${takeI.length === 1 ? "" : "s"}`);
  if (takeV.length) parts.push(`${takeV.length} video${takeV.length === 1 ? "" : "s"}`);
  if (takeA.length) parts.push(`${takeA.length} audio`);
  const note = dropped.length ? ` · ${dropped.length} not used` : "";
  return {
    ...base,
    slug: m.slug,
    imageParam: m.param,
    images: takeI.map((x) => x.url),
    videoParam: m.videoParam,
    videos: takeV.map((x) => x.url),
    audioParam: m.audioParam,
    audios: takeA.map((x) => x.url),
    summary: `References · ${parts.join(", ") || "none"}${note}`,
  };
}

/** Prompt chips for a refs-mode run: tag + url per reference, in order. */
export function refChips(slug: string, res: Resolved): { tag: string; kind: "image" | "video" | "audio"; url: string }[] {
  if (res.mode !== "refs" || VIDEO_INPUT[slug]) return [];
  return [
    ...res.images.map((url, i) => ({ tag: refTag(slug, "image", i + 1), kind: "image" as const, url })),
    ...res.videos.map((url, i) => ({ tag: refTag(slug, "video", i + 1), kind: "video" as const, url })),
    ...res.audios.map((url, i) => ({ tag: refTag(slug, "audio", i + 1), kind: "audio" as const, url })),
  ];
}

/** Plain-words capability line for the properties panel. */
export function describeCaps(res: Resolved): string[] {
  const out: string[] = [];
  if (res.canFrames) {
    out.push(
      res.framesCap > 2
        ? `Frames: ${res.framesCap} keyframes in wire order — the clip moves through them.`
        : res.hasEnd
          ? "Frames: the first wired image is the start, a second one is the end. The clip animates between them."
          : "Frames: one wired image is the start of the clip.",
    );
  }
  if (res.refCaps) {
    const c = res.refCaps;
    const bits = [`up to ${c.images} images`];
    if (c.videos) bits.push(`${c.videos} videos`);
    if (c.audios) bits.push(`${c.audios} audio clips`);
    out.push(`References: ${bits.join(", ")}. The model looks at them; name them in the prompt with the tags shown on the wires.`);
  }
  if (res.canFrames && res.canRefs) {
    out.push("Auto picks Frames for 1–2 images and References for more images or any video/audio. Click a wire badge to swap start and end.");
  }
  return out;
}
