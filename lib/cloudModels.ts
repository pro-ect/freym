/**
 * Cloud Models Service
 *
 * Fetches model configuration from Supabase with caching.
 * Falls back to local models when offline or on fetch failure.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { REPLICATE_MODEL_REGISTRY } from '@/app/config/modelRegistry';

// Types for cloud model data
export type ModelCategory = 'image' | 'video';

export type ParamSchemaField = {
  type: 'select' | 'number' | 'boolean' | 'text' | 'slider';
  default: string | number | boolean | null;
  options?: (string | number | null)[];
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  description?: string;
};

export type ParamSchema = Record<string, ParamSchemaField>;

export interface CloudModel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: ModelCategory;
  tags: string[];
  replicateModelId: string | null;
  isActive: boolean;
  isNew: boolean;
  isFeatured: boolean;
  isPinned: boolean;
  categorySlugs: string[];
  sortOrder: number;
  referenceImagesMin: number;
  referenceImagesMax: number;
  supportsPrompt: boolean;
  paramSchema: ParamSchema;
  costCoins: number;
  iconUrl: string | null;
  heroImageUrl: string | null;
  tagline: string | null;
  longDescription: string | null;
  imageParameterName: string | null;
  createdAt: string;
  updatedAt: string;
}

// Cache configuration
const CACHE_KEY = '@cloud_models_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for testing (was 1 hour)

interface CachedModelsData {
  models: CloudModel[];
  timestamp: number;
}

// In-memory cache for faster access
let memoryCache: CachedModelsData | null = null;

/**
 * Transform database row to CloudModel type
 */
function transformDbModel(row: any): CloudModel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: row.tags || [],
    replicateModelId: row.replicate_model_id,
    isActive: row.is_active,
    isNew: row.is_new,
    isFeatured: row.is_featured ?? false,
    isPinned: row.is_pinned ?? false,
    categorySlugs: row.category_slugs ?? [],
    sortOrder: row.sort_order,
    referenceImagesMin: row.reference_images_min || 0,
    referenceImagesMax: row.reference_images_max || 0,
    supportsPrompt: row.supports_prompt,
    paramSchema: row.param_schema || {},
    costCoins: row.cost_coins,
    iconUrl: row.icon_url,
    heroImageUrl: row.hero_image_url ?? null,
    tagline: row.tagline ?? null,
    longDescription: row.long_description ?? null,
    imageParameterName: row.image_parameter_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generate fallback models from local registry
 */
