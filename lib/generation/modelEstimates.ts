/**
 * Per-model generation time estimates (seconds).
 *
 * Values are p75 of (updated_at - created_at) on completed `generation_queue`
 * rows over the last 60 days, rounded up to a friendly number. p75 means the
 * fake loader bar fills before completion for ~3 out of 4 jobs; the remaining
 * 25% see it idle at 95% until the real result arrives.
 *
 * Refresh by re-running the query in supabase against generation_queue when
 * model volumes change meaningfully.
 */

const MODEL_ETA_SECONDS: Record<string, number> = {
  // Nano Banana family
  'nano-banana-2-fal': 30,
  'nano-banana-fal': 25,
  'nano-banana-pro-2k-fal': 70,
  // Seedream family
  'seedream-4.5-fal': 90,
  'seedream-5-lite-fal': 100,
  // GPT image family
  'gpt-image-2-fal': 90,
  'gpt-image-1.5-fal': 120,
  // Kling
  'kling-video-2.6-fal': 75,
  'kling-image-o1-fal': 110,
  // Utility models
  'background-remover': 20,
  'topaz-upscale-fal': 30,
};

const FALLBACK_ETA_SECONDS = 60;

export function getEstimatedSeconds(modelId?: string | null): number {
  if (!modelId) return FALLBACK_ETA_SECONDS;
  return MODEL_ETA_SECONDS[modelId] ?? FALLBACK_ETA_SECONDS;
}
