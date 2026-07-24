/**
 * useCloudModels Hook
 *
 * React hook for consuming cloud model configuration.
 * Handles loading state, caching, and automatic refresh.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CloudModel,
  ModelCategory,
  fetchCloudModels,
  getModelsByCategory,
  getModelsByTags,
  getModelBySlug,
  invalidateModelsCache,
  isModelsCached,
  getCachedModels,
} from '@/lib/cloudModels';

interface UseCloudModelsOptions {
  category?: ModelCategory;
  tags?: string[];
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

interface UseCloudModelsResult {
  models: CloudModel[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  getModel: (slug: string) => CloudModel | undefined;
}

/**
 * Hook for fetching and managing cloud models
 */
export function useCloudModels(options: UseCloudModelsOptions = {}): UseCloudModelsResult {
  const {
    category,
    tags,
    autoRefresh = false,
    refreshInterval = 60 * 60 * 1000, // 1 hour default
  } = options;

  const [allModels, setAllModels] = useState<CloudModel[]>(() => getCachedModels());
  const [isLoading, setIsLoading] = useState(!isModelsCached());
  const [error, setError] = useState<Error | null>(null);

  // Fetch models
  const fetchModels = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setIsLoading(true);
      setError(null);
      const models = await fetchCloudModels(forceRefresh);
      setAllModels(models);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch models'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchModels(true);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchModels]);

  // Filter models based on options
  const models = useMemo(() => {
    let filtered = allModels;

    if (category) {
      filtered = filtered.filter(m => m.category === category);
    }

    if (tags && tags.length > 0 && !tags.includes('all')) {
      filtered = filtered.filter(m => tags.some(tag => m.tags.includes(tag)));
    }

    return filtered;
  }, [allModels, category, tags]);

  // Get single model by slug
  const getModel = useCallback((slug: string): CloudModel | undefined => {
    return allModels.find(m => m.slug === slug);
  }, [allModels]);

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchModels(true);
  }, [fetchModels]);

  return {
    models,
    isLoading,
    error,
    refresh,
    getModel,
  };
}

/**
 * Hook for fetching a single model by slug
 */
export function useCloudModel(slug: string | undefined) {
  const [model, setModel] = useState<CloudModel | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!slug) {
      setModel(undefined);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetch = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await getModelBySlug(slug);
        if (!cancelled) {
          setModel(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to fetch model'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetch();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { model, isLoading, error };
}

/**
 * Hook for image models only
 */
export function useImageModels() {
  return useCloudModels({ category: 'image' });
}

/**
 * Hook for video models only
 */
export function useVideoModels() {
  return useCloudModels({ category: 'video' });
}

/**
 * Hook for models filtered by tags
 */
export function useModelsByTags(tags: string[]) {
  return useCloudModels({ tags });
}
