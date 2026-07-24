import { useCallback, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { queueManager } from '../../lib/queue/queueManager';
import { uploadImagesToStorage } from '../../lib/storage/imageUpload';
import { getInspirePreset } from '../../lib/inspire/preset';
import {
  HardPaywallFlowConfig,
  DEFAULT_HARD_PAYWALL_FLOW_CONFIG,
} from '../../lib/hardPaywallFlow/config';
import { capturePH } from '../../lib/posthog';
import { libraryStateManager } from '../../lib/library/libraryStateManager';
import { downloadMediaToCache } from '../../lib/utils/imageDownloader';

/**
 * Free onboarding generation for the hard-paywall flow v2.
 *
 * Fires ONE Copy Shot-style job (same prompt preset as the Imagine tab, but
 * WITHOUT the 2x2 grid addendum) as a single high-quality portrait. Marked
 * metadata.source='onboarding' so start-prediction-fal-copyshot-v2 skips coin
 * reservation (server enforces a per-user cap via
 * claim_onboarding_free_generation). metadata.onboardingFlow routes it to the
 * v2 edge fn WITHOUT metadata.fromImagine, so the 2160x3840 clamp and flat
 * 250-coin pricing never apply.
 *
 * Progress bypasses queueManager's realtime/library path — we poll the
 * generation_queue row directly. On success the result is saved into the
 * Library as an already-completed tile (download → addImage), so the user
 * finds their onboarding photo next to everything else.
 */

export type OnboardingGenerationStatus =
  | 'idle'
  | 'uploading'
  | 'generating'
  | 'completed'
  | 'failed';

const POLL_INTERVAL_MS = 4000;

export function useOnboardingGeneration(
  config: HardPaywallFlowConfig = DEFAULT_HARD_PAYWALL_FLOW_CONFIG,
) {
  const [status, setStatus] = useState<OnboardingGenerationStatus>('idle');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  // Retries reuse the already-uploaded storage URLs to skip re-upload.
  const uploadedUrlsRef = useRef<string[] | null>(null);
  // Only URLs we actually uploaded to generation-inputs — the callback's
  // cleanup deletes these, so feed URLs must never appear here.
  const ownUploadsRef = useRef<string[]>([]);
  // Captured per run so handoffToLibrary() (skip button) can register a
  // processing tile linked to the still-running job.
  const lastJobIdRef = useRef<string | null>(null);
  const lastModelRef = useRef<string | null>(null);
  const lastInputsRef = useRef<string[]>([]);

  const pollJob = useCallback(
    async (jobId: string): Promise<{ resultUrl: string | null; errorMessage: string | null }> => {
      const readJob = async () => {
        const { data, error: readError } = await supabase
          .from('generation_queue')
          .select('status, result_url, error_message')
          .eq('id', jobId)
          .maybeSingle();
        return readError ? null : data;
      };

      const deadline = Date.now() + config.generation.timeoutSeconds * 1000;
      while (Date.now() < deadline) {
        if (cancelledRef.current) return { resultUrl: null, errorMessage: 'cancelled' };
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const data = await readJob();
        if (!data) continue; // transient read failure — keep polling
        if (data.status === 'completed' && data.result_url) {
          return { resultUrl: data.result_url, errorMessage: null };
        }
        if (data.status === 'failed') {
          return { resultUrl: null, errorMessage: data.error_message || 'Generation failed' };
        }
      }
      // One last read past the deadline: JS timers freeze while the app is
      // backgrounded, so a user returning after a long pause can blow the
      // deadline even though the job finished server-side long ago.
      const final = await readJob();
      if (final?.status === 'completed' && final.result_url) {
        return { resultUrl: final.result_url, errorMessage: null };
      }
      if (final?.status === 'failed') {
        return { resultUrl: null, errorMessage: final.error_message || 'Generation failed' };
      }
      return { resultUrl: null, errorMessage: 'timeout' };
    },
    [config.generation.timeoutSeconds],
  );

  /**
   * @param referencePhotoUri local file URI of the photo to recreate (Photo 1)
   * @param selfieUris        local file URIs of the user's selfies (photos 2-5)
   */
  const generate = useCallback(
    async (referencePhotoUri: string, selfieUris: string[]): Promise<string | null> => {
      cancelledRef.current = false;
      const thisAttempt = attempt + 1;
      setAttempt(thisAttempt);
      setError(null);
      setResultUrl(null);
      startedAtRef.current = Date.now();

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        // Same admin-tunable preset as the Copy Shot tab; grid_addendum is
        // intentionally NOT appended (single image, no 2x2).
        const preset = await getInspirePreset({ forceRefresh: true });
        const prompt = config.generation.promptOverride ?? preset.prompt;
        const model = config.generation.modelId ?? preset.model_id;
        lastModelRef.current = model;
        lastInputsRef.current = [referencePhotoUri, ...selfieUris.slice(0, 4)];

        let imageUrls = uploadedUrlsRef.current;
        if (!imageUrls) {
          setStatus('uploading');
          // Inspire-feed picks are already public URLs — pass them to Fal
          // as-is; only local file URIs (selfies, pasted-link downloads,
          // camera-roll picks) need the storage round-trip.
          const inputImages = [referencePhotoUri, ...selfieUris.slice(0, 4)];
          const localOnly = inputImages.filter((u) => !/^https?:\/\//i.test(u));
          const uploaded = localOnly.length > 0
            ? await uploadImagesToStorage(localOnly, user.id)
            : [];
          let nextUploaded = 0;
          imageUrls = inputImages.map((u) =>
            /^https?:\/\//i.test(u) ? u : uploaded[nextUploaded++],
          );
          uploadedUrlsRef.current = imageUrls;
          ownUploadsRef.current = uploaded;
        }
        if (cancelledRef.current) return null;

        setStatus('generating');
        capturePH('hpf_generation_started', { attempt: thisAttempt, model });

        const response = await queueManager.startPrediction({
          model,
          prompt,
          parameters: {
            image_size: config.generation.imageSize,
            quality: config.generation.quality,
            image_urls: imageUrls,
            _uploadedImageUrls: ownUploadsRef.current,
          },
          metadata: {
            source: 'onboarding',
            onboardingFlow: true,
            copyshotV2: true,
          },
        });

        lastJobIdRef.current = response.job_id;

        const { resultUrl: url, errorMessage } = await pollJob(response.job_id);
        if (cancelledRef.current) return null;

        if (url) {
          setResultUrl(url);
          setStatus('completed');
          capturePH('hpf_generation_completed', {
            attempt: thisAttempt,
            duration_ms: Date.now() - startedAtRef.current,
          });
          // Save into the Library as an already-completed tile so the user
          // finds their onboarding photo alongside everything else. Best
          // effort — a save failure must never block the reveal. Uses
          // addCompletedImage (result file goes straight into SQLite); the
          // reference photo may be an https URL (feed pick), which the
          // regular addImage path can't persist.
          try {
            const localUri = await downloadMediaToCache(url);
            await libraryStateManager.addCompletedImage({
              localUri,
              // Blank prompt like Imagine tiles — the recipe stays hidden.
              prompt: '',
              model: 'Inspire',
              modelId: model,
              resultUrl: url,
              inputImages: [referencePhotoUri, ...selfieUris.slice(0, 4)],
              metadata: { onboardingFlow: true },
            });
          } catch (saveErr) {
            console.warn('[OnboardingGeneration] Library save failed:', saveErr);
          }
          return url;
        }
        throw new Error(errorMessage || 'Generation failed');
      } catch (err: any) {
        if (cancelledRef.current) return null;
        // fal-prediction-callback cleans up _uploadedImageUrls when a job
        // fails, so a retry must re-upload instead of reusing dead URLs.
        uploadedUrlsRef.current = null;
        ownUploadsRef.current = [];
        const message = err?.message || 'Generation failed';
        console.error('[OnboardingGeneration] attempt', thisAttempt, 'failed:', message);
        capturePH('hpf_generation_failed', { attempt: thisAttempt, reason: message });
        setError(message);
        setStatus('failed');
        return null;
      }
    },
    [attempt, config, pollJob],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  /**
   * Skip the wait: stop this hook from finishing/saving the job itself, and
   * instead register a "processing" tile in the Library linked to the running
   * queue job (via queueJobId). The standard queue→library reconciliation then
   * downloads the result and flips the tile to completed in the background —
   * exactly like a regular generation. No originalImageUri is set (the
   * reference may be an https feed URL that can't be persisted), so the
   * placeholder stays in-memory until the real result lands; if the app is
   * killed first, orphan adoption picks the finished job up on next launch.
   * Returns true if a tile was registered.
   */
  const handoffToLibrary = useCallback(async (): Promise<boolean> => {
    const jobId = lastJobIdRef.current;
    // Stop the internal poll/save so we never double-add a completed tile.
    cancelledRef.current = true;
    if (!jobId) return false;
    // Same ETA the onboarding waiting screen showed, so the Library tile's
    // "Ns / ~Xs" counter matches instead of falling back to the ~90s model
    // estimate. Explicit override wins; else derive from quality.
    const q = config.generation.quality;
    const etaSeconds =
      config.generation.etaSeconds ?? (q === 'medium' ? 60 : q === 'low' ? 45 : 180);
    try {
      await libraryStateManager.addImage({
        // Reference look as the tile's image → the card shows it blurred behind
        // the processing overlay (displayUri = originalImageUri while the result
        // is still null), same as a normal generating tile. A feed https URL
        // just won't persist to SQLite (memory-only until the result lands).
        originalImageUri: lastInputsRef.current[0],
        inputImages: lastInputsRef.current,
        transformedImageUrl: null,
        prompt: '',
        model: 'Inspire',
        modelId: lastModelRef.current ?? undefined,
        status: 'processing',
        isFavorite: false,
        favoriteSyncStatus: 'none',
        queueJobId: jobId,
        metadata: {
          onboardingFlow: true,
          queueJobId: jobId,
          // Real gen start → the tile counts elapsed from here, not from when
          // it was created at skip time (ProcessingOverlay reads startedAt).
          startedAt: startedAtRef.current || Date.now(),
          etaSeconds,
        },
      } as any);
      return true;
    } catch (err) {
      console.warn('[OnboardingGeneration] library handoff failed:', err);
      return false;
    }
  }, [config]);

  const canRetry = attempt < config.generation.maxAttempts;

  return { status, resultUrl, error, attempt, canRetry, generate, cancel, handoffToLibrary };
}
