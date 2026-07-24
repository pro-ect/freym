import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActiveCategory, HomeRecipe } from './homeQueries';

const KEY = 'home_cache_v2';

export interface HomeCache {
  ts: number;
  featured: HomeRecipe[];
  categories: ActiveCategory[];
  byCategory: Record<string, HomeRecipe[]>;
}

export async function readHomeCache(): Promise<HomeCache | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.ts !== 'number' ||
      !Array.isArray(parsed?.featured) ||
      !Array.isArray(parsed?.categories)
    ) return null;
    return parsed as HomeCache;
  } catch {
    return null;
  }
}

export async function writeHomeCache(cache: HomeCache): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort; surfacing this isn't useful
  }
}

export async function clearHomeCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}
