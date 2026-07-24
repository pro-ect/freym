/**
 * useRecipeExecution Hook
 *
 * Single-step execution path:
 *  - Picks recipe.steps[0]
 *  - For each model × each prompt, enqueues a cloud-queue job
 *  - Returns once all jobs are enqueued (does NOT wait for completion;
 *    the Library tab surfaces in-flight jobs on its own).
 */

import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { useAuth } from '../../contexts/AuthModalContext';
import { useCloudQueueGeneration } from './useCloudQueueGeneration';
import { getReplicateModelConfig, ReplicateModelConfig } from '../config/modelRegistry';
import type { Recipe, RecipeStep } from '../../lib/recipes/types';
import { useSouls } from '../../contexts/SoulsContext';
import { useSettings } from '../../contexts/SettingsContext';
import { mapModelsForProvider } from '../../lib/utils/generation';
import { useImageModels } from './useCloudModels';
import { fetchPublicRecipe } from '../../lib/recipes/supabaseRecipes';
import { updateRecipe } from '../../lib/recipes/recipeQueries';

export interface RecipeExecutionState {
  isExecuting: boolean;
  error: string | null;
}

async function filterExistingFiles(uris: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const uri of uris) {
    try {
      const info = await FileSystemLegacy.getInfoAsync(uri);
      if (info.exists) out.push(uri);
    } catch {
      // ignore — drop missing files silently
    }
  }
  return out;
}

function collectPrompts(step: RecipeStep | undefined): string[] {
  if (!step) return [];
  const arr = Array.isArray((step as any).prompts) ? (step as any).prompts : [];
  const trimmed = arr.filter((p: any): p is string => typeof p === 'string' && p.trim().length > 0);
  if (trimmed.length > 0) return trimmed;
  const legacy = (step as any).prompt;
  if (typeof legacy === 'string' && legacy.trim().length > 0) return [legacy];
  return [];
}

// Recipe-only resolution defaults. Studio has its own per-param UI; recipes only
// pass aspect_ratio today, so we patch in higher-res defaults here for models
// where the Supabase defaults would either be too low (nano-banana-2: 1K) or
// get downgraded by the edge function's aspect_ratio → image_size conversion
// (seedream: 2K, gpt-image-2: ~1K preset).
function applyRecipeResolutionDefault(modelId: string, params: Record<string, any>): void {
  if (modelId === 'nano-banana-2-fal') {
    params.resolution = '2K';
    return;
  }
  if (modelId === 'seedream-4.5-fal') {
    const ratioToPreset: Record<string, string> = {
      '9:16': 'Vertical 4K',
      '3:4': 'Portrait 4K',
      '1:1': 'Square 4K',
      '4:3': 'Landscape 4K',
      '16:9': 'Wide 4K',
    };
    const preset = ratioToPreset[params.aspect_ratio];
    if (preset) {
      delete params.aspect_ratio;
      params.image_size = preset;
    }
    return;
  }
  if (modelId === 'gpt-image-2-fal') {
    // Always vertical; default 2K. Future builder option: 1K (1024x1536) / 4K (2160x3840).
    delete params.aspect_ratio;
    params.image_size = '1440x2560';
    return;
  }
}

