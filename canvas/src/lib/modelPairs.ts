/**
 * Universal model nodes: ONE card per model, the run routes itself by what is
 * wired in. For the user it is the same node; the backend endpoint changes:
 *
 *   image models  — prompt only → text-to-image; any images → the provider's
 *                   edit endpoint.
 *   video models  — prompt only → text-to-video; one image → image-to-video
 *                   (start frame); two+ images, or any video/audio reference →
 *                   reference-to-video / omni.
 *
 * Per-second pricing is identical across a family's ops (video references add
 * a server-side surcharge where the vendor bills input video).
 */
export type Route = { slug: string; param: string; max: number };
export type MultiRoute = Route & {
  videoParam?: string;
  maxVideos?: number;
  audioParam?: string;
  maxAudios?: number;
  /** Image count that flips to this route (default 2; Omni keeps 2 images as
   *  start+end frames on image-to-video, so it flips at 3). */
  minImages?: number;
};
export type ModelRoutes = {
  image?: Route;
  multi?: MultiRoute;
  /** How this model's prompt addresses wired references (shown in the panel). */
  refHint?: string;
};

export const ROUTES: Record<string, ModelRoutes> = {
  // image models
  "gpt-image-2-pika": {
    image: { slug: "gpt-image-2-edit-pika", param: "image_urls", max: 4 },
    refHint: "Wired images are numbered in the order you connected them — say “the person from image 2” in the prompt.",
  },
  "nb2-pika": {
    image: { slug: "nb2-edit-pika", param: "image_urls", max: 10 },
    refHint: "Wired images are numbered in the order you connected them — refer to them as image 1, image 2… in the prompt.",
  },
  "nb-pro-2k-pika": {
    image: { slug: "nb-pro-2k-edit-pika", param: "image_urls", max: 10 },
    refHint: "Wired images are numbered in the order you connected them — refer to them as image 1, image 2… in the prompt.",
  },
  "seedream-5-pro-t2i-pika": {
    image: { slug: "seedream-5-pro-edit-pika", param: "image_urls", max: 10 },
    refHint: "Wired images are numbered in the order you connected them — refer to them as image 1, image 2… in the prompt.",
  },
  // video models
  "wan-30-pika": {
    image: { slug: "wan-30-i2v-pika", param: "first_frame_url", max: 1 },
    multi: {
      slug: "wan-30-omni-pika", param: "reference_image_urls", max: 10,
      videoParam: "reference_video_urls", maxVideos: 5,
      audioParam: "reference_audio_urls", maxAudios: 5,
    },
    refHint: "References are numbered in the order you connected them — mention them in the prompt as image 1, image 2, video 1…",
  },
  "seedance-25-pika": {
    image: { slug: "seedance-25-i2v-pika", param: "image_url", max: 1 },
    multi: {
      slug: "seedance-25-r2v-pika", param: "image_urls", max: 10,
      videoParam: "video_urls", maxVideos: 3, audioParam: "audio_urls", maxAudios: 3,
    },
    refHint: "References are numbered in the order you connected them — address them in the prompt as @Image1, @Image2… / @Video1 / @Audio1.",
  },
  "seedance-20-pika": {
    image: { slug: "seedance-20-i2v-pika", param: "image_url", max: 1 },
    multi: {
      slug: "seedance-20-r2v-pika", param: "image_urls", max: 10,
      videoParam: "video_urls", maxVideos: 3, audioParam: "audio_urls", maxAudios: 3,
    },
    refHint: "References are numbered in the order you connected them — address them in the prompt as @Image1, @Image2… / @Video1 / @Audio1.",
  },
  "minimax-h3-pika": {
    image: { slug: "minimax-h3-i2v-pika", param: "first_frame_image", max: 1 },
    multi: {
      // capped at 5 images — the vendor bills extra beyond five references
      slug: "minimax-h3-r2v-pika", param: "image_urls", max: 5,
      videoParam: "video_urls", maxVideos: 3, audioParam: "audio_urls", maxAudios: 3,
    },
    refHint: "References are numbered in the order you connected them — address them in the prompt as @Image1, @Image2… / @Video1 / @Audio1.",
  },
  "omni-11-pika": {
    image: { slug: "omni-11-i2v-pika", param: "image_urls", max: 2 },
    multi: {
      slug: "omni-11-r2v-pika", param: "image_urls", max: 6, minImages: 3,
      videoParam: "video_urls", maxVideos: 3, audioParam: "audio_urls", maxAudios: 3,
    },
    refHint: "1–2 wired images are the start/end frames (FIRST_FRAME, LAST_FRAME). 3+ images or video/audio refs switch to reference mode — address them as <IMAGE_REF_0>, <VIDEO_REF_0>… in connection order.",
  },
  "pika-25-t2v-pika": { image: { slug: "pika-25-i2v-pika", param: "image", max: 1 } },
};

const HIDDEN = new Set(
  Object.values(ROUTES).flatMap((r) => [r.image?.slug, r.multi?.slug]).filter(Boolean) as string[],
);

/** Variants merged into their base card — keep them out of the sidebar. */
export function isHiddenVariant(slug: string): boolean {
  return HIDDEN.has(slug);
}

/** How many reference images a node can take, counting its routed variants. */
export function refCapacity(slug: string, fallback: number): number {
  const r = ROUTES[slug];
  return r?.multi?.max ?? r?.image?.max ?? fallback;
}

/** The prompt tag a model understands for reference N (1-based, per kind).
 *  Seedance/MiniMax document @-tags; everyone else reads natural language. */
const AT_TAG_SLUGS = new Set(["seedance-25-pika", "seedance-20-pika", "minimax-h3-pika"]);
export function refTag(slug: string, kind: "image" | "video" | "audio", index: number): string {
  if (AT_TAG_SLUGS.has(slug)) {
    return kind === "image" ? `@Image${index}` : kind === "video" ? `@Video${index}` : `@Audio${index}`;
  }
  if (slug === "omni-11-pika") {
    // Google's role tags are 0-based
    return kind === "image" ? `<IMAGE_REF_${index - 1}>` : kind === "video" ? `<VIDEO_REF_${index - 1}>` : `<AUDIO_REF_${index - 1}>`;
  }
  return `${kind} ${index}`;
}
