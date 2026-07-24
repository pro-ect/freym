/**
 * ⚠️  FALLBACK ONLY - DO NOT ADD NEW PRICING HERE  ⚠️
 *
 * SINGLE SOURCE OF TRUTH: Supabase `model_pricing` table
 * See: docs/.adding-new-model.md
 *
 * This module fetches pricing from Supabase with caching.
 * The hardcoded FALLBACK_MODEL_PRICING below is ONLY used when:
 * - Supabase is unreachable
 * - Network is offline
 * - Database fetch fails
 *
 * All new model pricing should be added to Supabase:
 * - Table: `model_pricing`
 * - Fields: model_id, price_in_cents, coin_cost, is_active
 *
 * Formula: coin_cost = price_in_cents * 5
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export interface ModelPricing {
  id: string;
  priceInCents: number; // Price in cents per generation
  coinCost: number; // Calculated: priceInCents * 5
  pricePerSecondCents?: number | null; // Per-second price for video models (undefined/null for image models)
  audioPricePerSecondCents?: number | null; // Per-second price when audio is enabled (null = use pricePerSecondCents)
  pricePerMegapixelCents?: number | null; // Per-megapixel price for image models (e.g., Z-Image $0.005/MP = 0.5 cents)
}

/**
 * @deprecated Hardcoded pricing is deprecated. Use fetchModelPricing() to get up-to-date pricing from database.
 * This constant is kept only as a fallback for offline mode.
 * Scheduled for removal in next major version.
 */
