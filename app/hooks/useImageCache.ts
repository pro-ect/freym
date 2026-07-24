/**
 * useImageCache Hook
 *
 * Load images from cache with automatic prefetching
 */

import { useState, useEffect } from 'react';
import { imageManager } from '../../lib/imageManager';
import type { ImageRecord, ImageType, QueryOptions } from '../../lib/types';

interface UseImageCacheOptions extends QueryOptions {
  prefetch?: boolean; // Auto-prefetch images after loading
}

/**
 * Hook to load and cache images by type
 *
 * @param type - Image type to load
 * @param options - Query and prefetch options
 * @returns Object with images array, loading state, error, and refresh function
 */
export function useImageCache(type: ImageType, options: UseImageCacheOptions = {}) {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadImages = async () => {
    try {
      setLoading(true);
      setError(null);

      const records = await imageManager.getImagesByType(type, options);
      setImages(records);

      // Auto-prefetch if requested
      if (options.prefetch && records.length > 0) {
        const ids = records.slice(0, 20).map((r) => r.id); // Prefetch first 20
        imageManager.prefetchImages(ids).catch((err) => {
          console.warn('Failed to prefetch images:', err);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load images'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, [type, options.category, options.limit, options.offset]);

  return {
    images,
    loading,
    error,
    refresh: loadImages,
  };
}

/**
 * Hook to load a single image by ID
 */
export function useImage(id: string | undefined) {
  const [image, setImage] = useState<ImageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) {
      setImage(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);

        const record = await imageManager.getImage(id);
        if (mounted) {
          setImage(record);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to load image'));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [id]);

  return {
    image,
    loading,
    error,
  };
}
