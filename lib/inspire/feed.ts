import { supabase } from '../supabase';

export type InspireFeedItem = {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  prompt: string | null;
  source_model: string | null;
  width: number | null;
  height: number | null;
  tags: string[];
  credit_name: string | null;
};

/** Coerce a raw dimension to a finite positive number, or null otherwise. */
function finitePositiveOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function shuffle<T>(arr: T[]): T[] {
  // Fisher–Yates, in place.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Admin-only: remove a photo from the inspire feed (soft delete via
 * is_active = false). Enforced server-side by the delete_inspire_photo RPC,
 * which checks profiles.is_admin for the caller.
 */
export async function deleteInspirePhoto(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_inspire_photo', { p_id: id });
  if (error) throw error;
}

export async function fetchInspireFeed(limit = 60): Promise<InspireFeedItem[]> {
  // Pull a large pool, then shuffle client-side so the feed is freshly mixed on
  // every load (avoids the same photos — or the same gender — clustering at top).
  // Pinned photos bypass the shuffle and are kept at the very top so chosen
  // references reliably land in the first slots.
  const { data, error } = await supabase
    .from('copy_shot_inspire')
    .select('id, image_url, thumbnail_url, prompt, source_model, width, height, tags, credit_name, is_pinned')
    .eq('is_active', true)
    .order('sort_order', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    ...(r as InspireFeedItem & { is_pinned?: boolean }),
    // Normalize dims to a finite positive number or null so bad rows (string
    // "0", NaN, negatives) can never reach layout math and crash CoreAnimation.
    width: finitePositiveOrNull(r.width),
    height: finitePositiveOrNull(r.height),
  }));
  const pinned = shuffle(rows.filter((r) => r.is_pinned)).map(({ is_pinned, ...r }) => r);
  const rest = shuffle(rows.filter((r) => !r.is_pinned)).map(({ is_pinned, ...r }) => r);
  return [...pinned, ...rest].slice(0, limit);
}