// Hardcoded fallback pricing (used when fetch fails or offline)
const FALLBACK_MODEL_PRICING: Record<string, ModelPricing> = {
  // Replicate models - Source: replicate.com model pages
  'nano-banana': {
    id: 'nano-banana',
    priceInCents: 3.9, // $0.039 per run (3.9 cents) - Verified from replicate.com
    coinCost: 20, // 3.9 * 5 = 19.5, rounded to 20 coins
  },
  'nano-banana-fal': {
    id: 'nano-banana-fal',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Fal.ai version
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'nano-banana-pro-2k': {
    id: 'nano-banana-pro-2k',
    priceInCents: 14.0, // $0.14 per run (14 cents) - 2K resolution
    coinCost: 70, // 14 * 5 = 70 coins
  },
  'nano-banana-pro-2k-fal': {
    id: 'nano-banana-pro-2k-fal',
    priceInCents: 15.0, // $0.15 per run (15 cents) - Fal.ai 2K version
    coinCost: 75, // 15 * 5 = 75 coins
  },
  'nano-banana-pro-4k': {
    id: 'nano-banana-pro-4k',
    priceInCents: 24.0, // $0.24 per run (24 cents) - 4K resolution
    coinCost: 120, // 24 * 5 = 120 coins
  },
  'nano-banana-pro-4k-fal': {
    id: 'nano-banana-pro-4k-fal',
    priceInCents: 30.0, // $0.30 per run (30 cents) - Fal.ai 4K version
    coinCost: 150, // 30 * 5 = 150 coins
  },
  'reve-edit': {
    id: 'reve-edit',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Verified from replicate.com
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'reve-fal': {
    id: 'reve-fal',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Fal.ai version
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'reve-create': {
    id: 'reve-create',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Similar to reve-edit
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'reve-remix': {
    id: 'reve-remix',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Similar to reve-edit
    coinCost: 20, // 4 * 5 = 20 coins
  },
  // Fal.ai specific models
  'seedream-4.5-fal': {
    id: 'seedream-4.5-fal',
    priceInCents: 3.0, // $0.03 per run (3 cents)
    coinCost: 15, // 3 * 5 = 15 coins
  },
  'flux-2-pro-fal': {
    id: 'flux-2-pro-fal',
    priceInCents: 10.0, // $0.10 per run (10 cents)
    coinCost: 50, // 10 * 5 = 50 coins
  },
  'kling-image-o1-fal': {
    id: 'kling-image-o1-fal',
    priceInCents: 4.0, // $0.04 per run (4 cents)
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'flux-kontext-multi-4': {
    id: 'flux-kontext-multi-4',
    priceInCents: 0.5, // $0.005 per run (0.5 cents) - FLUX Kontext pricing
    coinCost: 3, // 0.5 * 5 = 2.5, rounded to 3 coins
  },
  'flux-kontext-pro': {
    id: 'flux-kontext-pro',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Black Forest Labs FLUX Kontext Pro
    coinCost: 20, // 4 * 5 = 20 coins
  },

  // BytePlus Ark - Seedream - Source: BytePlus official pricing
  'seedream': {
    id: 'seedream',
    priceInCents: 3.0, // $0.03 per generation (3 cents) - Verified BytePlus pricing
    coinCost: 15, // 3 * 5 = 15 coins
  },

  // Face swap models
  'face-swap': {
    id: 'face-swap',
    priceInCents: 1.0, // $0.01 per run (1 cent)
    coinCost: 5, // 1 * 5 = 5 coins
  },

  // Video models
  'minimax-video': {
    id: 'minimax-video',
    priceInCents: 10.0, // $0.10 per generation (10 cents)
    coinCost: 50, // 10 * 5 = 50 coins
    pricePerSecondCents: null, // Flat rate model
  },
  'kling-video': {
    id: 'kling-video',
    priceInCents: 10.0, // $0.10 per generation (10 cents)
    coinCost: 50, // 10 * 5 = 50 coins
    pricePerSecondCents: null, // Flat rate model
  },
  // New video models (per-second pricing, calculated for 5s default)
  'kling-v2.5-turbo-pro': {
    id: 'kling-v2.5-turbo-pro',
    priceInCents: 35.0, // $0.07/sec * 5s = $0.35 (35 cents)
    coinCost: 175, // 35 * 5 = 175 coins
    pricePerSecondCents: 7.0, // $0.07/sec
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    priceInCents: 80.0, // $0.10/sec * 8s = $0.80 (80 cents) - without audio
    coinCost: 400, // 80 * 5 = 400 coins
    pricePerSecondCents: 10.0, // $0.10/sec without audio
    audioPricePerSecondCents: 15.0, // $0.15/sec with audio
  },
  'seedance-1-pro-fast': {
    id: 'seedance-1-pro-fast',
    priceInCents: 30.0, // $0.06/sec * 5s = $0.30 (30 cents) at 1080p
    coinCost: 150, // 30 * 5 = 150 coins
    pricePerSecondCents: 6.0, // $0.06/sec
  },
  'pixverse-v5': {
    id: 'pixverse-v5',
    priceInCents: 40.0, // $0.40 for 5s at 720p normal
    coinCost: 200, // 40 * 5 = 200 coins
    pricePerSecondCents: 8.0, // $0.08/sec
  },

  // Image generation models (Ideogram, Runway Gen-4, etc)
  'ideogram-v3': {
    id: 'ideogram-v3',
    priceInCents: 0.8, // $0.008 per run (0.8 cents)
    coinCost: 4, // 0.8 * 5 = 4 coins
  },
  'ideogram-v3-balanced': {
    id: 'ideogram-v3-balanced',
    priceInCents: 0.8, // $0.008 per run (0.8 cents)
    coinCost: 4, // 0.8 * 5 = 4 coins
  },
  'ideogram-character': {
    id: 'ideogram-character',
    priceInCents: 0.8, // $0.008 per run (0.8 cents)
    coinCost: 4, // 0.8 * 5 = 4 coins
  },
  'gen4-image': {
    id: 'gen4-image',
    priceInCents: 5.0, // $0.05 per run (5 cents) - Runway Gen-4
    coinCost: 25, // 5 * 5 = 25 coins
  },
  'imagen-4': {
    id: 'imagen-4',
    priceInCents: 4.0, // $0.04 per run (4 cents) - Google Imagen 4
    coinCost: 20, // 4 * 5 = 20 coins
  },
  'qwen-image-edit-plus': {
    id: 'qwen-image-edit-plus',
    priceInCents: 0.8, // $0.008 per run (0.8 cents) - Qwen Image Edit Plus
    coinCost: 4, // 0.8 * 5 = 4 coins
  },

  // Tools models (upscaling, background removal)
  'background-remover': {
    id: 'background-remover',
    priceInCents: 1.0, // $0.01 per run (1 cent)
    coinCost: 5, // 1 * 5 = 5 coins
  },
  'real-esrgan': {
    id: 'real-esrgan',
    priceInCents: 1.0, // $0.01 per run (1 cent)
    coinCost: 5, // 1 * 5 = 5 coins
  },
  'topaz-image-upscale': {
    id: 'topaz-image-upscale',
    priceInCents: 5.0, // $0.05 per run (5 cents) - Premium upscaling
    coinCost: 25, // 5 * 5 = 25 coins
  },
  'crystal-upscaler': {
    id: 'crystal-upscaler',
    priceInCents: 2.0, // $0.02 per run (2 cents)
    coinCost: 10, // 2 * 5 = 10 coins
  },
};

// Cache configuration
const CACHE_KEY = '@model_pricing_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

interface CachedPricingData {
  pricing: Record<string, ModelPricing>;
  timestamp: number;
}

// In-memory cache for faster access
let memoryCache: CachedPricingData | null = null;

/**
 * Fetch model pricing from database
 * @param forceRefresh - Force refresh cache even if not expired
 * @returns Record of model pricing
 */
export async function fetchModelPricing(forceRefresh: boolean = false): Promise<Record<string, ModelPricing>> {
  try {
    // Check memory cache first
    if (!forceRefresh && memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
      console.log('📦 Using in-memory pricing cache');
      return memoryCache.pricing;
    }

    // Check AsyncStorage cache
    if (!forceRefresh) {
      try {
        const cachedData = await AsyncStorage.getItem(CACHE_KEY);
        if (cachedData) {
          const parsed: CachedPricingData = JSON.parse(cachedData);
          if (Date.now() - parsed.timestamp < CACHE_TTL) {
            console.log('📦 Using AsyncStorage pricing cache');
            memoryCache = parsed;
            return parsed.pricing;
          }
        }
      } catch (cacheError) {
        console.warn('Failed to read pricing cache:', cacheError);
      }
    }

    // Fetch from database
    console.log('🌐 Fetching pricing from database...');
    const { data, error } = await supabase.functions.invoke('get-model-pricing-v2', {
      method: 'GET',
    });

    if (error || !data?.success || !data?.data) {
      throw new Error(error?.message || 'Failed to fetch pricing from database');
    }

    // Transform database format to our format
    const pricingArray = Array.isArray(data.data) ? data.data : [data.data];
    const pricingRecord: Record<string, ModelPricing> = {};

    for (const item of pricingArray) {
      pricingRecord[item.model_id] = {
        id: item.model_id,
        priceInCents: item.price_in_cents,
        coinCost: item.coin_cost,
        pricePerSecondCents: item.price_per_second_cents ?? null,
        audioPricePerSecondCents: item.audio_price_per_second_cents ?? null,
        pricePerMegapixelCents: item.price_per_megapixel_cents ?? null,
      };
    }

    // Update caches
    const cacheData: CachedPricingData = {
      pricing: pricingRecord,
      timestamp: Date.now(),
    };

    memoryCache = cacheData;

    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (storageError) {
      console.warn('Failed to save pricing cache:', storageError);
    }

    console.log('✅ Pricing fetched and cached successfully');
    return pricingRecord;

  } catch (error) {
    console.error('Failed to fetch pricing from database, using fallback:', error);
    return FALLBACK_MODEL_PRICING;
  }
}

/**
 * Invalidate pricing cache (force refresh on next fetch)
 */
export async function invalidatePricingCache(): Promise<void> {
  try {
    memoryCache = null;
    await AsyncStorage.removeItem(CACHE_KEY);
    console.log('🗑️ Pricing cache invalidated');
  } catch (error) {
    console.warn('Failed to invalidate pricing cache:', error);
  }
}

/**
 * Get pricing data (from cache or fetch)
 */
async function getPricingData(): Promise<Record<string, ModelPricing>> {
  // Try to use memory cache first for synchronous operations
  if (memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
    return memoryCache.pricing;
  }

  // Otherwise fetch (this will update cache)
  return await fetchModelPricing();
}

/**
 * Get the coin cost for a model
 */
export async function getModelCoinCostAsync(modelId: string): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1; // Default to 1 coin if pricing not found
  }

  return Math.ceil(modelPricing.coinCost); // Always round up
}

/**
 * Get the coin cost for a model (synchronous version using fallback)
 * @deprecated Use getModelCoinCostAsync for up-to-date pricing
 */
export function getModelCoinCost(modelId: string): number {
  // Try memory cache first
  if (memoryCache) {
    const modelPricing = memoryCache.pricing[modelId];
    if (modelPricing) {
      return Math.ceil(modelPricing.coinCost);
    }
  }

  // Fall back to hardcoded values
  const pricing = FALLBACK_MODEL_PRICING[modelId];
  if (!pricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1; // Default to 1 coin if pricing not found
  }
  return Math.ceil(pricing.coinCost); // Always round up
}

/**
 * Get the price in cents for a model (for BYOK users)
 */
export async function getModelPriceInCentsAsync(modelId: string): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1; // Default to 1 cent if pricing not found
  }

  return modelPricing.priceInCents;
}

/**
 * Get the price in cents for a model (synchronous version using fallback)
 * @deprecated Use getModelPriceInCentsAsync for up-to-date pricing
 */
export function getModelPriceInCents(modelId: string): number {
  // Try memory cache first
  if (memoryCache) {
    const modelPricing = memoryCache.pricing[modelId];
    if (modelPricing) {
      return modelPricing.priceInCents;
    }
  }

  // Fall back to hardcoded values
  const pricing = FALLBACK_MODEL_PRICING[modelId];
  if (!pricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1; // Default to 1 cent if pricing not found
  }
  return pricing.priceInCents;
}

/**
 * Format price for display based on whether user has custom API key
 * @param modelId - The model ID
 * @param hasCustomKey - Whether the user has their own API key (BYOK)
 * @returns Formatted price string
 */
export async function formatModelPriceAsync(modelId: string, hasCustomKey: boolean): Promise<string> {
  if (hasCustomKey) {
    // BYOK users see actual USD price
    const cents = await getModelPriceInCentsAsync(modelId);
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars}`;
  } else {
    // Default key users see coin cost
    const cost = await getModelCoinCostAsync(modelId);
    return `${cost} 🪙`;
  }
}

/**
 * Format price for display (synchronous version using fallback)
 * @deprecated Use formatModelPriceAsync for up-to-date pricing
 */
export function formatModelPrice(modelId: string, hasCustomKey: boolean): string {
  if (hasCustomKey) {
    // BYOK users see actual USD price
    const cents = getModelPriceInCents(modelId);
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars}`;
  } else {
    // Default key users see coin cost
    const cost = getModelCoinCost(modelId);
    return `${cost} 🪙`;
  }
}

