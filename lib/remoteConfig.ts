import { supabase } from './supabase';

// Reads from the Supabase `app_config` table (key/JSONB value). Lets us flip
// server-side switches without an app release. Every read is best-effort: on any
// error or missing key it returns the caller's fallback, so a backend hiccup
// never breaks the flow.

// Small in-memory cache so repeated reads in one session don't re-hit the network.
const cache = new Map<string, { value: any; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getAppConfigValue(key: string): Promise<any | undefined> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return undefined;
    cache.set(key, { value: data.value, at: Date.now() });
    return data.value;
  } catch {
    return undefined;
  }
}

// Raw JSON config object (e.g. hard_paywall_flow_v2). Returns undefined on any
// error/missing key so callers apply their own safe defaults. If the row was
// written as a stringified JSON blob, parse it back to an object.
export async function getAppConfigJson(key: string): Promise<any | undefined> {
  const value = await getAppConfigValue(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

// Plain string config value (e.g. copyshot_default_photo_mode = "single").
// Handles rows written as a bare JSONB string. Returns fallback on any
// error/missing key. `allowed`, when passed, rejects values outside the set.
export async function getAppConfigString(
  key: string,
  fallback: string,
  allowed?: readonly string[]
): Promise<string> {
  const value = await getAppConfigValue(key);
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (allowed && !allowed.includes(v)) return fallback;
  return v;
}

// JSONB values may arrive as a real boolean, or as a "true"/"false" string /
// 0|1 number depending on how the row was written — normalize them all.
export async function getAppConfigBool(key: string, fallback: boolean): Promise<boolean> {
  const value = await getAppConfigValue(key);
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return fallback;
}