function generateFallbackModels(): CloudModel[] {
  const now = new Date().toISOString();
  return Object.entries(REPLICATE_MODEL_REGISTRY).map(([slug, config], index) => ({
    id: slug,
    slug,
    name: config.name,
    description: config.description,
    category: (config.category as ModelCategory) || 'image',
    tags: [],
    replicateModelId: null,
    isActive: true,
    isNew: false,
    isFeatured: false,
    isPinned: false,
    categorySlugs: [],
    sortOrder: index,
    referenceImagesMin: config.minReferenceImages || 0,
    referenceImagesMax: config.maxReferenceImages || 0,
    supportsPrompt: true,
    paramSchema: {},
    costCoins: 0,
    iconUrl: null,
    heroImageUrl: null,
    tagline: null,
    longDescription: null,
    imageParameterName: config.imageParameterName || null,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Fetch models from Supabase
 */
export async function fetchCloudModels(forceRefresh: boolean = false): Promise<CloudModel[]> {
  console.log('[CloudModels] fetchCloudModels called, forceRefresh:', forceRefresh);

  try {
    // Check memory cache first
    if (!forceRefresh && memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
      const cacheAge = Math.round((Date.now() - memoryCache.timestamp) / 1000);
      console.log(`[CloudModels] ✓ Using in-memory cache (${memoryCache.models.length} models, ${cacheAge}s old)`);
      return memoryCache.models;
    }

    // Check AsyncStorage cache
    if (!forceRefresh) {
      try {
        const cachedData = await AsyncStorage.getItem(CACHE_KEY);
        if (cachedData) {
          const parsed: CachedModelsData = JSON.parse(cachedData);
          if (Date.now() - parsed.timestamp < CACHE_TTL) {
            const cacheAge = Math.round((Date.now() - parsed.timestamp) / 1000);
            console.log(`[CloudModels] ✓ Using AsyncStorage cache (${parsed.models.length} models, ${cacheAge}s old)`);
            memoryCache = parsed;
            return parsed.models;
          } else {
            console.log('[CloudModels] AsyncStorage cache expired, fetching fresh data');
          }
        } else {
          console.log('[CloudModels] No AsyncStorage cache found');
        }
      } catch (cacheError) {
        console.warn('[CloudModels] ✗ Failed to read cache:', cacheError);
      }
    } else {
      console.log('[CloudModels] Force refresh requested, skipping cache');
    }

    // Fetch from database
    console.log('[CloudModels] 🔄 Fetching from Supabase database...');
    const startTime = Date.now();

    // Abort the fetch if it stalls — on flaky internet a Supabase request can
    // hang indefinitely without rejecting, which would otherwise leave the
    // home screen's loading state stuck. On abort we fall through to the
    // catch block below and serve stale cache / local fallback models.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    let data, error;
    try {
      ({ data, error } = await supabase
        .from('models')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .abortSignal(controller.signal));
    } finally {
      clearTimeout(timeoutId);
    }

    const fetchTime = Date.now() - startTime;
    console.log(`[CloudModels] Database query completed in ${fetchTime}ms`);

    if (error) {
      console.error('[CloudModels] ✗ Supabase error:', error.message);
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      console.warn('[CloudModels] ⚠ No models returned from database, using fallback');
      return generateFallbackModels();
    }

    // Transform to CloudModel type
    const models = data.map(transformDbModel);

    // Log model details
    console.log(`[CloudModels] ✓ Fetched ${models.length} models from Supabase:`);
    models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.slug}) - ${m.isNew ? '🆕 NEW' : ''} coins: ${m.costCoins}`);
    });

    // Update caches
    const cacheData: CachedModelsData = {
      models,
      timestamp: Date.now(),
    };

    memoryCache = cacheData;

    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log('[CloudModels] ✓ Cache saved to AsyncStorage');
    } catch (storageError) {
      console.warn('[CloudModels] ✗ Failed to save cache:', storageError);
    }

    console.log(`[CloudModels] ✓ Sync complete: ${models.length} models ready`);
    return models;

  } catch (error) {
    console.error('[CloudModels] ✗ Failed to fetch from database:', error);

    // Try to use stale cache if available
    if (memoryCache) {
      console.log(`[CloudModels] ⚠ Using stale memory cache (${memoryCache.models.length} models)`);
      return memoryCache.models;
    }

    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEY);
      if (cachedData) {
        const parsed: CachedModelsData = JSON.parse(cachedData);
        console.log(`[CloudModels] ⚠ Using stale AsyncStorage cache (${parsed.models.length} models)`);
        return parsed.models;
      }
    } catch {
      // Ignore cache read errors
    }

    console.log('[CloudModels] ⚠ No cache available, using local fallback models');
    const fallback = generateFallbackModels();
    console.log(`[CloudModels] Fallback: ${fallback.length} local models`);
    return fallback;
  }
}

/**
 * Get models filtered by category
 */
export async function getModelsByCategory(category: ModelCategory): Promise<CloudModel[]> {
  const models = await fetchCloudModels();
  return models.filter(m => m.category === category);
}

/**
 * Get models filtered by tags
 */
export async function getModelsByTags(tags: string[]): Promise<CloudModel[]> {
  const models = await fetchCloudModels();
  if (tags.length === 0 || tags.includes('all')) {
    return models;
  }
  return models.filter(m => tags.some(tag => m.tags.includes(tag)));
}

/**
 * Get a single model by slug
 */
export async function getModelBySlug(slug: string): Promise<CloudModel | undefined> {
  const models = await fetchCloudModels();
  return models.find(m => m.slug === slug);
}

/**
 * Get image models only
 */
export async function getImageModels(): Promise<CloudModel[]> {
  return getModelsByCategory('image');
}

/**
 * Get video models only
 */
export async function getVideoModels(): Promise<CloudModel[]> {
  return getModelsByCategory('video');
}

/**
 * Invalidate models cache (force refresh on next fetch)
 */
export async function invalidateModelsCache(): Promise<void> {
  console.log('[CloudModels] 🗑️ Invalidating cache...');
  try {
    memoryCache = null;
    await AsyncStorage.removeItem(CACHE_KEY);
    console.log('[CloudModels] ✓ Cache invalidated successfully');
  } catch (error) {
    console.warn('[CloudModels] ✗ Failed to invalidate cache:', error);
  }
}

/**
 * Preload models cache (call on app launch)
 */
export async function preloadModelsCache(): Promise<void> {
  try {
    await fetchCloudModels();
    console.log('[CloudModels] Cache preloaded');
  } catch (error) {
    console.warn('[CloudModels] Failed to preload cache:', error);
  }
}

/**
 * Check if models are cached
 */
export function isModelsCached(): boolean {
  return memoryCache !== null && Date.now() - memoryCache.timestamp < CACHE_TTL;
}

/**
 * Get cached models synchronously (returns empty array if not cached)
 */
export function getCachedModels(): CloudModel[] {
  if (memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
    return memoryCache.models;
  }
  return [];
}

/**
 * Get cached model by slug synchronously (returns undefined if not cached)
 */
export function getCachedModelBySlug(slug: string): CloudModel | undefined {
  const models = getCachedModels();
  return models.find(m => m.slug === slug);
}
