/**
 * Hook to fetch and cache model pricing from the backend
 *
 * @deprecated This hook is deprecated in favor of using lib/pricing.ts functions directly.
 * Use fetchModelPricing(), getModelCoinCostAsync(), formatModelPriceAsync() instead.
 *
 * Returns pricing in the appropriate format based on whether the user
 * has a custom API key (BYOK).
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface ModelPricingData {
  id: string;
  name: string;
  priceInCents: number;
  priceUSD: string;
  coinCost: number;
}

interface PricingResponse {
  models: Record<string, ModelPricingData>;
  lastUpdated: string;
}

let cachedPricing: PricingResponse | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch model pricing from the backend
 */
async function fetchModelPricing(): Promise<PricingResponse | null> {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedPricing && (now - lastFetchTime) < CACHE_DURATION) {
      return cachedPricing;
    }

    // Fetch from edge function (v2 - database-driven)
    const { data, error } = await supabase.functions.invoke('get-model-pricing-v2');

    if (error) {
      console.error('Error fetching model pricing:', error);
      return cachedPricing; // Return stale cache on error
    }

    // Transform v2 format to legacy format
    const pricingArray = Array.isArray(data?.data) ? data.data : [data?.data].filter(Boolean);
    const models: Record<string, ModelPricingData> = {};

    for (const item of pricingArray) {
      if (item) {
        models[item.model_id] = {
          id: item.model_id,
          name: item.model_id, // v2 doesn't include name, using id as fallback
          priceInCents: item.price_in_cents,
          priceUSD: `$${(item.price_in_cents / 100).toFixed(2)}`,
          coinCost: item.coin_cost,
        };
      }
    }

    const transformedData: PricingResponse = {
      models,
      lastUpdated: data?.timestamp || new Date().toISOString(),
    };

    // Update cache
    cachedPricing = transformedData;
    lastFetchTime = now;

    return transformedData;
  } catch (error) {
    console.error('Error fetching model pricing:', error);
    return cachedPricing; // Return stale cache on error
  }
}

/**
 * Hook to get model pricing data
 * @param hasCustomKey - Whether the user has their own API key
 */
export function useModelPricing(hasCustomKey: boolean = false) {
  const [pricing, setPricing] = useState<Record<string, ModelPricingData> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadPricing = async () => {
      setIsLoading(true);
      try {
        const data = await fetchModelPricing();
        if (mounted && data) {
          setPricing(data.models);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadPricing();

    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Get formatted price for a specific model
   */
  const getModelPrice = (modelId: string): string => {
    if (!pricing || !pricing[modelId]) {
      return hasCustomKey ? '$0.000' : '1 🪙';
    }

    const model = pricing[modelId];
    return hasCustomKey ? model.priceUSD : `${model.coinCost} 🪙`;
  };

  /**
   * Get raw pricing data for a model
   */
  const getModelPricingData = (modelId: string): ModelPricingData | null => {
    if (!pricing || !pricing[modelId]) {
      return null;
    }
    return pricing[modelId];
  };

  /**
   * Get price with context (e.g., "$0.008 per image")
   */
  const getModelPriceWithContext = (
    modelId: string,
    context: string = 'per generation'
  ): string => {
    const price = getModelPrice(modelId);
    return `${price} ${context}`;
  };

  return {
    pricing,
    isLoading,
    error,
    getModelPrice,
    getModelPricingData,
    getModelPriceWithContext,
  };
}

/**
 * Manually refresh the pricing cache (e.g., after adding a new model)
 */
export async function refreshPricingCache(): Promise<void> {
  lastFetchTime = 0;
  cachedPricing = null;
  await fetchModelPricing();
}
