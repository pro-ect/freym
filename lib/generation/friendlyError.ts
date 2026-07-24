/**
 * Maps raw model/Fal error strings to user-friendly messages on the CLIENT.
 *
 * Mirrors friendlyErrorMessage() in supabase/functions/fal-prediction-callback —
 * that one handles the ASYNC (webhook) failure path; this one handles SYNCHRONOUS
 * 422s returned at enqueue time (e.g. gpt-image-2's content checker rejecting a
 * reference photo with exposed skin), which never reach the callback.
 * ⚠️ Keep the two in sync.
 */
export function friendlyGenerationError(raw: string | undefined | null): string {
  const fallback = 'Generation failed. Please try again.';
  if (!raw) return fallback;
  const lower = raw.toLowerCase();

  if (
    lower.includes('content checker') ||
    lower.includes('flagged') ||
    lower.includes('content could not be processed') ||
    lower.includes('validating the input') ||
    lower.includes('safety') ||
    lower.includes('policy violation') ||
    lower.includes('moderation') ||
    lower.includes('not allowed')
  ) {
    return 'Blocked by the model’s content filter — likely too much exposed skin. Try a more covered photo.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return 'The model is busy. Try again in a minute.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The model timed out. Try again.';
  }
  if (lower.includes('nsfw')) {
    return 'Blocked as possibly explicit. Try a different photo.';
  }
  if (lower.includes('face') && (lower.includes('not found') || lower.includes('no face'))) {
    return 'No face found in your photo. Use a clearer one.';
  }
  if (lower.includes('invalid image') || lower.includes('image format') || lower.includes('decode')) {
    return 'Couldn’t read that image. Try a JPG or PNG.';
  }

  // Strip the noisy "Fal.ai error (422): " prefix if no specific match.
  const stripped = raw.replace(/^Fal\.ai error \(\d+\):\s*/i, '').trim();
  return stripped || fallback;
}
