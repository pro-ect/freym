import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { imageManager } from '../lib/imageManager';
import type { ImageRecord } from '../lib/types';
import { queueManager } from '../lib/queue/queueManager';
import {
  libraryStateManager,
  type LibraryImage,
  type LibraryImageStatus,
  type FavoriteSyncStatus,
  PROCESSING_STATUSES,
  isProcessingStatus,
  sortLibraryImages
} from '../lib/library/libraryStateManager';
import { supabase } from '../lib/supabase';

// Re-export types for backward compatibility
export type { LibraryImageStatus, LibraryImage, FavoriteSyncStatus };
export { PROCESSING_STATUSES, isProcessingStatus };

const PROCESSING_STATUS_SET = new Set(PROCESSING_STATUSES);

const PAGE_SIZE = 60;
const TEMP_IMAGE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const STALE_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes (reduced from 30)
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for downloads specifically
const ABSOLUTE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour - beyond this, don't check queue, just mark as failed

// All helper functions moved to LibraryStateManager

interface LibraryContextType {
  images: LibraryImage[];
  addImage: (image: Omit<LibraryImage, 'id' | 'createdAt'>) => Promise<string>;
  updateImage: (id: string, updates: Partial<LibraryImage>) => void;
  deleteImage: (id: string) => void;
  clearLibrary: () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  cleanupStuckJobs: () => Promise<{ failed: number; completed: number }>;
  toggleFavorite: (id: string) => Promise<void>;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (show: boolean) => void;
  hasMore: boolean;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  // State from LibraryStateManager
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadedDbCount, setLoadedDbCount] = useState(0);

  // Favorites filter
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Loading states (managed locally since not in state manager)
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Initialize and subscribe to LibraryStateManager
  useEffect(() => {
    let mounted = true;

    const initializeManager = async () => {
      try {
        setIsLoadingInitial(true);
        await libraryStateManager.initialize();

        if (mounted) {
          setIsLoadingInitial(false);
        }
      } catch (error) {
        console.error('❌ LibraryContext: Failed to initialize state manager:', error);
        if (mounted) {
          setIsLoadingInitial(false);
        }
      }
    };

    // Subscribe to state manager
    const unsubscribe = libraryStateManager.subscribe((state) => {
      if (!mounted) return;

      console.log(`📚 LibraryContext: State update from manager (${state.images.length} images)`);
      setImages(state.images);
      setIsLoaded(state.isLoaded);
      setHasMore(state.hasMore);
      setLoadedDbCount(state.loadedCount);
    });

    // Initialize
    initializeManager();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Listen to auth state changes and reload library on sign-in
  // NOTE: Do NOT clear library on SIGNED_OUT — Supabase fires SIGNED_OUT on token
  // refresh failures (e.g. guest session expiry on app restart), which would
  // permanently destroy all library records before the user even sees the app.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Reload library when user signs in (handles user switching)
        libraryStateManager.refresh().catch((error) => {
          console.error('❌ LibraryContext: Failed to refresh library on sign-in:', error);
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Debounce refresh to prevent multiple rapid calls
  const lastRefreshRef = useRef<number>(0);
  const refreshInProgressRef = useRef<boolean>(false);

  // Delegate refresh to state manager
  // NOTE: Force reload queue to fix stuck Realtime issues
  const refreshLibrary = useCallback(async () => {
    // Debounce: Skip if refreshed within last 500ms or refresh in progress
    const now = Date.now();
    if (now - lastRefreshRef.current < 500 || refreshInProgressRef.current) {
      console.log('🔄 LibraryContext: REFRESH SKIPPED (debounced)');
      return;
    }

    lastRefreshRef.current = now;
    refreshInProgressRef.current = true;

    console.log('🔄 LibraryContext: REFRESH TRIGGERED - delegating to state manager');
    try {
      // CRITICAL: Force reload queue from database to fix stuck jobs
      await libraryStateManager.refresh(true); // true = force reload queue
      console.log('🔄 LibraryContext: REFRESH COMPLETE');
    } catch (error) {
      console.error('❌ LibraryContext: Refresh failed:', error);
    } finally {
      refreshInProgressRef.current = false;
    }
  }, []);

  // Delegate loadMore to state manager
  const loadMoreImages = useCallback(async () => {
    if (isLoadingMore || !hasMore) {
      return;
    }

    try {
      setIsLoadingMore(true);
      await libraryStateManager.loadMore();
    } catch (error) {
      console.error('❌ LibraryContext: Load more failed:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore]);

  // Delegate addImage to state manager
  const addImage = useCallback(async (image: Omit<LibraryImage, 'id' | 'createdAt'>) => {
    try {
      const id = await libraryStateManager.addImage(image);
      console.log('✅ LibraryContext: Image added via state manager:', id);
      return id;
    } catch (error) {
      console.error('❌ LibraryContext: Failed to add image:', error);
      throw error;
    }
  }, []);

  // Delegate updateImage to state manager
  const updateImage = useCallback((id: string, updates: Partial<LibraryImage>) => {
    console.log(`🔄 LibraryContext: Delegating updateImage to state manager (id: ${id})`);
    libraryStateManager.updateImage(id, updates);
  }, []);

  // Delegate deleteImage to state manager
  const deleteImage = useCallback(async (id: string) => {
    await libraryStateManager.deleteImage(id);
  }, []);

  // Delegate clearLibrary to state manager
  const clearLibrary = useCallback(async () => {
    await libraryStateManager.clearLibrary();
  }, []);

  // Delegate toggleFavorite to state manager
  const toggleFavorite = useCallback(async (id: string) => {
    await libraryStateManager.toggleFavorite(id);
  }, []);

  // Filter images based on favorites toggle, then funnel through the canonical
  // sort so every consumer of the library gets one deterministic ordering.
  const displayImages = useMemo(() => {
    const filtered = showFavoritesOnly
      ? images.filter(img => img.isFavorite)
      : images;
    return sortLibraryImages(filtered);
  }, [images, showFavoritesOnly]);

  const cleanupStuckJobs = useCallback(async (): Promise<{ failed: number; completed: number }> => {
    console.log('🧹 Starting cleanup of stuck jobs...');

    try {
      await imageManager.initialize();
      await queueManager.initialize();

      // FIRST: Download all completed jobs that don't have localUri yet
      console.log('🧹 Step 1: Downloading all completed jobs without localUri...');
      const downloadStats = await queueManager.downloadAllCompletedJobs();
      console.log(`✅ Download queue stats: ${downloadStats.queued} queued, ${downloadStats.alreadyDownloaded} already downloaded`);

      // Get ALL library images from database
      const allRecords = await imageManager.getImagesByType('library');
      // Skip validation during cleanup for speed
      const allLibraryImages = await Promise.all(
        allRecords.map(r => mapRecordToLibraryImage(r, { skipValidation: true }))
      );

      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Find processing jobs that are less than 24 hours old
      const processingJobs = allLibraryImages.filter((img) => {
        if (!isProcessingStatus(img.status)) return false;

        // Skip jobs older than 24 hours - don't clean them up
        if (now - img.createdAt > oneDayMs) {
          return false;
        }

        return true;
      });

      console.log(`🔍 Found ${processingJobs.length} jobs in processing states (within 24h)`);

      let failedCount = 0;
      let completedCount = 0;

      for (const img of processingJobs) {
        const jobAge = now - img.createdAt;

        // Jobs older than 1 hour are definitely done - don't check queue, just mark as failed
        if (jobAge > ABSOLUTE_TIMEOUT_MS) {
          console.log(`❌ Cleanup: Job older than 1 hour (${Math.round(jobAge / (60 * 1000))} min), marking as failed: ${img.id}`);
          await imageManager.updateImage(img.id, {
            metadata: {
              ...img.metadata,
              status: 'failed',
              error: 'Generation timed out (>1 hour). Please retry.',
            },
          });
          updateImage(img.id, {
            status: 'failed',
            error: 'Generation timed out (>1 hour). Please retry.',
          });
          failedCount++;
          continue;
        }

        // Check if job is stale based on status-specific timeout
        const isStale = (img.status === 'downloading' || img.status === 'saving')
          ? jobAge > DOWNLOAD_TIMEOUT_MS
          : jobAge > STALE_PROCESSING_THRESHOLD_MS;

        if (!isStale) {
          continue; // Skip non-stale jobs
        }

        const queueJobId = img.queueJobId || img.metadata?.queueJobId;

        if (queueJobId) {
          // Check if job exists in queue
          const job = queueManager.getJob(queueJobId);

          if (!job) {
            // Job doesn't exist in queue - mark as failed
            console.log(`❌ Cleanup: Job not found in queue, marking as failed: ${img.id}`);
            await imageManager.updateImage(img.id, {
              metadata: {
                ...img.metadata,
                status: 'failed',
                error: 'Job not found in queue. Please retry.',
              },
            });
            updateImage(img.id, {
              status: 'failed',
              error: 'Job not found in queue. Please retry.',
            });
            failedCount++;
          } else if (job.status === 'failed') {
            // Job failed - update library
            console.log(`❌ Cleanup: Job failed in queue, updating library: ${img.id}`);
            await imageManager.updateImage(img.id, {
              metadata: {
                ...img.metadata,
                status: 'failed',
                error: job.errorMessage || 'Generation failed',
              },
            });
            updateImage(img.id, {
              status: 'failed',
              error: job.errorMessage || 'Generation failed',
            });
            failedCount++;
          } else if (job.status === 'completed' && job.localUri) {
            // Job completed - update library
            console.log(`✅ Cleanup: Job completed, updating library: ${img.id}`);
            await imageManager.updateImage(img.id, {
              localUri: job.localUri,
              metadata: {
                ...img.metadata,
                status: 'completed',
                completedAt: Date.now(),
              },
            });
            updateImage(img.id, {
              status: 'completed',
              transformedImageUrl: job.localUri,
              completedAt: Date.now(),
            });
            completedCount++;
          } else {
            // Job still processing - keep it alive
            console.log(`⏳ Cleanup: Job still processing, keeping alive: ${img.id}`);
          }
        } else {
          // No queue job ID - this is an old/orphaned job, mark as failed
          console.log(`❌ Cleanup: No queue job ID, marking as failed: ${img.id}`);
          await imageManager.updateImage(img.id, {
            metadata: {
              ...img.metadata,
              status: 'failed',
              error: 'Orphaned job (no queue ID). Please retry.',
            },
          });
          updateImage(img.id, {
            status: 'failed',
            error: 'Orphaned job (no queue ID). Please retry.',
          });
          failedCount++;
        }
      }

      console.log(`🧹 Cleanup complete: ${failedCount} failed, ${completedCount} completed`);
      return { failed: failedCount, completed: completedCount };
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }, [updateImage]);

  return (
    <LibraryContext.Provider
      value={{
        images: displayImages,
        addImage,
        updateImage,
        deleteImage,
        clearLibrary,
        refresh: refreshLibrary,
        loadMore: loadMoreImages,
        cleanupStuckJobs,
        toggleFavorite,
        showFavoritesOnly,
        setShowFavoritesOnly,
        hasMore,
        isLoadingInitial,
        isLoadingMore,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within LibraryProvider');
  }
  return context;
}
