/**
 * useCloudQueueGeneration Hook
 *
 * Integrates cloud queue with library job creation pattern
 * - Creates library entry immediately
 * - Starts cloud queue job
 * - Monitors job progress via Realtime
 * - Downloads result when complete
 * - Updates library with final image
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { useLibrary } from '../../contexts/LibraryContext';
import { useSettings } from '../../contexts/SettingsContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { queueManager } from '../../lib/queue/queueManager';
import { imageManager } from '../../lib/imageManager';
import type { QueueJob, RecheckResult } from '../../lib/queue/types';
import { showJobToast, saveGeneratedImage } from './useLibraryJobCreation';
import { getImageMetadata } from '../../lib/utils/imageUtils';
import { uploadImagesToStorage } from '../../lib/storage/imageUpload';
import { supabase } from '../../lib/supabase';
import { trackGenerationAndPromptRating } from '../../lib/appRating';
import { friendlyGenerationError } from '../../lib/generation/friendlyError';
import { gridCropInspireImage } from '../../lib/inspire/gridCropAndSave';
import { runGridCrop } from '../../lib/devTools/gridCrop';
import { libraryStateManager } from '../../lib/library/libraryStateManager';
import { capturePH } from '../../lib/posthog';
import { downloadMediaToCache } from '../../lib/utils/imageDownloader';

// How long to wait for the callback's result_urls on a completed server-crop
// job before cropping the grid locally instead (see handleServerCropJob).
const SERVER_CROP_LOCAL_FALLBACK_MS = 90 * 1000;

export interface CloudQueueGenerationOptions {
  // Required
  prompt: string;
  model: string;
  modelName: string;

  // Optional
  parameters?: Record<string, any>;
  originalImageUri?: string;
  inputImages?: string[];
  metadata?: Record<string, any>;

  // Model config from cloud (to avoid hardcoded lists)
  supportsPrompt?: boolean; // If false, skip prompt validation (tools models)

  // startServerCropJob only: false = single-image Copy Shot job (no 2x2
  // server crop; the result fills one tile via the standard queueJobId path).
  serverCrop?: boolean;

  // UI feedback
  showStartNotification?: boolean;
  showCompletionNotification?: boolean;
  useAlertForErrors?: boolean;
}

export function useCloudQueueGeneration() {
  const { addImage, updateImage } = useLibrary();
  const { autoSaveToLibrary } = useSettings();
  const { showPaywall } = usePaywall();
  const [activeJobs, setActiveJobs] = useState<Map<string, string>>(new Map()); // jobId -> libraryId
  const [processedJobs, setProcessedJobs] = useState<Set<string>>(new Set()); // Track which jobs we've already processed

  // Use refs to avoid stale closures
  const activeJobsRef = useRef(activeJobs);
  const processedJobsRef = useRef(processedJobs);
  // Synchronous in-flight guard: `processedJobs` is React state and only
  // becomes visible to the next subscription tick after re-render. Without
  // this ref, the queue subscription can re-enter handleJobUpdate (which
  // includes fire-and-forget gridCropInspireImage) several times before
  // setProcessedJobs lands, producing duplicate auto-cropped tiles.
  const inFlightJobsRef = useRef<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => {
    activeJobsRef.current = activeJobs;
  }, [activeJobs]);

  useEffect(() => {
    processedJobsRef.current = processedJobs;
  }, [processedJobs]);

  // Queue manager is a singleton - no need to initialize per hook
  // It's initialized once globally when the app starts

  // On mount, check for any completed jobs that need processing
  useEffect(() => {
    const processOrphanedJobs = async () => {
      try {
        const images = await imageManager.getAllImages();
        const pendingImages = images.filter(img =>
          img.metadata?.queueJobId &&
          img.metadata?.status === 'processing' &&
          img.metadata?.cloudQueue
        );

        if (pendingImages.length > 0) {
          // Get all jobs from queue manager
          const allJobs = queueManager.getAllJobs();

          for (const img of pendingImages) {
            const queueJobId = img.metadata.queueJobId;
            const job = allJobs.find(j => j.id === queueJobId);

            if (job && (job.status === 'completed' || job.status === 'failed') && job.localUri) {
              // Add to activeJobs and let the subscription handler process it
              setActiveJobs(prev => new Map(prev).set(job.id, img.id));
            }
          }
        }
      } catch (error) {
        console.error('❌ Error checking orphaned jobs:', error);
      }
    };

    // Run after a short delay to let queueManager initialize
    const timer = setTimeout(processOrphanedJobs, 1000);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Handle queue job updates
   */
  const handleJobUpdate = useCallback(async (job: QueueJob, libraryId: string) => {
    // CRITICAL FIX: If job is completed but has no localUri, trigger download
    if (job.status === 'completed' && job.resultUrl && !job.localUri && !job.isDownloading) {
      console.log(`📥 handleJobUpdate: Job ${job.id.substring(0, 8)} completed but no localUri - triggering download`);
      updateImage(libraryId, { status: 'downloading' });
      queueManager.downloadJobResult(job.id).catch(err => {
        console.error(`❌ Download failed for ${job.id.substring(0, 8)}:`, err);
      });
      return; // Will be called again when download completes
    }

    // Process completed jobs with localUri
    if (job.status === 'completed' && job.localUri && !job.isDownloading) {
      try {
        // Get output image dimensions
        const outputMetadata = await getImageMetadata(job.localUri);

        // Fetch existing metadata to preserve all fields
        const existingRecord = await imageManager.getImage(libraryId);
        const existingMetadata = existingRecord?.metadata || {};

        // Update database record with downloaded image
        // CRITICAL: Merge existing metadata to preserve prompt, parameters, etc.
        await imageManager.updateImage(libraryId, {
          localUri: job.localUri,
          metadata: {
            ...existingMetadata, // Preserve ALL existing metadata
            status: 'completed',
            completedAt: Date.now(),
            outputDimensions: outputMetadata ? {
              width: outputMetadata.width,
              height: outputMetadata.height,
              aspectRatio: outputMetadata.aspectRatio,
              fileSize: outputMetadata.fileSize,
              fileSizeFormatted: outputMetadata.fileSizeFormatted,
            } : undefined,
          },
        });

        // Update library context
        updateImage(libraryId, {
          status: 'completed',
          transformedImageUrl: job.localUri,
          completedAt: Date.now(),
          metadata: {
            outputDimensions: outputMetadata ? {
              width: outputMetadata.width,
              height: outputMetadata.height,
              aspectRatio: outputMetadata.aspectRatio,
              fileSize: outputMetadata.fileSize,
              fileSizeFormatted: outputMetadata.fileSizeFormatted,
            } : undefined,
          },
        });

        // Inspire 2x2 auto-crop: when the just-completed image came from the
        // Inspire tab with grid_size=2, slice it into 4 tiles right here so
        // users see the cropped variants in their library without tapping a
        // button. Fire-and-forget — the parent image is already visible.
        // Idempotency lives inside gridCropInspireImage (autoCroppedAt flag).
        // The rating prompt fires AFTER the crop resolves so the system rate
        // sheet never interrupts an in-progress auto-crop.
        const willAutoCrop =
          (existingMetadata.fromImagine || existingMetadata.fromInspire) &&
          existingMetadata.inspireGridSize === 2 &&
          !existingMetadata.autoCroppedAt;
        if (willAutoCrop) {
          const liveImage = libraryStateManager.getImages().find((img) => img.id === libraryId);
          if (liveImage) {
            // The library row's transformedImageUrl might not be flushed yet
            // (this very callback is the one setting it). Patch it in for the
            // helper so it can read the just-downloaded local file.
            const sourceImage = { ...liveImage, transformedImageUrl: job.localUri };
            gridCropInspireImage({ sourceImage, n: 2, addImage })
              .then((res) => {
                if (res.created > 0) {
                  console.log(`[Inspire] auto-cropped ${res.created} tiles for ${libraryId}`);
                }
                trackGenerationAndPromptRating();
              })
              .catch((err) => {
                console.error('[Inspire] auto-crop failed:', err);
                trackGenerationAndPromptRating();
              });
          } else {
            trackGenerationAndPromptRating();
          }
        } else {
          trackGenerationAndPromptRating();
        }

        // Optionally save to media library
        if (autoSaveToLibrary) {
          const { saveImageToMediaLibrary } = await import('../../lib/utils/imageDownloader');
          saveImageToMediaLibrary(job.localUri).catch(err => {
            console.warn('⚠️ Failed to save to media library:', err);
          });
        }

        // Mark as processed
        setProcessedJobs(prev => new Set(prev).add(job.id));

        // Remove from active jobs
        setActiveJobs(prev => {
          const next = new Map(prev);
          next.delete(job.id);
          return next;
        });

        console.log('✅ Job completed:', job.id.substring(0, 8));

        const startedAt = existingMetadata?.startedAt;
        capturePH('generation_completed', {
          job_id: job.id,
          library_id: libraryId,
          model: existingMetadata?.modelId,
          coin_cost: existingMetadata?.cost,
          duration_ms: startedAt ? Date.now() - startedAt : undefined,
          from_imagine: !!(existingMetadata?.fromImagine || existingMetadata?.fromInspire),
        });
      } catch (error) {
        console.error('❌ Failed to process job:', error);
        updateImage(libraryId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to download result',
        });
        // Mark as processed even on error to avoid retry loops
        setProcessedJobs(prev => new Set(prev).add(job.id));
      }
    } else if (job.status === 'failed') {
      console.log('❌ Job failed:', job.id.substring(0, 8), job.errorMessage);

      capturePH('generation_failed', {
        job_id: job.id,
        library_id: libraryId,
        error: job.errorMessage || 'Generation failed',
      });

      // Update library with failed status
      updateImage(libraryId, {
        status: 'failed',
        error: job.errorMessage || 'Generation failed',
      });

      // Mark as processed
      setProcessedJobs(prev => new Set(prev).add(job.id));

      // Remove from active jobs
      setActiveJobs(prev => {
        const next = new Map(prev);
        next.delete(job.id);
        return next;
      });
    }
  }, [updateImage, autoSaveToLibrary]);

  /**
   * Server-crop fan-out handler (Copy Shot Imagine 2x2 → 4 tiles).
   * Updates the 4 child library rows that share metadata.parentJobId = job.id.
   * On success: downloads each of the 4 URLs and assigns by metadata.cropIndex.
   * On failure: marks all 4 children failed.
   */
  const handleServerCropJob = useCallback(async (job: QueueJob) => {
    try {
      // Look in BOTH SQLite and in-memory library state. The parentJobId stamp
      // is issued via updateImage right after addImage returns its tempId — if
      // that stamp arrives before addImage's async saveImage has persisted the
      // row, the metadata only lives in memory. Without this fallback, we'd
      // see "no children found" and the placeholders would stay stuck while a
      // separate code path created orphan completed rows.
      const allImages = await imageManager.getAllImages();
      const inMemoryImages = libraryStateManager.getImages();
      const inMemoryById = new Map(inMemoryImages.map((img) => [img.id, img]));
      const seenIds = new Set<string>();
      const children: Array<{ id: string; metadata: any }> = [];
      for (const img of allImages) {
        const liveMeta = inMemoryById.get(img.id)?.metadata ?? img.metadata;
        if (liveMeta?.serverCrop === true && liveMeta?.parentJobId === job.id) {
          children.push({ id: img.id, metadata: liveMeta });
          seenIds.add(img.id);
        }
      }
      for (const img of inMemoryImages) {
        if (seenIds.has(img.id)) continue;
        if (img.metadata?.serverCrop === true && img.metadata?.parentJobId === job.id) {
          children.push({ id: img.id, metadata: img.metadata });
        }
      }

      if (children.length === 0) {
        console.warn(`⚠️ Server-crop: no children found for parent job ${job.id.substring(0, 8)}`);
        return;
      }

      // All tiles already filled (e.g. a re-tick or a fresh session reloading
      // a job that was recovered earlier) — nothing to do.
      if (children.every((c) => c.metadata?.status === 'completed')) {
        return;
      }

      if (job.status === 'failed') {
        console.log(`❌ Server-crop parent failed: marking ${children.length} children failed`);
        for (const child of children) {
          updateImage(child.id, {
            status: 'failed',
            error: job.errorMessage || 'Generation failed',
          });
        }
        capturePH('generation_failed', {
          job_id: job.id,
          error: job.errorMessage || 'Generation failed',
          server_crop: true,
        });
        return;
      }

      if (job.status !== 'completed') return;

      let urls = job.resultUrls && job.resultUrls.length === 4 ? job.resultUrls : null;

      // Fallback: the server delivered the full 2x2 grid (result_url) but not
      // the 4 crop URLs — callback regression or server-side crop failure.
      // Crop the grid locally with the same 3% safe-area inset so the tiles
      // still fill instead of hanging on "almost done" and dying as lost.
      if (!urls && job.resultUrl) {
        try {
          console.warn(`[copyshot] ⚠️ Job ${job.id.substring(0, 8)} completed without result_urls — cropping grid locally`);
          const gridLocalUri = await downloadMediaToCache(job.resultUrl);
          const pieces = await runGridCrop(gridLocalUri, 2, 0.03);
          if (pieces.length === 4) {
            urls = pieces.map((p) => p.uri);
            console.log(`[copyshot] ✅ Local grid-crop fallback produced 4 tiles for ${job.id.substring(0, 8)}`);
          }
        } catch (cropErr) {
          console.error('[copyshot] ❌ Local grid-crop fallback failed:', cropErr);
        }
      }

      if (!urls || urls.length !== 4) {
        console.error(
          `❌ Server-crop: expected 4 URLs, got ${urls?.length ?? 0} for job ${job.id.substring(0, 8)}`,
        );
        for (const child of children) {
          updateImage(child.id, {
            status: 'failed',
            error: 'Server returned wrong number of crops',
          });
        }
        return;
      }

      // Download all 4 in parallel; assign by cropIndex. Locally-cropped
      // fallback tiles are already file:// URIs — use them as-is.
      const downloads = await Promise.allSettled(
        urls.map((url) => (url.startsWith('file:') ? Promise.resolve(url) : downloadMediaToCache(url))),
      );

      for (const child of children) {
        const idx = child.metadata?.cropIndex;
        if (typeof idx !== 'number' || idx < 0 || idx > 3) {
          updateImage(child.id, {
            status: 'failed',
            error: 'Invalid crop index on child',
          });
          continue;
        }
        const dl = downloads[idx];
        if (dl.status !== 'fulfilled') {
          updateImage(child.id, {
            status: 'failed',
            error: `Crop ${idx} download failed`,
          });
          continue;
        }
        const localUri = dl.value;
        const completedAt = Date.now();
        await imageManager.updateImage(child.id, {
          localUri,
          metadata: {
            ...child.metadata,
            status: 'completed',
            completedAt,
            resultUrl: urls[idx],
          },
        });
        updateImage(child.id, {
          status: 'completed',
          transformedImageUrl: localUri,
          completedAt,
          metadata: {
            resultUrl: urls[idx],
          },
        });
      }

      capturePH('generation_completed', {
        job_id: job.id,
        server_crop: true,
        crop_count: urls.length,
      });
      trackGenerationAndPromptRating();
    } catch (err) {
      console.error('❌ Server-crop handler error:', err);
    }
  }, [updateImage]);

  // Subscribe to queue changes
  useEffect(() => {
    // Track jobs we've already searched for in the library
    const searchedJobs = new Set<string>();

    const unsubscribe = queueManager.subscribe(async (jobs) => {
      // Check for completed or failed jobs that we're tracking
      for (const job of jobs) {
        // Skip if already processed or currently being processed
        if (processedJobsRef.current.has(job.id) || inFlightJobsRef.current.has(job.id)) {
          continue;
        }

        // Only process completed or failed jobs
        if (job.status !== 'completed' && job.status !== 'failed') {
          continue;
        }

        // Server-crop fan-out: parent has 4 child rows linked via
        // metadata.parentJobId. Branch out before the single-row path.
        // Detected by looking for ANY library row with parentJobId === job.id.
        // On completion we need resultUrls populated; if missing (race with
        // queueManager refresh), skip this tick and let the next one retry.
        if (job.status === 'completed' && (!job.resultUrls || job.resultUrls.length === 0) && job.resultUrl) {
          // Could be either a legacy single-result job OR a server-crop job
          // whose result_urls hasn't propagated yet. We'll discover this when
          // we look for matching parentJobId rows below.
        }
        try {
          // Check both SQLite and in-memory — handleServerCropJob has the same
          // fallback, so they must agree on whether a parent has children.
          const allImages = await imageManager.getAllImages();
          const inMemoryImages = libraryStateManager.getImages();
          const matches = (meta: any) =>
            meta?.serverCrop === true && meta?.parentJobId === job.id;
          const isServerCropParent =
            allImages.some((img) => matches(img.metadata)) ||
            inMemoryImages.some((img) => matches(img.metadata));
          if (isServerCropParent) {
            // For completed jobs we need result_urls. Normally the callback
            // writes completed + result_urls in one update; give it a short
            // grace window, then hand off to handleServerCropJob whose local
            // grid-crop fallback fills the tiles — never wait forever.
            if (job.status === 'completed' && (!job.resultUrls || job.resultUrls.length === 0)) {
              const ageMs = Date.now() - job.updatedAt.getTime();
              if (!job.resultUrl || ageMs < SERVER_CROP_LOCAL_FALLBACK_MS) {
                continue; // retry on the next queueManager tick
              }
            }
            inFlightJobsRef.current.add(job.id);
            handleServerCropJob(job).finally(() => {
              inFlightJobsRef.current.delete(job.id);
              setProcessedJobs((prev) => new Set(prev).add(job.id));
            });
            continue;
          }
        } catch (err) {
          console.error('❌ Error checking for server-crop children:', err);
        }

        // Try to find library ID from activeJobs first
        let libraryId = activeJobsRef.current.get(job.id);

        // In-memory placeholder lookup. Jobs started via useGeneration (upscale,
        // tools) never enter this hook's activeJobs map, and on web the SQLite
        // search below always comes back empty (db shim) — but the session
        // placeholder with metadata.queueJobId lives in the state manager.
        // Exclude tiles whose id IS the job id (web-hydrated tiles patch via
        // applyQueueJobs) and terminal tiles (already processed).
        if (!libraryId) {
          const inMem = libraryStateManager.getImages().find(
            (img) =>
              img.id !== job.id &&
              (img.queueJobId === job.id || img.metadata?.queueJobId === job.id) &&
              img.status !== 'completed' &&
              img.status !== 'failed',
          );
          if (inMem) {
            libraryId = inMem.id;
            setActiveJobs(prev => new Map(prev).set(job.id, libraryId!));
          }
        }

        // If not in activeJobs (e.g., after app restart), search library by queueJobId
        // But only search once per job to avoid spam
        if (!libraryId && !searchedJobs.has(job.id)) {
          searchedJobs.add(job.id);

          try {
            // Search for library image with matching queueJobId
            const images = await imageManager.getAllImages();
            const matchingImage = images.find(img =>
              img.metadata?.queueJobId === job.id
            );

            if (matchingImage) {
              libraryId = matchingImage.id;
              // Add to activeJobs for future reference
              setActiveJobs(prev => new Map(prev).set(job.id, libraryId!));
            }
          } catch (error) {
            console.error('❌ Error searching library:', error);
          }
        }

        // Process job update if we found a libraryId
        if (libraryId) {
          // Check if job is currently downloading (completed on server but downloading to device)
          if (job.status === 'completed' && job.isDownloading) {
            // Job completed on server but download in progress - show 'downloading' status
            updateImage(libraryId, {
              status: 'downloading',
              metadata: {
                completedAt: Date.now(),
              },
            });
          } else {
            // Job is ready to process (completed with localUri, or failed).
            // Mark in-flight synchronously BEFORE awaiting so the next
            // subscription tick (which fires on every queueManager state
            // change, including the ones our own updateImage triggers) skips
            // re-entering for this same job.
            inFlightJobsRef.current.add(job.id);
            handleJobUpdate(job, libraryId).finally(() => {
              inFlightJobsRef.current.delete(job.id);
            });
          }
        }
      }
    });

    return unsubscribe;
  }, [handleJobUpdate, handleServerCropJob]);

  /**
   * Generate using cloud queue
   *
   * @param options - Generation options
   * @returns Library ID or null if creation failed
   */
  const generateWithQueue = async (
    options: CloudQueueGenerationOptions
  ): Promise<string | null> => {
    const {
      prompt,
      model,
      modelName,
      parameters = {},
      originalImageUri = '',
      inputImages = [],
      metadata = {},
      supportsPrompt = true, // Default to requiring prompt for backwards compatibility
      showStartNotification = true,
      showCompletionNotification = true,
      useAlertForErrors = false,
    } = options;

    // Validate prompt (skip if model doesn't support/require prompts)
    if (!prompt.trim() && supportsPrompt) {
      Alert.alert('Prompt Required', 'Please enter a text prompt');
      return null;
    }

    try {
      // Get original image dimensions before processing
      let originalDimensions;
      let beforeImageUri;

      if (originalImageUri) {
        originalDimensions = await getImageMetadata(originalImageUri);
        beforeImageUri = originalImageUri;
        // Note: Before image is NOT saved to library - only stored in metadata
        // for access in the image detail page
      }

      // Decide initial status: if we will upload reference images to Supabase
      // storage first (Fal models with image_urls param), surface that as a
      // distinct phase so the user knows not to close the app yet.
      const imageParamNameForStatus = parameters._imageParameterName;
      const isFalModelForStatus = model.endsWith('-fal') || model.endsWith('-phota');
      const willUploadToStorage = inputImages.length > 0
        && isFalModelForStatus
        && imageParamNameForStatus === 'image_urls';

      // Create library entry immediately with 'uploading' or 'processing' status
      const libraryId = await addImage({
        originalImageUri,
        inputImages,
        transformedImageUrl: null,
        prompt,
        model: modelName,
        status: willUploadToStorage ? 'uploading' : 'processing',
        modelId: model,
        ...parameters,
        metadata: {
          ...metadata,
          cloudQueue: true,
          startedAt: Date.now(),
          originalDimensions: originalDimensions ? {
            width: originalDimensions.width,
            height: originalDimensions.height,
            aspectRatio: originalDimensions.aspectRatio,
            fileSize: originalDimensions.fileSize,
            fileSizeFormatted: originalDimensions.fileSizeFormatted,
          } : undefined,
        },
      });

      // Process input images if provided
      let processedParameters = { ...parameters };
      const imageParamName = parameters._imageParameterName;
      delete processedParameters._imageParameterName; // Remove hint from final params

      if (inputImages.length > 0) {
        console.log(`📸 [CloudQueue] Processing ${inputImages.length} images for model: ${model}`);
        console.log(`📸 [CloudQueue] imageParamName from config: ${imageParamName}`);

        // Check if this is a Fal model (including Phota via Fal) that needs URLs (not base64)
        // These models need storage upload to avoid request size limits
        const isFalModel = model.endsWith('-fal') || model.endsWith('-phota');
        const needsStorageUpload = isFalModel && imageParamName === 'image_urls';

        if (needsStorageUpload) {
          // Upload images to Supabase storage and get public URLs
          console.log(`📸 [CloudQueue] Fal model detected - uploading images to storage...`);

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            throw new Error('User not authenticated');
          }

          const imageUrls = await uploadImagesToStorage(inputImages, user.id);
          const uploadParamName = imageParamName || 'image_urls';
          processedParameters[uploadParamName] = imageUrls;
          // Store URLs for analytics (kept in storage, not deleted)
          processedParameters._uploadedImageUrls = imageUrls;
          console.log(`📸 [CloudQueue] Uploaded ${imageUrls.length} images to storage as '${uploadParamName}'`);

          // Upload finished — flip status so the user sees "Generating" copy
          // before the queue subscription kicks in.
          if (willUploadToStorage) {
            updateImage(libraryId, { status: 'processing' });
          }
        } else {
          // Convert to base64 for Replicate and other providers
          const { convertImageToBase64 } = await import('../../lib/replicate/client');
          const base64Images = await Promise.all(
            inputImages.map(uri => convertImageToBase64(uri))
          );

          if (imageParamName) {
            // Use the parameter name from cloud model config
            // These parameter names always expect arrays
            const arrayParamNames = ['input_images', 'reference_images', 'image_input', 'image_urls'];
            if (arrayParamNames.includes(imageParamName)) {
              processedParameters[imageParamName] = base64Images;
              console.log(`📸 [CloudQueue] Using array param: ${imageParamName} with ${base64Images.length} images`);
            } else {
              // Single image parameter
              processedParameters[imageParamName] = base64Images.length === 1 ? base64Images[0] : base64Images;
              console.log(`📸 [CloudQueue] Using single/fallback param: ${imageParamName}`);
            }
          } else if (model === 'seedream') {
            processedParameters.image_input = base64Images; // Seedream expects image_input array (1-10 items)
          } else if (model === 'nano-banana' || model === 'nano-banana-pro-2k' || model === 'nano-banana-pro-4k') {
            processedParameters.image_input = base64Images; // Nano-banana expects array
          } else if (model === 'reve-remix') {
            processedParameters.reference_images = base64Images; // Reve Remix expects reference_images array (1-4 items)
          } else if (model === 'gen4-image') {
            processedParameters.reference_images = base64Images; // Gen-4 Image expects reference_images array (1-3 items)
          } else if (model === 'flux-kontext-multi-4' || model === 'flux-kontext-multi-2') {
            processedParameters.input_images = base64Images; // Flux Kontext expects input_images array
          } else if (model === 'flux-kontext-pro') {
            processedParameters.input_image = base64Images[0]; // Flux Kontext Pro expects single input_image
          } else if (model === 'qwen-image-edit-plus') {
            processedParameters.image = base64Images; // Qwen accepts array of images (1-10)
          } else if (model.startsWith('flux-2')) {
            processedParameters.input_images = base64Images; // FLUX 2 models use input_images
          } else if (inputImages.length === 1) {
            processedParameters.image = base64Images[0]; // Single image models
          } else {
            processedParameters.images = base64Images; // Multi-image models
          }
        }
      }

      // Mark this job as a library generation so orphan adoption may rebuild
      // its tile if the local placeholder is ever lost. Internal features
      // (soul-creation background removal etc.) don't carry this marker and
      // must never surface in the library. Underscore-prefixed so the Fal
      // edge functions strip it before forwarding to the model; the legacy
      // Replicate function does NOT strip, so only stamp Fal-path models.
      if (isFalModelForStatus) {
        processedParameters._source = 'library';
      }

      // Start cloud queue job
      try {
        const response = await queueManager.startPrediction({
          model,
          prompt,
          parameters: processedParameters,
          metadata,
        });

        // Track this job
        setActiveJobs(prev => new Map(prev).set(response.job_id, libraryId));

        // Update library with queue job ID
        updateImage(libraryId, {
          metadata: {
            ...metadata,
            cloudQueue: true,
            queueJobId: response.job_id,
            replicateId: response.replicate_id,
          },
        });

        console.log('🚀 Started job:', response.job_id.substring(0, 8));

        return libraryId;
      } catch (error: any) {
        console.error('❌ Hook: Failed to start cloud queue job:', error);
        console.log('[CloudQueue] Error details:', {
          code: error.code,
          statusCode: error.statusCode,
          message: error.message,
          isUserKeyError: error.isUserKeyError,
        });

        // Update library with failed status
        updateImage(libraryId, {
          status: 'failed',
          error: error.message || 'Failed to start generation',
        });

        // Check for free generations exhausted - show paywall
        if (error.code === 'FREE_GENERATIONS_EXHAUSTED') {
          console.log('[CloudQueue] 📱 FREE_GENERATIONS_EXHAUSTED → showing paywall');
          showPaywall('free_generations_exhausted');
          return null;
        }

        // Check for insufficient coins - show paywall
        if (error.code === 'COINS_INSUFFICIENT_BALANCE' ||
            error.code === 'INSUFFICIENT_FREE_GENERATIONS' ||
            error.code === 'FAILED_COIN_RESERVATION' ||
            error.statusCode === 402) {
          console.log('[CloudQueue] 📱 INSUFFICIENT_COINS → showing paywall');
          showPaywall('insufficient_coins');
          return null;
        }

        // Check if this is a user API key error
        if (error.isUserKeyError) {
          // Determine provider for error message
          const isFalError = error.isFalError || error.code?.includes('FAL');
          const providerName = isFalError ? 'Fal.ai' : 'Replicate';
          const dashboardUrl = isFalError ? 'fal.ai/dashboard/billing' : 'replicate.com/account/billing';

          // Show detailed error message for user API key issues
          Alert.alert(
            error.message || 'API Key Error',
            `${error.details || `There was an issue with your custom ${providerName} API key.`}\n\nYou can:\n• Add credits to your ${providerName} account (${dashboardUrl})\n• Check your API key is valid in Library → Settings`,
            [
              {
                text: 'OK',
                style: 'default'
              }
            ]
          );
        } else {
          // Show a friendly error (e.g. the model's nudity/content filter) for other issues
          const errorMessage = friendlyGenerationError(error.message);
          if (useAlertForErrors) {
            Alert.alert('Error', errorMessage);
          } else {
            showJobToast(`❌ ${errorMessage}`, false);
          }
        }

        return null;
      }
    } catch (error: any) {
      console.error('❌ Hook: Setup error:', error);
      Alert.alert('Error', friendlyGenerationError(error.message));
      return null;
    }
  };

  /**
   * Recheck status of a failed job on Replicate
   * The job might have completed successfully but app-side issues caused it to appear failed
   *
   * @param libraryId - The library entry ID
   * @returns Recheck result with status info
   */
  const recheckJobStatus = async (libraryId: string): Promise<RecheckResult> => {
    try {
      // Get the library entry to find queueJobId
      const libraryEntry = await imageManager.getImage(libraryId);

      if (!libraryEntry) {
        return {
          success: false,
          status: 'not_found',
          errorMessage: 'Library entry not found',
        };
      }

      const queueJobId = libraryEntry.metadata?.queueJobId;

      if (!queueJobId) {
        return {
          success: false,
          status: 'not_found',
          errorMessage: 'No queue job ID found for this entry',
        };
      }

      console.log(`🔍 Rechecking job status for library entry ${libraryId}, queueJobId: ${queueJobId}`);

      // Call queue manager to check prediction status
      const result = await queueManager.checkPredictionStatus(queueJobId);

      if (!result.success) {
        return {
          success: false,
          status: result.status,
          errorMessage: result.errorMessage,
        };
      }

      // If job was actually completed, the Realtime subscription will trigger download
      // Update UI immediately to show status change
      if (result.status === 'completed' && result.resultUrl) {
        // Track this job again so our subscription can process it
        setActiveJobs(prev => new Map(prev).set(queueJobId, libraryId));

        // Update library status to show downloading
        updateImage(libraryId, { status: 'downloading' });

        return {
          success: true,
          status: 'completed',
          resultUrl: result.resultUrl,
          downloaded: true,
        };
      }

      // If still processing on Replicate
      if (result.status === 'processing' || result.status === 'pending') {
        // Update library to show it's still processing
        updateImage(libraryId, { status: 'processing' });

        return {
          success: true,
          status: result.status,
        };
      }

      // If truly failed
      if (result.status === 'failed') {
        updateImage(libraryId, {
          status: 'failed',
          error: result.errorMessage || 'Generation failed on Replicate',
        });

        return {
          success: true,
          status: 'failed',
          errorMessage: result.errorMessage,
        };
      }

      return result as RecheckResult;
    } catch (error) {
      console.error('❌ Error rechecking job status:', error);
      return {
        success: false,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  /**
   * Retry a failed job by starting a new generation with stored parameters
   *
   * @param libraryId - The library entry ID of the failed job
   * @returns New library ID or null if retry failed
   */
  const retryFailedJob = async (libraryId: string): Promise<string | null> => {
    try {
      // Get the library entry to extract original parameters
      const libraryEntry = await imageManager.getImage(libraryId);

      if (!libraryEntry) {
        Alert.alert('Error', 'Could not find the original job');
        return null;
      }

      // Extract parameters from the library entry
      const {
        prompt,
        modelId,
        model: modelName,
        originalImageUri,
        inputImages,
        metadata,
        ...restParams
      } = libraryEntry;

      if (!modelId) {
        Alert.alert('Error', 'Cannot retry - model information not found');
        return null;
      }

      console.log(`🔄 Retrying failed job ${libraryId} with model ${modelId}`);

      // Extract parameters from metadata if available
      const originalParams = metadata?.parameters || {};

      // Start a new generation with the same parameters
      const newLibraryId = await generateWithQueue({
        prompt: prompt || '',
        model: modelId,
        modelName: modelName || modelId,
        parameters: {
          ...originalParams,
          ...restParams,
        },
        originalImageUri,
        inputImages,
        metadata: {
          retriedFrom: libraryId,
          ...(metadata?.recipeId ? { recipeId: metadata.recipeId } : {}),
        },
      });

      if (newLibraryId) {
        showJobToast('🔄 Retry started', false);
      }

      return newLibraryId;
    } catch (error) {
      console.error('❌ Error retrying job:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to retry');
      return null;
    }
  };

  /**
   * Start a server-crop job for the Copy Shot Imagine 2x2 fan-out.
   * Does NOT create its own library row — the caller is expected to have
   * already created the 4 child placeholders. Returns the queue job id so
   * the caller can stamp it into the children as metadata.parentJobId.
   *
   * Uploads input images to Supabase storage (Fal needs URLs not base64),
   * then calls start-prediction-fal with parameters._serverCrop=true. The
   * fal-prediction-callback edge function reads that flag and produces
   * result_urls (array of 4 cropped URLs) instead of a single result_url.
   */
  const startServerCropJob = async (
    options: CloudQueueGenerationOptions,
  ): Promise<{ queueJobId: string; replicateId: string } | null> => {
    const {
      prompt,
      model,
      parameters = {},
      inputImages = [],
      metadata = {},
      serverCrop = true,
    } = options;

    try {
      const imageParamName = parameters._imageParameterName;
      let processedParameters: Record<string, any> = { ...parameters };
      delete processedParameters._imageParameterName;

      // Server-crop signal for the Fal callback. Underscore-prefixed so
      // start-prediction-fal strips it before forwarding to Fal. Single-image
      // Copy Shot jobs (serverCrop: false) skip it — one un-cropped result.
      if (serverCrop) processedParameters._serverCrop = true;
      processedParameters._source = 'library';

      // Server-crop currently only supports Fal models with image_urls; the
      // input-image upload path mirrors generateWithQueue.
      if (inputImages.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const imageUrls = await uploadImagesToStorage(inputImages, user.id);
        const uploadParamName = imageParamName || 'image_urls';
        processedParameters[uploadParamName] = imageUrls;
        processedParameters._uploadedImageUrls = imageUrls;
        console.log(`📸 [ServerCrop] Uploaded ${imageUrls.length} images as '${uploadParamName}'`);
      }

      const response = await queueManager.startPrediction({
        model,
        prompt,
        parameters: processedParameters,
        metadata,
      });

      console.log('🚀 [ServerCrop] Started job:', response.job_id.substring(0, 8));
      return { queueJobId: response.job_id, replicateId: response.replicate_id };
    } catch (error: any) {
      console.error('❌ [ServerCrop] Failed to start job:', error);

      if (error.code === 'FREE_GENERATIONS_EXHAUSTED') {
        showPaywall('free_generations_exhausted');
        return null;
      }
      if (
        error.code === 'COINS_INSUFFICIENT_BALANCE' ||
        error.code === 'INSUFFICIENT_FREE_GENERATIONS' ||
        error.code === 'FAILED_COIN_RESERVATION' ||
        error.statusCode === 402
      ) {
        showPaywall('insufficient_coins');
        return null;
      }
      throw error;
    }
  };

  return {
    generateWithQueue,
    startServerCropJob,
    recheckJobStatus,
    retryFailedJob,
    activeJobs: Array.from(activeJobs.entries()),
  };
}