/**
 * Get formatted price with context (e.g., "$0.008 per image" or "4 🪙 per image")
 * @param modelId - The model ID
 * @param hasCustomKey - Whether the user has their own API key (BYOK)
 * @param context - Additional context (e.g., "per image", "per video")
 * @returns Formatted price string with context
 */
export async function formatModelPriceWithContextAsync(
  modelId: string,
  hasCustomKey: boolean,
  context: string = 'per generation'
): Promise<string> {
  const price = await formatModelPriceAsync(modelId, hasCustomKey);
  return `${price} ${context}`;
}

/**
 * Get formatted price with context (synchronous version)
 * @deprecated Use formatModelPriceWithContextAsync for up-to-date pricing
 */
export function formatModelPriceWithContext(
  modelId: string,
  hasCustomKey: boolean,
  context: string = 'per generation'
): string {
  const price = formatModelPrice(modelId, hasCustomKey);
  return `${price} ${context}`;
}

/**
 * Check if user has enough coins for a model
 */
export async function canAffordModelAsync(userBalance: number, modelId: string): Promise<boolean> {
  const cost = await getModelCoinCostAsync(modelId);
  return userBalance >= cost;
}

/**
 * Check if user has enough coins (synchronous version)
 * @deprecated Use canAffordModelAsync for up-to-date pricing
 */
