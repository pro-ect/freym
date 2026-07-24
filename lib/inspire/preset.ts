/**
 * Admin-tunable Inspire preset.
 *
 * Single row in Supabase `inspire_presets` (id = 'default'). Fetched once per
 * app session and cached in memory. A hard-coded fallback below means the
 * Inspire tab is always usable, even if the table isn't reachable.
 *
 * Two-layer write model:
 *   - `saveInspirePreset` writes to Supabase (visible to all users).
 *   - `saveInspirePresetLocal` writes to AsyncStorage on this device only,
 *     used as a draft while testing prompt tweaks before publishing.
 *   - When a local override exists, `getInspirePreset` returns it without
 *     touching Supabase. `clearInspirePresetLocal` (or the "Load from
 *     Supabase" button) drops the override so the device re-syncs.
 *
 * Prompt assembly: when `grid_size === 2`, the generation hook is expected to
 * append `grid_addendum` to `prompt`. When `grid_size === 1` (Regular),
 * `grid_addendum` is ignored and no auto-crop fires after download.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

export interface InspirePreset {
  prompt: string;
  grid_addendum: string;
  model_id: string;
  image_size: string;
  grid_size: 1 | 2;
  /**
   * Copy Shot generation pipeline:
   *   1 — legacy: 2 parallel jobs, 50 coins each (100 total), gpt-image
   *       medium 1440x2560, via start-prediction-fal-copyshot.
   *   2 — single job, flat 250 coins, gpt-image HIGH 2160x3840, via
   *       start-prediction-fal-copyshot-v2, 180s library ETA.
   * Old prod builds never select this column, so flipping it only affects
   * builds that ship this code.
   */
  pipeline_version: 1 | 2;
}

export const DEFAULT_INSPIRE_PRESET: InspirePreset = {
  prompt: `Take the face from the reference selfies and place it naturally onto the model in Photo 1. Preserve the full identity of the person — facial structure, features, skin tone, hair. Match face scale and proportions precisely to the body in Photo 1 — correct perspective, natural neck-to-head ratio, aligned with body posture and camera angle.

Apply subtle beautification: refined skin, clean grooming, polished but natural look. Expression: confident, calm — but at ease.

Maintain the original lighting, color grading, and atmosphere of Photo 1. The result should feel seamless — as if this person was always in the shot.

Mix appearance of user reference photos — from photo2, photo3, photo4, photo5.`,
  grid_addendum: 'Generate a 2x2 grid with slightly different poses, zoom level and framing.',
  model_id: 'gpt-image-2-fal',
  image_size: '2160x3840',
  grid_size: 2,
  pipeline_version: 2,
};

let cached: InspirePreset | null = null;
let cachedAt = 0;
let inflight: Promise<InspirePreset> | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOCAL_PRESET_KEY = 'inspire.preset.localOverride.v1';

// Set to `true` only while a local override has been loaded into `cached`,
// so subsequent reads keep using it instead of falling through to Supabase
// even after the cache TTL expires.
let cacheIsLocalOverride = false;

export interface GetInspirePresetOptions {
  /** Bypass the in-memory cache (e.g., right before a generation kicks off
   *  so admin prompt edits propagate to users without an app restart).
   *  Note: forceRefresh still honors a local override if one exists — the
   *  override only goes away via clearInspirePresetLocal(). */
  forceRefresh?: boolean;
  /** Skip the local override and read Supabase directly. Used by the modal's
   *  "Load from Supabase" button after clearing the override, to display the
   *  fresh server values. */
  skipLocalOverride?: boolean;
}

function normalize(raw: Partial<InspirePreset> | null | undefined): InspirePreset {
  if (!raw) return DEFAULT_INSPIRE_PRESET;
  const gridSize = raw.grid_size === 1 ? 1 : 2;
  // Only an explicit 1 downgrades to the legacy 2-job pipeline; anything else
  // (2, null column on an old local override, missing) means v2.
  const pipelineVersion = raw.pipeline_version === 1 ? 1 : 2;
  return {
    prompt: raw.prompt || DEFAULT_INSPIRE_PRESET.prompt,
    grid_addendum: raw.grid_addendum ?? DEFAULT_INSPIRE_PRESET.grid_addendum,
    model_id: raw.model_id || DEFAULT_INSPIRE_PRESET.model_id,
    image_size: raw.image_size || DEFAULT_INSPIRE_PRESET.image_size,
    grid_size: gridSize,
    pipeline_version: pipelineVersion,
  };
}

export async function getInspirePreset(
  options: GetInspirePresetOptions = {},
): Promise<InspirePreset> {
  const fresh = cached && Date.now() - cachedAt < CACHE_TTL_MS;
  if (!options.forceRefresh && fresh) return cached!;
  if (inflight) return inflight;

  inflight = (async () => {
    // Local override always wins (unless explicitly skipped). It bypasses
    // Supabase entirely so admins can test prompt tweaks on-device without
    // publishing to all users.
    if (!options.skipLocalOverride) {
      try {
        const raw = await AsyncStorage.getItem(LOCAL_PRESET_KEY);
        if (raw) {
          cached = normalize(JSON.parse(raw));
          cachedAt = Date.now();
          cacheIsLocalOverride = true;
          return cached;
        }
      } catch (err) {
        console.warn('[Inspire] local override read failed:', err);
      }
    }

    cacheIsLocalOverride = false;
    try {
      const { data, error } = await supabase
        .from('inspire_presets')
        .select('prompt, grid_addendum, model_id, image_size, grid_size, pipeline_version')
        .eq('id', 'default')
        .maybeSingle();

      if (error || !data) {
        console.warn('[Inspire] preset fetch failed, using default:', error?.message);
        cached = DEFAULT_INSPIRE_PRESET;
      } else {
        cached = normalize(data);
      }
      cachedAt = Date.now();
    } catch (err) {
      console.warn('[Inspire] preset fetch threw, using default:', err);
      cached = DEFAULT_INSPIRE_PRESET;
      cachedAt = Date.now();
    }
    return cached!;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function saveInspirePreset(next: InspirePreset): Promise<void> {
  const { error } = await supabase
    .from('inspire_presets')
    .upsert({
      id: 'default',
      prompt: next.prompt,
      grid_addendum: next.grid_addendum,
      model_id: next.model_id,
      image_size: next.image_size,
      grid_size: next.grid_size,
      pipeline_version: next.pipeline_version,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
  // Publishing supersedes any device-local override.
  await clearInspirePresetLocal();
  cached = { ...next };
  cachedAt = Date.now();
  cacheIsLocalOverride = false;
}

export async function saveInspirePresetLocal(next: InspirePreset): Promise<void> {
  await AsyncStorage.setItem(LOCAL_PRESET_KEY, JSON.stringify(next));
  cached = { ...next };
  cachedAt = Date.now();
  cacheIsLocalOverride = true;
}

export async function clearInspirePresetLocal(): Promise<void> {
  await AsyncStorage.removeItem(LOCAL_PRESET_KEY);
  // Force the next read to go back to Supabase.
  cached = null;
  cachedAt = 0;
  cacheIsLocalOverride = false;
}

export async function hasLocalOverride(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_PRESET_KEY);
    return !!raw;
  } catch {
    return false;
  }
}

export function clearInspirePresetCache(): void {
  cached = null;
  cachedAt = 0;
  cacheIsLocalOverride = false;
}
