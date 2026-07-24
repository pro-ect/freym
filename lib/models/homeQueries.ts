import { supabase } from '../supabase';
import type { CloudModel } from '../cloudModels';

// Hard ceiling on every home query. On slow/flaky internet a Supabase fetch can
// hang for a very long time without rejecting; aborting after this keeps the
// home screen from being stuck on its loading skeleton forever (the query then
// returns an abort error, which callers already treat as "no data" / fallback).
const QUERY_TIMEOUT_MS = 12_000;

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

export interface HomeModel {
  id: string;
  slug: string;
  name: string;
  category: 'image' | 'video';
  tags: string[];
  categorySlugs: string[];
  isNew: boolean;
  isFeatured: boolean;
  iconUrl: string | null;
  heroImageUrl: string | null;
  tagline: string | null;
  longDescription: string | null;
  description: string | null;
  costCoins: number;
  sortOrder: number;
}

function rowToHomeModel(row: any): HomeModel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    categorySlugs: Array.isArray(row.category_slugs) ? row.category_slugs : [],
    isNew: !!row.is_new,
    isFeatured: !!row.is_featured,
    iconUrl: row.icon_url ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    tagline: row.tagline ?? null,
    longDescription: row.long_description ?? null,
    description: row.description ?? null,
    costCoins: row.cost_coins ?? 0,
    sortOrder: row.sort_order ?? 0,
  };
}

const HOME_SELECT =
  'id, slug, name, description, category, tags, category_slugs, is_new, is_featured, icon_url, hero_image_url, tagline, long_description, cost_coins, sort_order';

export async function fetchFeaturedModels(limit = 8): Promise<HomeModel[]> {
  const { data, error } = await supabase
    .from('models')
    .select(HOME_SELECT)
    .eq('is_active', true)
    .eq('is_featured', true)
    .order('sort_order', { ascending: true })
    .limit(limit);
  if (error) {
    console.warn('[ModelsHome] featured fetch failed:', error.message);
    return [];
  }
  return (data ?? []).map(rowToHomeModel);
}

export async function fetchModelsByCategory(slug: string, limit = 20): Promise<HomeModel[]> {
  const { data, error } = await supabase
    .from('models')
    .select(HOME_SELECT)
    .eq('is_active', true)
    .contains('category_slugs', [slug])
    .order('sort_order', { ascending: true })
    .limit(limit);
  if (error) {
    console.warn(`[ModelsHome] category "${slug}" fetch failed:`, error.message);
    return [];
  }
  return (data ?? []).map(rowToHomeModel);
}

export interface ActiveModelCategory {
  slug: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
}

// Returns active model categories (sorted) that contain at least one active model.
export async function fetchActiveModelCategories(): Promise<ActiveModelCategory[]> {
  const t = timeoutSignal(QUERY_TIMEOUT_MS);
  const [catsRes, modelsRes] = await Promise.all([
    supabase
      .from('model_categories')
      .select('slug, title, subtitle, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .abortSignal(t.signal),
    supabase
      .from('models')
      .select('category_slugs')
      .eq('is_active', true)
      .abortSignal(t.signal),
  ]).finally(t.clear);

  if (catsRes.error) {
    console.warn('[ModelsHome] categories fetch failed:', catsRes.error.message);
    return [];
  }
  if (modelsRes.error) {
    console.warn('[ModelsHome] active-category-membership fetch failed:', modelsRes.error.message);
    return (catsRes.data ?? []) as ActiveModelCategory[];
  }

  const activeSlugs = new Set<string>();
  for (const row of modelsRes.data ?? []) {
    const slugs: unknown = (row as any).category_slugs;
    if (Array.isArray(slugs)) {
      for (const s of slugs) if (typeof s === 'string') activeSlugs.add(s);
    }
  }

  return ((catsRes.data ?? []) as ActiveModelCategory[]).filter((c) => activeSlugs.has(c.slug));
}

// Returns all active model categories, including ones with zero members.
// Use this when populating pickers (e.g. the edit-model modal) so freshly
// created empty categories are assignable.
export async function fetchAllActiveModelCategories(): Promise<ActiveModelCategory[]> {
  const { data, error } = await supabase
    .from('model_categories')
    .select('slug, title, subtitle, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[ModelsHome] all-categories fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as ActiveModelCategory[];
}

export function homeModelFromCloud(m: CloudModel): HomeModel {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    category: m.category,
    tags: m.tags,
    categorySlugs: m.categorySlugs,
    isNew: m.isNew,
    isFeatured: m.isFeatured,
    iconUrl: m.iconUrl,
    heroImageUrl: m.heroImageUrl,
    tagline: m.tagline,
    longDescription: m.longDescription,
    description: m.description,
    costCoins: m.costCoins,
    sortOrder: m.sortOrder,
  };
}