export function canAffordModel(userBalance: number, modelId: string): boolean {
  const cost = getModelCoinCost(modelId);
  return userBalance >= cost;
}

/**
 * Format coin cost for display (legacy - use formatModelPrice instead)
 * @deprecated Use formatModelPrice(modelId, hasCustomKey) instead
 */
export function formatCoinCost(modelId: string): string {
  const cost = getModelCoinCost(modelId);
  return `${cost} 🪙`;
}

/**
 * Get per-second pricing for a video model
 * Returns null for image models or if pricing not available
 */
export async function getModelPricePerSecondAsync(modelId: string): Promise<number | null> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];
  return modelPricing?.pricePerSecondCents ?? null;
}

/**
 * Calculate coin cost for a video model based on duration
 * Falls back to base coin cost if per-second pricing not available
 * @param modelId - The model ID
 * @param durationSeconds - Video duration in seconds
 * @param withAudio - Whether audio generation is enabled (affects pricing for some models)
 */
export async function calculateVideoCoinCostAsync(
  modelId: string,
  durationSeconds: number,
  withAudio: boolean = false
): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1;
  }

  // Use per-second pricing if available
  if (modelPricing.pricePerSecondCents != null) {
    // Use audio pricing if enabled and available, otherwise use base per-second price
    const perSecondCents = (withAudio && modelPricing.audioPricePerSecondCents != null)
      ? modelPricing.audioPricePerSecondCents
      : modelPricing.pricePerSecondCents;

    // Calculate: price_per_second_cents * duration * 5 (coin multiplier)
    const totalCents = perSecondCents * durationSeconds;
    const coins = totalCents * 5;
    return Math.ceil(coins);
  }

  // Fall back to base coin cost
  return Math.ceil(modelPricing.coinCost);
}

