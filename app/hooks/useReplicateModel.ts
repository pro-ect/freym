/**
 * useReplicateModel Hook
 *
 * Unified hook for all third-party Replicate models.
 * Supports both local registry models and cloud-only models from Supabase.
 *
 * This provides a single, consistent interface for all Replicate models while
 * maintaining type safety and proper metadata handling.
 */

import { Alert } from 'react-native';
import { useCloudQueue } from '../../contexts/CloudQueueContext';
import { useCloudModels } from './useCloudModels';
import {
  getReplicateModelConfig,
  validateReferenceImages,
  ReplicateModelConfig,
} from '../config/modelRegistry';

export interface ReplicateModelOptions {
  // Common parameters (supported by multiple models)
  aspect_ratio?: string;
  resolution?: string;
  seed?: number;

  // Ideogram-specific
  style_type?: string;
  style_preset?: string;
  magic_prompt_option?: 'Auto' | 'On' | 'Off';
  rendering_speed?: 'Default' | 'Turbo' | 'Quality';
  inpainting_image?: string;
  inpainting_mask?: string;

  // Nano Banana specific
  num_images?: number;
  output_format?: 'jpg' | 'png';

  // Gen-4 specific
  reference_tags?: string[];

  // Reve specific
  version?: string;

  // Allow any other parameters
  [key: string]: any;
}

export function useReplicateModel() {
  const { generateWithQueue } = useCloudQueue();
  // Use all cloud models (both image and video categories)
  const { models: cloudModels } = useCloudModels();

  /**
   * Generate using any Replicate model
   *
   * @param modelId - Model slug (e.g., 'nano-banana', 'flux-2-pro')
   * @param prompt - Text prompt for generation
   * @param referenceImages - Optional reference images
   * @param options - Model-specific options
   * @returns Library ID or null if generation failed
   */
  const generate = async (
    modelId: string,
    prompt: string,
    referenceImages: string[] = [],
    options: ReplicateModelOptions = {}
  ): Promise<string | null> => {
    console.log(`🎨 [useReplicateModel] Starting generation for model: ${modelId}`);
    console.log(`🎨 [useReplicateModel] Prompt: ${prompt?.substring(0, 50)}...`);
    console.log(`🎨 [useReplicateModel] Reference images: ${referenceImages.length}`);
    console.log(`🎨 [useReplicateModel] Options:`, JSON.stringify(options, null, 2));

    // First try local registry
    let config = getReplicateModelConfig(modelId);
    let isCloudOnlyModel = false;
    let supportsPrompt = true; // Default to requiring prompt

    // If not in local registry, try cloud models
    if (!config) {
      console.log(`🎨 [useReplicateModel] Model not in local registry, checking cloud models...`);
      const cloudModel = cloudModels.find(m => m.slug === modelId);

      if (cloudModel) {
        console.log(`🎨 [useReplicateModel] Found cloud model: ${cloudModel.name}`);
        isCloudOnlyModel = true;
        supportsPrompt = cloudModel.supportsPrompt;

        // Create a config from cloud model data
        config = {
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

    if (!config) {
      console.error(`❌ [useReplicateModel] Unknown model: ${modelId}`);
      console.error(`❌ [useReplicateModel] Available local models: ${Object.keys(require('../config/modelRegistry').REPLICATE_MODEL_REGISTRY).join(', ')}`);
      console.error(`❌ [useReplicateModel] Available cloud models: ${cloudModels.map(m => m.slug).join(', ')}`);
      Alert.alert('Error', `Unknown model: ${modelId}. Please check the model configuration.`);
      return null;
    }

    console.log(`🎨 [useReplicateModel] Using config:`, {
      id: config.id,
      name: config.name,
      isCloudOnly: isCloudOnlyModel,
    });

    // Validate reference images (skip for cloud-only models as validation happens server-side)
    if (!isCloudOnlyModel) {
      const validation = validateReferenceImages(modelId, referenceImages);
      if (!validation.valid) {
        console.error(`❌ [useReplicateModel] Image validation failed: ${validation.error}`);
        Alert.alert('Invalid Images', validation.error || 'Invalid reference images');
        return null;
      }
    }

    // Merge with default parameters
    const parameters: Record<string, any> = {
      ...config.defaultParameters,
      ...options,
    };

    // Pass image parameter name hint for cloud-only models
    if (isCloudOnlyModel && config.imageParameterName) {
      parameters._imageParameterName = config.imageParameterName;
    }

    console.log(`🎨 [useReplicateModel] Final parameters:`, JSON.stringify(parameters, null, 2));

    // Extract metadata using model-specific function (if available)
    const extractedMetadata = config.extractMetadata
      ? config.extractMetadata(parameters, referenceImages)
      : {};

    // Generate using cloud queue
    console.log(`🎨 [useReplicateModel] Calling generateWithQueue...`);

    try {
      const result = await generateWithQueue({
        prompt,
        model: config.id,
        modelName: config.name,
        originalImageUri: referenceImages[0] || '',
        inputImages: referenceImages,
        parameters,
        supportsPrompt, // Pass from cloud model to skip prompt validation for tools
        metadata: {
          // Top-level fields for quick access/filtering
          ...extractedMetadata,

          // Store full parameters for ImageDetailsModal display
          parameters: {
            ...parameters,
          },
        },
        showStartNotification: true,
        showCompletionNotification: true,
        useAlertForErrors: true,
      });

      console.log(`✅ [useReplicateModel] Generation queued successfully, result:`, result);
      return result;
    } catch (error) {
      console.error(`❌ [useReplicateModel] Generation failed:`, error);
      throw error;
    }
  };

  return {
    generate,
  };
}
