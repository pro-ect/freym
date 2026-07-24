/**
 * useImageCleanup Hook
 *
 * Automatic cache cleanup on app startup and maintenance
 */

import { useEffect, useState } from 'react';
import { imageManager } from '../../lib/imageManager';
import type { CacheStats } from '../../lib/types';

/**
 * Run cache cleanup on mount
 *
 * @param daysOld - Delete images not accessed in this many days (default: 30)
 * @param runOnMount - Whether to run cleanup on mount (default: true)
 */
export function useImageCleanup(daysOld = 30, runOnMount = true) {
  const [deletedCount, setDeletedCount] = useState(0);
  const [cleaning, setCleaning] = useState(false);

  const cleanup = async () => {
    try {
      setCleaning(true);
      const count = await imageManager.clearOldCache(daysOld);
      setDeletedCount(count);
      return count;
    } catch (error) {
      console.error('Failed to cleanup old cache:', error);
      return 0;
    } finally {
      setCleaning(false);
    }
  };

  useEffect(() => {
    if (runOnMount) {
      cleanup();
    }
  }, []);

  return {
    deletedCount,
    cleaning,
    cleanup,
  };
}

/**
 * Get cache statistics
 */
export function useCacheStats() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const cacheStats = await imageManager.getCacheStats();
      setStats(cacheStats);
    } catch (error) {
      console.error('Failed to get cache stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return {
    stats,
    loading,
    refresh,
  };
}

/**
 * Clear expo-image memory and disk caches
 */
export function useClearCache() {
  const [clearing, setClearing] = useState(false);

  const clearCache = async () => {
    try {
      setClearing(true);
      await imageManager.clearExpoImageCache();
    } catch (error) {
      console.error('Failed to clear expo-image cache:', error);
    } finally {
      setClearing(false);
    }
  };

  return {
    clearing,
    clearCache,
  };
}