/**
 * Calculate price in cents for a video model based on duration (for BYOK users)
 * Falls back to base price if per-second pricing not available
 * @param modelId - The model ID
 * @param durationSeconds - Video duration in seconds
 * @param withAudio - Whether audio generation is enabled (affects pricing for some models)
 */
export async function calculateVideoPriceInCentsAsync(
  modelId: string,
  durationSeconds: number,
  withAudio: boolean = false
): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1;
  }

  // Use per-second pricing if available
  if (modelPricing.pricePerSecondCents != null) {
    // Use audio pricing if enabled and available, otherwise use base per-second price
    const perSecondCents = (withAudio && modelPricing.audioPricePerSecondCents != null)
      ? modelPricing.audioPricePerSecondCents
      : modelPricing.pricePerSecondCents;

    return perSecondCents * durationSeconds;
  }

  // Fall back to base price
  return modelPricing.priceInCents;
}

/**
 * Format video price based on duration
 * @param modelId - The model ID
 * @param durationSeconds - Video duration in seconds
 * @param hasCustomKey - Whether the user has their own API key (BYOK)
 * @param withAudio - Whether audio generation is enabled (affects pricing for some models)
 */
export async function formatVideoPriceAsync(
  modelId: string,
  durationSeconds: number,
  hasCustomKey: boolean,
  withAudio: boolean = false
): Promise<string> {
  if (hasCustomKey) {
    const cents = await calculateVideoPriceInCentsAsync(modelId, durationSeconds, withAudio);
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars}`;
  } else {
    const coins = await calculateVideoCoinCostAsync(modelId, durationSeconds, withAudio);
    return `${coins} 🪙`;
  }
}

// ============== MEGAPIXEL PRICING (for Z-Image and similar) ==============

/**
 * Image size presets with dimensions
 */
export const IMAGE_SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  'Vertical 2K': { width: 1152, height: 2048 },
  'Vertical 4K': { width: 2304, height: 4096 },
  'Portrait 2K': { width: 1536, height: 2048 },
  'Portrait 4K': { width: 3072, height: 4096 },
  'Square 2K': { width: 2048, height: 2048 },
  'Square 4K': { width: 4096, height: 4096 },
  'Landscape 2K': { width: 2048, height: 1536 },
  'Landscape 4K': { width: 4096, height: 3072 },
  'Wide 2K': { width: 2048, height: 1152 },
  'Wide 4K': { width: 4096, height: 2304 },
  '1:1': { width: 2048, height: 2048 },
  '9:16': { width: 1152, height: 2048 },
  '16:9': { width: 2048, height: 1152 },
  '4:3': { width: 2048, height: 1536 },
  '3:4': { width: 1536, height: 2048 },
};

/**
 * Calculate megapixels from dimensions
 */
export function calculateMegapixels(width: number, height: number): number {
  return (width * height) / 1_000_000;
}

/**
 * Get dimensions from a size preset name
 */
export function getSizePresetDimensions(preset: string): { width: number; height: number } {
  return IMAGE_SIZE_PRESETS[preset] || { width: 2048, height: 2048 };
}

/**
 * Get per-megapixel pricing for an image model
 * Returns null for models without megapixel pricing
 */
export async function getModelPricePerMegapixelAsync(modelId: string): Promise<number | null> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];
  return modelPricing?.pricePerMegapixelCents ?? null;
}

/**
 * Calculate coin cost for an image model based on megapixels
 * Falls back to base coin cost if per-megapixel pricing not available
 * @param modelId - The model ID
 * @param sizePreset - Size preset name (e.g., "Vertical 2K", "9:16") or dimensions object
 */
export async function calculateImageCoinCostAsync(
  modelId: string,
  sizePreset: string | { width: number; height: number }
): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1;
  }

  // Use per-megapixel pricing if available
  if (modelPricing.pricePerMegapixelCents != null) {
    const dimensions = typeof sizePreset === 'string'
      ? getSizePresetDimensions(sizePreset)
      : sizePreset;

    const megapixels = calculateMegapixels(dimensions.width, dimensions.height);
    const totalCents = megapixels * modelPricing.pricePerMegapixelCents;
    const coins = totalCents * 5; // Coin multiplier
    return Math.ceil(coins);
  }

  // Fall back to base coin cost
  return Math.ceil(modelPricing.coinCost);
}

/**
 * Calculate price in cents for an image model based on megapixels (for BYOK users)
 * Falls back to base price if per-megapixel pricing not available
 */
export async function calculateImagePriceInCentsAsync(
  modelId: string,
  sizePreset: string | { width: number; height: number }
): Promise<number> {
  const pricing = await getPricingData();
  const modelPricing = pricing[modelId];

  if (!modelPricing) {
    console.warn(`No pricing found for model: ${modelId}`);
    return 1;
  }

  // Use per-megapixel pricing if available
  if (modelPricing.pricePerMegapixelCents != null) {
    const dimensions = typeof sizePreset === 'string'
      ? getSizePresetDimensions(sizePreset)
      : sizePreset;

    const megapixels = calculateMegapixels(dimensions.width, dimensions.height);
    return megapixels * modelPricing.pricePerMegapixelCents;
  }

  // Fall back to base price
  return modelPricing.priceInCents;
}

/**
 * Format image price based on size
 * @param modelId - The model ID
 * @param sizePreset - Size preset name or dimensions
 * @param hasCustomKey - Whether the user has their own API key (BYOK)
 */
export async function formatImagePriceAsync(
  modelId: string,
  sizePreset: string | { width: number; height: number },
  hasCustomKey: boolean
): Promise<string> {
  if (hasCustomKey) {
    const cents = await calculateImagePriceInCentsAsync(modelId, sizePreset);
    const dollars = (cents / 100).toFixed(3);
    return `$${dollars}`;
  } else {
    const coins = await calculateImageCoinCostAsync(modelId, sizePreset);
    return `${coins} 🪙`;
  }
}

/**
 * Check if a model uses megapixel pricing
 */
export async function usesMegapixelPricingAsync(modelId: string): Promise<boolean> {
  const pricePerMP = await getModelPricePerMegapixelAsync(modelId);
  return pricePerMP != null && pricePerMP > 0;
}

// ============== GPT IMAGE 2 PRICING (quality × resolution) ==============
//
// GPT Image 2 cost depends on BOTH the quality tier and the resolution.
// Prices below are Fal.ai's published per-image USD rates (verified Jun 2026).
// Portrait sizes (e.g. 768x1024) cost the same as their landscape twin, so we
// normalize by sorting dimensions (max×min) before lookup.
//
// ⚠️ This table is DUPLICATED in supabase/functions/start-prediction-fal/index.ts
//    (gptImage2CoinCost). Keep both in sync — the server value is authoritative.
const GPT_IMAGE_2_PRICE_USD: Record<string, { low: number; medium: number; high: number }> = {
  '1024x768':  { low: 0.005, medium: 0.037, high: 0.145 },
  '1024x1024': { low: 0.006, medium: 0.053, high: 0.211 },
  '1536x1024': { low: 0.005, medium: 0.042, high: 0.165 },
  '1920x1080': { low: 0.005, medium: 0.040, high: 0.158 },
  '2560x1440': { low: 0.007, medium: 0.056, high: 0.222 },
  '3840x2160': { low: 0.012, medium: 0.101, high: 0.401 },
};

/**
 * Coin cost for a single GPT Image 2 image, by quality + resolution.
 * Mirrors the server-side charge in start-prediction-fal. Returns PER-IMAGE
 * coins (caller multiplies by image count). 500 coins = $1 (5 coins per cent).
 */
export function gptImage2CoinCost(
  quality: string | undefined,
  imageSize: string | { width: number; height: number } | undefined,
): number {
  const q = (['low', 'medium', 'high'].includes(String(quality).toLowerCase())
    ? String(quality).toLowerCase()
    : 'high') as 'low' | 'medium' | 'high';

  // Resolve dimensions (default 1024x1024)
  let w = 1024;
  let h = 1024;
  if (typeof imageSize === 'string') {
    const m = imageSize.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (m) {
      w = parseInt(m[1], 10);
      h = parseInt(m[2], 10);
    }
  } else if (imageSize && imageSize.width && imageSize.height) {
    w = imageSize.width;
    h = imageSize.height;
  }

  const key = `${Math.max(w, h)}x${Math.min(w, h)}`;
  let tier = GPT_IMAGE_2_PRICE_USD[key];
  if (!tier) {
    // Unknown/custom size: pick the smallest tier whose MP >= requested (round up),
    // else the largest tier. Bounds undercharging on arbitrary dimensions.
    const mp = (w * h) / 1_000_000;
    const ordered = Object.entries(GPT_IMAGE_2_PRICE_USD)
      .map(([k, v]) => {
        const [a, b] = k.split('x').map(Number);
        return { v, mp: (a * b) / 1_000_000 };
      })
      .sort((x, y) => x.mp - y.mp);
    tier = (ordered.find((o) => o.mp >= mp) ?? ordered[ordered.length - 1]).v;
  }

  return Math.ceil(tier[q] * 500);
}

/**
 * @deprecated MODEL_PRICING is deprecated. Use fetchModelPricing() to get up-to-date pricing from database.
 * This export is kept only for backward compatibility and offline fallback.
 * Scheduled for removal in next major version.
 */
// Export fallback pricing for reference
export const MODEL_PRICING = FALLBACK_MODEL_PRICING;
