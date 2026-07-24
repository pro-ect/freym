/**
 * useImagePrefetch Hook
 *
 * Intelligent prefetching of images before they're needed
 */

import { useEffect } from 'react';
import { imageManager } from '../../lib/imageManager';

/**
 * Prefetch images by IDs
 *
 * @param ids - Array of image IDs to prefetch
 * @param enabled - Whether prefetching is enabled (default: true)
 */
export function useImagePrefetch(ids: string[], enabled = true) {
  useEffect(() => {
    if (!enabled || ids.length === 0) {
      return;
    }

    let mounted = true;

    const prefetch = async () => {
      try {
        await imageManager.prefetchImages(ids);
      } catch (error) {
        console.warn('Failed to prefetch images:', error);
      }
    };

    if (mounted) {
      prefetch();
    }

    return () => {
      mounted = false;
    };
  }, [ids, enabled]);
}

/**
 * Prefetch next page of images in a paginated list
 *
 * Useful for FlatList/ScrollView to preload upcoming images
 *
 * @param allIds - All image IDs in the list
 * @param currentIndex - Current visible index
 * @param prefetchWindow - Number of images ahead to prefetch (default: 10)
 */
export function useIntelligentPrefetch(
  allIds: string[],
  currentIndex: number,
  prefetchWindow = 10
) {
  useEffect(() => {
    if (allIds.length === 0 || currentIndex < 0) {
      return;
    }

    const startIndex = currentIndex + 1;
    const endIndex = Math.min(startIndex + prefetchWindow, allIds.length);
    const idsToPrefe = allIds.slice(startIndex, endIndex);

    if (idsToPrefe.length > 0) {
      imageManager.prefetchImages(idsToPrefe).catch((error) => {
        console.warn('Failed to intelligently prefetch:', error);
      });
    }
  }, [allIds, currentIndex, prefetchWindow]);
}
