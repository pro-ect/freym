/**
 * Universal image-model nodes: one card per model, the run routes itself.
 * Prompt only → the base text-to-image slug; reference images wired → the same
 * provider's edit slug. The sidebar hides the edit variants; pricing is
 * identical within a pair, so the shown price stays correct either way.
 */
export type EditPair = { editSlug: string; imageParam: string; maxRefs: number };

export const EDIT_PAIRS: Record<string, EditPair> = {
  "gpt-image-2-pika": { editSlug: "gpt-image-2-edit-pika", imageParam: "image_urls", maxRefs: 4 },
  "nb2-pika": { editSlug: "nb2-edit-pika", imageParam: "image_urls", maxRefs: 10 },
  "nb-pro-2k-pika": { editSlug: "nb-pro-2k-edit-pika", imageParam: "image_urls", maxRefs: 10 },
  "seedream-5-pro-t2i-pika": { editSlug: "seedream-5-pro-edit-pika", imageParam: "image_urls", maxRefs: 10 },
};

/**
 * Video models with a multi-reference endpoint: one wired image keeps the
 * plain image-to-video (start frame); two or more route to the same vendor's
 * reference-to-video / omni endpoint, so every wired image reaches the model.
 * MiniMax caps at 5 — its vendor bills extra beyond five references.
 * Per-second pricing is identical to the base op in every pair.
 */
export const VIDEO_REF_PAIRS: Record<string, EditPair> = {
  "seedance-25-i2v-pika": { editSlug: "seedance-25-r2v-pika", imageParam: "image_urls", maxRefs: 10 },
  "seedance-20-i2v-pika": { editSlug: "seedance-20-r2v-pika", imageParam: "image_urls", maxRefs: 10 },
  "minimax-h3-i2v-pika": { editSlug: "minimax-h3-r2v-pika", imageParam: "image_urls", maxRefs: 5 },
  "wan-30-i2v-pika": { editSlug: "wan-30-omni-pika", imageParam: "reference_image_urls", maxRefs: 10 },
};

/** How many reference images a node can actually take, counting its pair. */
export function refCapacity(slug: string, fallback: number): number {
  return EDIT_PAIRS[slug]?.maxRefs ?? VIDEO_REF_PAIRS[slug]?.maxRefs ?? fallback;
}

const EDIT_SLUGS = new Set(Object.values(EDIT_PAIRS).map((p) => p.editSlug));

/** Edit variants merged into their base card — keep them out of the sidebar. */
export function isHiddenEditVariant(slug: string): boolean {
  return EDIT_SLUGS.has(slug);
}
