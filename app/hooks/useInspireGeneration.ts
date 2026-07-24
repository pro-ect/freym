/**
 * useInspireGeneration
 *
 * Copy Shot's "Imagine" tab — face-swap onto Photo 1. Job fan-out depends on
 * inspire_presets.pipeline_version:
 *   v1 (legacy): 2 parallel jobs × 4 tiles = 8 tiles, 50 coins/job, medium.
 *   v2: 1 job × 4 tiles, flat 250 coins, gpt-image HIGH quality, 180s ETA.
 * Each job generates a 2x2 grid that's CROPPED SERVER-SIDE into 4 tiles.
 *
 * The user sees the result as independent tiles streaming in: we hide the
 * fact that the model produces a 2x2 sheet and that the tiles come in groups
 * of 4. Tile order is randomized once at placeholder creation so the eventual
 * reveal order doesn't expose the pairing.
 *
 * On press of Generate:
 *   1. Pre-create jobCount×4 library rows (status=processing,
 *      transformedImageUrl=null) with metadata.serverCrop=true, cropIndex
 *      0..3, displayOrder, parentJobIndex (4 children per parent).
 *   2. Fire the Fal job(s) sequentially via startServerCropJob. Each returns a
 *      queueJobId which we stamp back onto its 4 children as parentJobId.
 *   3. The fal-prediction-callback edge function crops the 2x2 into 4 tiles
 *      and writes result_urls to generation_queue.
 *   4. useCloudQueueGeneration's server-crop subscriber finds the 4 children
 *      by parentJobId and fills each by cropIndex.
 *
 * If a parent job fails, all 4 of its children fail together (shared fate).
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCloudQueue } from '../../contexts/CloudQueueContext';
import { useLibrary } from '../../contexts/LibraryContext';
import { useSouls } from '../../contexts/SoulsContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { getInspirePreset } from '../../lib/inspire/preset';
import { friendlyGenerationError } from '../../lib/generation/friendlyError';

/**
 * Admin-only OpenAI-direct overrides (Copy Shot switcher). Undefined for
 * regular users → the normal Fal path runs unchanged.
 */
interface InspireAdminOverrides {
  /** Route through start-prediction-openai-direct (OpenAI Images API). */
  useOpenAiDirect?: boolean;
  /** Exact OpenAI model id, e.g. 'gpt-image-2' or 'gpt-image-2-2026-04-21'. */
  openaiModel?: string;
  /** OpenAI moderation level. */
  moderation?: 'auto' | 'low';
  /** Quality override (low | medium | high). */
  quality?: string;
  /** Fal pipeline override: 1 = legacy 2-job/100-coin function, 2 = v2
   *  single-job/250-coin high function. Undefined → follow the preset's
   *  pipeline_version. Device-local, admin-only. */
  pipelineVersion?: 1 | 2;
}

interface InspireExecuteArgs {
  photo1Uri: string;
  soulId: string;
  /** User's on-tab version choice (v2 default). Admin override still wins. */
  pipelineVersion?: 1 | 2;
  /** "1 photo" mode — same recipe as the onboarding free generation: one
   *  768x1024 high image, no 2x2 grid, flat 100 coins (server-enforced via
   *  metadata.copyshotSingle). Overrides pipelineVersion. */
  singlePhoto?: boolean;
  admin?: InspireAdminOverrides;
}

interface InspireExecutionState {
  isExecuting: boolean;
  error: string | null;
}

// Per-pipeline job fan-out. Both versions now fire ONE job × 4 tiles per
// user action. v1: medium quality, flat 100 coins — the edge function keys
// the 100 on metadata.inspireJobCount === 1, while old builds still firing
// 2 jobs/action keep paying 50/job (100 total). v2: gpt-image HIGH quality,
// flat 250 coins — slower, so placeholders carry a 180s ETA.
const JOB_COUNT_V1 = 1;
const JOB_COUNT_V2 = 1;
const TILES_PER_JOB = 4;
const V2_ETA_SECONDS = 180;
// gpt-image-2 HIGH quality runs ~180s regardless of output size, so a single
// 768x1024 image is NOT meaningfully faster than the 4K grid — keep the same
// ETA so the loader doesn't hit "Almost done…" long before the photo lands.
const SINGLE_ETA_SECONDS = 180;
const MAX_SOUL_IMAGES = 4; // prompt references "photo 2-5" → 4 soul photos

