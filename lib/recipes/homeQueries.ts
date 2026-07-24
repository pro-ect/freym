import { supabase } from '../supabase';

export interface HomeRecipe {
  id: string;
  name: string;
  cover_url: string | null;       // first example URL
  example_urls: string[];          // all example URLs for auto-cycling
  photo_count: number;             // count of example URLs (>=1 if cover exists)
  featured_image_url: string | null; // optional hero-only override
  category_tags: string[];
  is_featured: boolean;
  featured_order: number | null;
  view_count: number;
  like_count: number;
}

function rowToHomeRecipe(row: any): HomeRecipe {
  const multi: string[] = Array.isArray(row.example_result_urls) ? row.example_result_urls : [];
  const single: string | null = row.example_result_url ?? null;
  const examples = multi.length > 0 ? multi : single ? [single] : [];
  return {
    id: row.id,
    name: row.recipe_data?.name ?? 'Untitled',
    cover_url: examples[0] ?? null,
    example_urls: examples,
    photo_count: examples.length,
    featured_image_url: row.featured_image_url ?? null,
    category_tags: Array.isArray(row.category_tags) ? row.category_tags : [],
    is_featured: !!row.is_featured,
    featured_order: row.featured_order ?? null,
    view_count: row.view_count ?? 0,
    like_count: row.like_count ?? 0,
  };
}

export async function fetchFeaturedRecipes(limit = 8): Promise<HomeRecipe[]> {
  // public_recipes_v2 is a view that returns rows with is_public=true OR is_v2_published=true,
  // so the new app sees both legacy public recipes and v2-only recipes hidden from old apps.
  const { data, error } = await supabase
    .from('public_recipes_v2')
    .select('id, recipe_data, example_result_url, example_result_urls, featured_image_url, category_tags, is_featured, featured_order, view_count, like_count')
    .eq('is_featured', true)
    .order('featured_order', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn('[Home] featured fetch failed:', error.message);
    return [];
  }
  return (data ?? []).map(rowToHomeRecipe);
}

export async function fetchRecipesByCategory(tag: string, limit = 20): Promise<HomeRecipe[]> {
  const { data, error } = await supabase
    .from('public_recipes_v2')
    .select('id, recipe_data, example_result_url, example_result_urls, featured_image_url, category_tags, is_featured, featured_order, view_count, like_count')
    .contains('category_tags', [tag])
    .order('pin_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[Home] category fetch "${tag}" failed:`, error.message);
    return [];
  }
  return (data ?? []).map(rowToHomeRecipe);
}

export interface ActiveCategory {
  slug: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
}

// Returns categories (in sort_order) that have at least one currently-public recipe.
export async function fetchActiveCategories(): Promise<ActiveCategory[]> {
  const [catsRes, tagsRes] = await Promise.all([
    supabase
      .from('recipe_categories')
      .select('slug, title, subtitle, sort_order')
      .order('sort_order', { ascending: true }),
    supabase
      .from('public_recipes_v2')
      .select('category_tags'),
  ]);

  if (catsRes.error) {
    console.warn('[Home] categories fetch failed:', catsRes.error.message);
    return [];
  }
  if (tagsRes.error) {
    console.warn('[Home] active-tags fetch failed:', tagsRes.error.message);
    return (catsRes.data ?? []) as ActiveCategory[];
  }

  const activeSlugs = new Set<string>();
  for (const row of tagsRes.data ?? []) {
    const tags: unknown = (row as any).category_tags;
    if (Array.isArray(tags)) {
      for (const t of tags) if (typeof t === 'string') activeSlugs.add(t);
    }
  }

  return ((catsRes.data ?? []) as ActiveCategory[]).filter((c) => activeSlugs.has(c.slug));
}

export async function fetchCategory(slug: string): Promise<ActiveCategory | null> {
  const { data, error } = await supabase
    .from('recipe_categories')
    .select('slug, title, subtitle, sort_order')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.warn(`[Home] category fetch "${slug}" failed:`, error.message);
    return null;
  }
  return (data as ActiveCategory | null) ?? null;
}
