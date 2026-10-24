import { supabase } from "./supabase";

/** Per-user favorite models (canvas_favorites, RLS per user). The sidebar
 *  star toggles them; the agent resolves "my favorite models" to this set. */
let cache: Set<string> | null = null;
const EVENT = "fc-favorites-change";

export async function loadFavorites(): Promise<Set<string>> {
  if (cache) return cache;
  const { data } = await supabase.from("canvas_favorites").select("slug");
  cache = new Set((data ?? []).map((r) => r.slug as string));
  return cache;
}

export async function toggleFavorite(slug: string): Promise<Set<string>> {
  const set = new Set(await loadFavorites());
  const on = !set.has(slug);
  if (on) set.add(slug);
  else set.delete(slug);
  cache = set;
  window.dispatchEvent(new CustomEvent(EVENT));
  const { error } = on
    ? await supabase.from("canvas_favorites").insert({ slug })
    : await supabase.from("canvas_favorites").delete().eq("slug", slug);
  if (error) {
    // Roll back the optimistic change.
    if (on) set.delete(slug);
    else set.add(slug);
    window.dispatchEvent(new CustomEvent(EVENT));
    throw error;
  }
  return set;
}

export function onFavoritesChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