/** Fisher-Yates shuffle of [0..n-1]. */
function shuffledRange(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function useInspireGeneration() {
  const { startServerCropJob } = useCloudQueue();
  const { addImage, updateImage } = useLibrary();
  const { souls } = useSouls();
  const { showAuthModal } = useAuth();

  const [state, setState] = useState<InspireExecutionState>({
    isExecuting: false,
    error: null,
  });

  const execute = useCallback(
    async ({ photo1Uri, soulId, pipelineVersion, singlePhoto, admin }: InspireExecuteArgs): Promise<boolean> => {
      setState({ isExecuting: true, error: null });
      try {
        // Force refresh on each generate so admin prompt edits propagate to
        // users without requiring an app restart.
        const preset = await getInspirePreset({ forceRefresh: true });
        const soul = souls.find((s) => s.id === soulId);
        if (!soul) throw new Error('Selected soul not found.');

        const soulImages = (soul.imageUris || []).slice(0, MAX_SOUL_IMAGES);
        if (soulImages.length === 0) {
          throw new Error('This soul has no reference photos.');
        }

        const inputImages = [photo1Uri, ...soulImages];
        const batchId = `inspire_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // ── "1 photo" mode ────────────────────────────────────────────────
        // Same recipe as the onboarding free generation: preset prompt with
        // NO grid addendum, one 768x1024 high image, no server crop. Flat
        // 100 coins, enforced server-side via metadata.copyshotSingle. The
        // result fills the single placeholder through the standard
        // queueJobId completion path.
        if (singlePhoto && !admin?.useOpenAiDirect) {
          const startedAt = Date.now();
          const id = await addImage({
            originalImageUri: photo1Uri,
            inputImages,
            transformedImageUrl: null,
            prompt: '',
            model: 'Inspire',
            modelId: preset.model_id,
            status: 'processing',
            isFavorite: false,
            favoriteSyncStatus: 'none',
            batchId,
            metadata: {
              fromImagine: true,
              copyshotSingle: true,
              soulId,
              batchId,
              // Hides the prompt on tile detail, like the grid tiles.
              localTool: 'inspire-grid-crop',
              startedAt,
              etaSeconds: SINGLE_ETA_SECONDS,
            },
          });

          try {
            const result = await startServerCropJob({
              prompt: preset.prompt,
              model: preset.model_id,
              modelName: 'Inspire',
              originalImageUri: photo1Uri,
              inputImages,
              serverCrop: false,
              parameters: {
                image_size: '768x1024',
                quality: 'high',
                _imageParameterName: 'image_urls',
              },
              metadata: {
                // No fromImagine — that would trigger the 4K clamp + flat
                // 250 pricing. copyshotSingle routes to the v2 fn (100 flat).
                copyshotV2: true,
                copyshotSingle: true,
                soulId,
                batchId,
              },
            });

            if (!result) {
              updateImage(id, { status: 'failed', error: 'Generation could not start.' });
              throw new Error('Could not start any generation jobs.');
            }
            updateImage(id, {
              metadata: { queueJobId: result.queueJobId, replicateId: result.replicateId },
            });
          } catch (err) {
            const msg = friendlyGenerationError(err instanceof Error ? err.message : null);
            updateImage(id, { status: 'failed', error: msg });
            throw err;
          }

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setState({ isExecuting: false, error: null });
          return true;
        }
        // ──────────────────────────────────────────────────────────────────

        // Server-crop only triggers when the model returns a 2x2 grid. If the
        // admin disables grid mode (grid_size !== 2), fall through to the
        // legacy single-tile flow so the feature is still functional during
        // experiments. We keep the addendum logic identical to before.
        if (preset.grid_size !== 2) {
          // Legacy path: not supported by this rewrite. Surface a clear
          // error so we notice if grid_size accidentally flips.
          throw new Error('Inspire requires grid_size=2 — contact admin.');
        }

        const finalPrompt = preset.grid_addendum
          ? `${preset.prompt.trim()}\n\n${preset.grid_addendum.trim()}`
          : preset.prompt;

        // Precedence: admin Function switch → user's on-tab choice → preset.
        const isV2 = (admin?.pipelineVersion ?? pipelineVersion ?? preset.pipeline_version) === 2;
        const jobCount = isV2 ? JOB_COUNT_V2 : JOB_COUNT_V1;
        const totalTiles = jobCount * TILES_PER_JOB;

        // Step 1: pre-create placeholders with stable randomized display order.
        const displayOrder = shuffledRange(totalTiles);
        const childIdsByJob: string[][] = Array.from({ length: jobCount }, () => []);
        const startedAt = Date.now();
        let displayCursor = 0;

        for (let parentJobIndex = 0; parentJobIndex < jobCount; parentJobIndex++) {
          for (let cropIndex = 0; cropIndex < TILES_PER_JOB; cropIndex++) {
            const id = await addImage({
              originalImageUri: photo1Uri,
              inputImages,
              transformedImageUrl: null,
              // Prompt + model intentionally blank on tiles. The recipe stays
              // hidden even if a user pulls up tile details. Matches the
              // legacy gridCropAndSave behavior.
              prompt: '',
              model: 'Inspire',
              modelId: preset.model_id,
              status: 'processing',
              isFavorite: false,
              favoriteSyncStatus: 'none',
              batchId,
              metadata: {
                fromImagine: true,
                inspireGridSize: 2,
                soulId,
                batchId,
                // Server-crop control fields:
                serverCrop: true,
                parentJobIndex,
                cropIndex,
                displayOrder: displayOrder[displayCursor++],
                // Match legacy crop-tile flag so existing UI filters (admin
                // "re-crop" button hidden, prompt hidden on tile detail) work.
                localTool: 'inspire-grid-crop',
                gridSize: 2,
                gridIndex: cropIndex,
                startedAt,
                // V2 runs gpt-image at HIGH quality — much slower than the
                // v1 medium tier, so the library loader shows a 180s ETA
                // instead of the per-model default.
                ...(isV2 ? { copyshotV2: true, etaSeconds: V2_ETA_SECONDS } : {}),
              },
            });
            childIdsByJob[parentJobIndex].push(id);
          }
        }

        // Step 2: fire the Fal job(s) sequentially (v2 = 1 job, v1 = 2).
        // Sequential keeps coin-reservation / library writes from racing —
        // Fal itself runs them in parallel once enqueued.
        let enqueued = 0;
        for (let i = 0; i < jobCount; i++) {
          const childIds = childIdsByJob[i];
          try {
            const result = await startServerCropJob({
              prompt: finalPrompt,
              model: preset.model_id,
              modelName: 'Inspire',
              originalImageUri: photo1Uri,
              inputImages,
              parameters: {
                // The edge function clamps these server-side per pipeline
                // (v1 → 1440x2560 medium, v2 → 2160x3840 high); sending the
                // matching values keeps client logs honest.
                image_size: isV2 ? '2160x3840' : '1440x2560',
                quality: isV2 ? 'high' : (admin?.quality || 'medium'),
                _imageParameterName: 'image_urls',
                // Admin OpenAI-direct overrides — ignored by the Fal path
                // (underscore-prefixed, stripped before forwarding to Fal).
                ...(admin?.useOpenAiDirect
                  ? {
                      _openaiModel: admin.openaiModel,
                      _openaiModeration: admin.moderation || 'low',
                    }
                  : {}),
              },
              metadata: {
                fromImagine: true,
                inspireGridSize: 2,
                inspireJobIndex: i,
                inspireJobCount: jobCount,
                soulId,
                batchId,
                // Routes to start-prediction-fal-copyshot-v2 in queueManager
                // (250 coins flat, high quality). v1 keeps the old function.
                copyshotV2: isV2,
                // Routes to start-prediction-openai-direct in queueManager.
                openaiDirect: admin?.useOpenAiDirect === true,
              },
            });

            if (!result) {
              // Paywall/quota error — startServerCropJob already surfaced UI.
              // Fail the 4 placeholders so the user doesn't stare at spinners.
              for (const id of childIds) {
                updateImage(id, {
                  status: 'failed',
                  error: 'Generation could not start.',
                });
              }
              continue;
            }

            // Step 3: stamp parentJobId onto the 4 children so the completion
            // handler can find them. Go through libraryStateManager (via
            // LibraryContext updateImage) so the temp ID returned by addImage
            // is resolved to the real SQLite id — imageManager.updateImage
            // directly would no-op because tempIds don't exist in SQLite.
            for (const id of childIds) {
              updateImage(id, {
                metadata: {
                  parentJobId: result.queueJobId,
                  parentReplicateId: result.replicateId,
                },
              });
            }

            enqueued++;
          } catch (err) {
            console.error(`[Inspire] enqueue ${i + 1}/${jobCount} failed:`, err);
            const msg = friendlyGenerationError(err instanceof Error ? err.message : null);
            for (const id of childIds) {
              updateImage(id, { status: 'failed', error: msg });
            }
          }
        }

        if (enqueued === 0) {
          throw new Error('Could not start any generation jobs.');
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setState({ isExecuting: false, error: null });
        return true;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Inspire] execution failed:', rawMessage);
        setState({ isExecuting: false, error: rawMessage });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        if (rawMessage.toLowerCase().includes('api key required') || rawMessage.toLowerCase().includes('no api key')) {
          showAuthModal();
        } else {
          // Surface a friendly explanation (e.g. the model's nudity/content filter)
          // instead of the raw "Fal.ai error (422): ..." string.
          Alert.alert('Generation failed to start', friendlyGenerationError(rawMessage));
        }
        return false;
      }
    },
    [startServerCropJob, addImage, updateImage, souls, showAuthModal],
  );

  return { execute, state };
}