export function useRecipeExecution() {
  const { generateWithQueue } = useCloudQueueGeneration();
  const { souls } = useSouls();
  const { apiProvider } = useSettings();
  const { showAuthModal } = useAuth();
  const { models: cloudModels } = useImageModels();

  const [state, setState] = useState<RecipeExecutionState>({
    isExecuting: false,
    error: null,
  });

  const executeRecipe = useCallback(
    async (recipe: Recipe, inputImages: string[]): Promise<boolean> => {
      const step = recipe.steps[0];
      if (!step) {
        console.warn('⚠️ Recipe has no steps:', recipe.id);
        return false;
      }

      setState({ isExecuting: true, error: null });

      try {
        // Rescue stale local data FIRST, before computing input arrays. Local
        // SQLite rows imported before May 17 (commit ebde36f4a, v14 migration
        // that added photo_input_label) can carry stale soulId / refs /
        // missing photoInputLabel that leak into allInputImages once execution
        // starts. One Supabase round-trip per Run heals all of these
        // uniformly; the "Generation started" alert already covers the
        // latency, and offline runs fall back to local data via the catch.
        let resolvedRecipe: Recipe = recipe;
        let resolvedStep: RecipeStep = step;

        if (recipe.supabaseRecipeId) {
          try {
            const fresh = await fetchPublicRecipe(recipe.supabaseRecipeId);
            const freshStep = fresh?.recipe_data?.steps?.[0] as RecipeStep | undefined;
            if (fresh && freshStep && collectPrompts(freshStep).length > 0) {
              resolvedStep = freshStep;
              resolvedRecipe = {
                ...recipe,
                steps: fresh.recipe_data.steps as RecipeStep[],
                photoInputLabel: fresh.recipe_data.photoInputLabel,
                inputType: fresh.recipe_data.inputType,
                inputDescription: fresh.recipe_data.inputDescription,
                instructions: fresh.recipe_data.instructions,
                // If Supabase row carries no referenceImageUrls, treat any
                // local refs as stale leftovers (they would otherwise leak
                // into allInputImages as baked refs).
                referenceImageUris: (fresh.recipe_data as any).referenceImageUrls?.length
                  ? recipe.referenceImageUris
                  : undefined,
              };
              try {
                await updateRecipe(recipe.id, {
                  steps: resolvedRecipe.steps,
                  photoInputLabel: resolvedRecipe.photoInputLabel,
                  inputType: resolvedRecipe.inputType,
                  inputDescription: resolvedRecipe.inputDescription,
                  instructions: resolvedRecipe.instructions,
                  referenceImageUris: resolvedRecipe.referenceImageUris,
                });
              } catch (persistErr) {
                console.warn('Failed to persist healed recipe to local SQLite:', persistErr);
              }
            }
          } catch (fetchErr) {
            console.warn('Supabase rescue fetch failed, using local data:', fetchErr);
          }
        }

        const isAnyPhotoMode = !!resolvedRecipe.photoInputLabel?.trim();

        // Admin-baked recipe reference images (invisible to users). Skipped in
        // any-photo mode: single-image models (flux-kontext-pro, generic
        // image-to-image fallback) only read index 0, so a baked ref would beat
        // the user's uploaded photo and the model would ignore the upload.
        const recipeRefImages = (!isAnyPhotoMode && resolvedRecipe.referenceImageUris?.length)
          ? await filterExistingFiles(resolvedRecipe.referenceImageUris)
          : [];

        // Resolve soul images attached to the step (skipped for any-photo recipes).
        let soulImages: string[] = [];
        if (!isAnyPhotoMode && resolvedStep.soulId) {
          const soul = souls.find(s => s.id === resolvedStep.soulId);
          if (soul) {
            soulImages = await filterExistingFiles(soul.imageUris);
          }
        }

        // Combined input order: recipe refs → soul images → user uploads.
        const allInputImages = [...recipeRefImages, ...soulImages, ...inputImages];

        // Map models to fal equivalents when needed (with legacy singular
        // `modelId` fallback for older recipes).
        const originalModelIds = resolvedStep.modelIds || (resolvedStep.modelId ? [resolvedStep.modelId] : []);
        const modelIds = mapModelsForProvider(originalModelIds, apiProvider);

        // Final prompt validation with legacy singular `prompt` fallback —
        // the three display paths (app/recipe/[id].tsx:387,
        // RecipeViewModal:49, RecipeBuilderModal:170) all tolerate
        // {prompts: undefined | [""], prompt: "..."}; execution should too.
        const validPrompts = collectPrompts(resolvedStep);
        if (validPrompts.length === 0) {
          console.error('Recipe step has no prompts after rescue:', {
            recipeId: recipe.id,
            supabaseRecipeId: recipe.supabaseRecipeId,
            step,
          });
          throw new Error('Recipe step has no prompts.');
        }
        if (modelIds.length === 0) {
          throw new Error('Recipe step has no models.');
        }

        let enqueuedCount = 0;

        for (let modelIdx = 0; modelIdx < modelIds.length; modelIdx++) {
          const modelId = modelIds[modelIdx];

          let modelConfig: ReplicateModelConfig | undefined = getReplicateModelConfig(modelId);
          if (!modelConfig) {
            const cloudModel = cloudModels.find(m => m.slug === modelId);
            if (cloudModel) {
              modelConfig = {
                id: cloudModel.slug,
                name: cloudModel.name,
                description: cloudModel.description || '',
                requiresReferenceImages: cloudModel.referenceImagesMin > 0,
                minReferenceImages: cloudModel.referenceImagesMin,
                maxReferenceImages: cloudModel.referenceImagesMax,
                imageParameterName: cloudModel.imageParameterName as any,
                defaultParameters: {},
              };
            }
          }
          if (!modelConfig) {
            console.error(`❌ Unknown model: ${modelId}, skipping`);
            continue;
          }

          for (let promptIdx = 0; promptIdx < validPrompts.length; promptIdx++) {
            const prompt = validPrompts[promptIdx];

            // Fan out client-side: one job per output image (mirrors Studio at
            // app/(tabs)/create.tsx:614-617). The webhook/result_url schema only
            // holds one URL per generation_queue row, so a single job asking for
            // N outputs would discard images 2..N. Loop instead.
            const jobCount = Math.max(1, resolvedStep.numImages || 1);

            const generationParameters: Record<string, any> = {
              ...(modelConfig.defaultParameters || {}),
              aspect_ratio: resolvedStep.aspectRatio || '9:16',
            };
            if (modelConfig.imageParameterName) {
              generationParameters._imageParameterName = modelConfig.imageParameterName;
            }

            // Per-model resolution upgrades for recipes (Studio uses its own UI).
            // A future Recipe Builder option will let admins pick 1K/2K/4K per recipe.
            applyRecipeResolutionDefault(modelId, generationParameters);

            for (let jobIdx = 0; jobIdx < jobCount; jobIdx++) {
              try {
                await generateWithQueue({
                  prompt,
                  model: modelId,
                  modelName: modelConfig.name,
                  originalImageUri: allInputImages[0],
                  inputImages: allInputImages,
                  parameters: generationParameters,
                  metadata: {
                    recipeId: recipe.id,
                    recipeStepId: resolvedStep.id,
                    recipeStepOrder: resolvedStep.order,
                    recipePromptIndex: promptIdx,
                    recipeModelIndex: modelIdx,
                    recipeJobIndex: jobIdx,
                    recipeJobCount: jobCount,
                    modelId,
                    soulId: isAnyPhotoMode ? undefined : resolvedStep.soulId,
                    fromCommunityRecipe: !!recipe.supabaseRecipeId,
                    recipeReferenceImageCount: recipeRefImages.length || undefined,
                  },
                  showStartNotification: false,
                  showCompletionNotification: false,
                });
                enqueuedCount++;
              } catch (error) {
                console.error(`❌ Failed to enqueue (${modelConfig.name}, prompt ${promptIdx + 1}, job ${jobIdx + 1}/${jobCount}):`, error);
              }
            }
          }
        }

        if (enqueuedCount === 0) {
          throw new Error('Could not enqueue any jobs. Check model configuration.');
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setState({ isExecuting: false, error: null });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ Recipe execution failed:', message);
        setState({ isExecuting: false, error: message });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        if (message.toLowerCase().includes('api key required') ||
            message.toLowerCase().includes('no api key')) {
          showAuthModal();
        } else {
          Alert.alert('Generation failed to start', message);
        }
        return false;
      }
    },
    [generateWithQueue, souls, apiProvider, showAuthModal, cloudModels],
  );

  return { executeRecipe, state };
}
