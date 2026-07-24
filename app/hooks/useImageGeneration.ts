/**
 * Unified Image Generation Hook
 *
 * Combines generation logic for both Editor and Create tabs.
 * Handles validation, parameter formatting, and generation orchestration.
 */

import { Alert } from 'react-native';
import { useCloudQueue } from '../../contexts/CloudQueueContext';
import {
  validateGenerationInputs,
  formatModelParameters,
} from '../../lib/utils/generation';
import { getReplicateModelConfig } from '../config/modelRegistry';

export interface GenerationOptions {
  prompt: string;
  modelIds: string[];
  referenceImages: string[];
  numImagesPerModel?: number;
  batchId?: string;
  originalImageUri?: string;
  customParameters?: Record<string, Record<string, any>>; // Per-model custom params
  metadata?: Record<string, any>; // Additional metadata
  showStartNotification?: boolean;
  showCompletionNotification?: boolean;
}

export function useImageGeneration() {
  const { generateWithQueue } = useCloudQueue();

  /**
   * Generate images with multiple models
   * Used by both Editor and Create tabs
   */
  const generateImages = async (options: GenerationOptions): Promise<string[]> => {
    const {
      prompt,
      modelIds,
      referenceImages,
      numImagesPerModel = 1,
      batchId,
      originalImageUri,
      customParameters = {},
      metadata = {},
      showStartNotification = false,
      showCompletionNotification = true,
    } = options;

    // Validate inputs
    const validation = validateGenerationInputs(modelIds, prompt, referenceImages);
    if (!validation.valid) {
      Alert.alert('Invalid Input', validation.error);
      return [];
    }

    const libraryIds: string[] = [];

    // Generate with each model
    for (const modelId of modelIds) {
      const config = getReplicateModelConfig(modelId);
      if (!config) {
        console.warn(`Unknown model: ${modelId}`);
        continue;
      }

      // Get model-specific custom parameters or use defaults
      const modelCustomParams = customParameters[modelId] || {};

      // Format parameters using centralized logic
      const formattedParams = formatModelParameters(
        modelId,
        {
          num_images: 1, // Each job generates 1 image
          ...modelCustomParams,
        },
        referenceImages
      );

      // Create numImagesPerModel jobs for this model
      for (let i = 0; i < numImagesPerModel; i++) {
        try {
          const libraryId = await generateWithQueue({
            prompt,
            model: modelId,
            modelName: config.name,
            originalImageUri: originalImageUri || (referenceImages.length > 0 ? referenceImages[0] : undefined),
            inputImages: referenceImages,
            parameters: formattedParams,
            metadata: {
              ...metadata,
              batchId,
              imageIndex: i + 1,
              totalImages: numImagesPerModel,
              multiModelBatch: modelIds.length > 1,
              batchModels: modelIds.map(id => getReplicateModelConfig(id)?.name || id).join(', '),
            },
            showStartNotification,
            showCompletionNotification,
            useAlertForErrors: true,
          });

          if (libraryId) {
            libraryIds.push(libraryId);
          }
        } catch (error) {
          console.error(`Failed to generate with ${modelId}:`, error);
        }
      }
    }

    return libraryIds;
  };

  /**
   * Editor-specific: Generate batch with drawing support
   */
  const generateBatch = async (options: {
    prompt: string;
    modelIds: string[];
    inputImage: string;
    numImagesPerModel: number;
    batchId?: string;
    customParameters?: Record<string, Record<string, any>>;
    hasDrawing?: boolean;
  }): Promise<string[]> => {
    const batchId = options.batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return generateImages({
      prompt: options.prompt,
      modelIds: options.modelIds,
      referenceImages: [options.inputImage],
      numImagesPerModel: options.numImagesPerModel,
      batchId,
      originalImageUri: options.inputImage,
      customParameters: options.customParameters,
      metadata: {
        hasDrawing: options.hasDrawing,
      },
      showStartNotification: false,
      showCompletionNotification: true,
    });
  };

  /**
   * Create-specific: Generate with multiple reference images
   */
  const generateWithReferences = async (options: {
    prompt: string;
    modelIds: string[];
    referenceImages: string[];
    numImagesPerModel: number;
    customParameters?: Record<string, Record<string, any>>;
  }): Promise<string[]> => {
    return generateImages({
      prompt: options.prompt,
      modelIds: options.modelIds,
      referenceImages: options.referenceImages,
      numImagesPerModel: options.numImagesPerModel,
      customParameters: options.customParameters,
      showStartNotification: false,
      showCompletionNotification: false, // Create tab has its own notification system
    });
  };

  return {
    generateImages,
    generateBatch,
    generateWithReferences,
  };
}
