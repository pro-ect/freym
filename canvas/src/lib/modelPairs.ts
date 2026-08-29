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

const EDIT_SLUGS = new Set(Object.values(EDIT_PAIRS).map((p) => p.editSlug));

/** Edit variants merged into their base card — keep them out of the sidebar. */
export function isHiddenEditVariant(slug: string): boolean {
  return EDIT_SLUGS.has(slug);
}
