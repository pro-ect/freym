/**
 * useGeneration - Unified Generation Hook
 *
 * Core hook that handles ALL image/video generation in the app.
 * Provides consistent behavior across:
 * - Cloud queue models (Seedream, Ideogram, etc.)
 * - Tools (upscaler, background remover)
 * - Recipes (multi-step workflows)
 * - Batch processing
 *
 * Key Features:
 * - Automatic temp file copying to permanent storage
 * - Image metadata extraction
 * - Base64 conversion (model-specific)
 * - Immediate library entry creation
 * - Queue job submission
 * - Consistent error handling
 * - Configurable notifications
 *
 * Note: Job monitoring (realtime updates, downloads) is handled by useCloudQueueGeneration
 */

import { useCallback, useRef } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { useLibrary } from '../../contexts/LibraryContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { queueManager } from '../../lib/queue/queueManager';
import { imageManager } from '../../lib/imageManager';
import { getImageMetadata } from '../../lib/utils/imageUtils';
import { convertImageToBase64 } from '../../lib/replicate/client';
import { getModelCoinCost } from '../../lib/pricing';
import { uploadImagesToStorage } from '../../lib/storage/imageUpload';
import { supabase } from '../../lib/supabase';
import { capturePH } from '../../lib/posthog';

export interface GenerationInput {
  // Required fields
  prompt: string;
  model: string;      // Model ID (e.g., 'seedream', 'nano-banana')
  modelName: string;  // Display name (e.g., 'Seedream 4.0')

  // Image inputs
  originalImageUri?: string;
  inputImages?: string[];

  // Model parameters
  parameters?: Record<string, any>;

  // Metadata
  metadata?: Record<string, any>;
  batchId?: string;

  // UI configuration
  showStartNotification?: boolean;
  showCompletionNotification?: boolean;
  useAlertForErrors?: boolean;
}

export interface GenerationResult {
  libraryId: string;
  jobId?: string;
}

/**
 * Show toast or alert notification
 */
function showNotification(message: string, useAlert: boolean = false) {
  if (useAlert || Platform.OS === 'ios') {
    Alert.alert('', message);
  } else {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
}

export function useGeneration() {
  const { addImage, updateImage } = useLibrary();
  const { autoSaveToLibrary } = useSettings();
  const { showAuthModal } = useAuth();
  const { showPaywall } = usePaywall();
  const isInitializedRef = useRef(false);

  /**
   * Initialize queue manager (once)
   */
  const initializeQueue = useCallback(async () => {
    if (isInitializedRef.current) return;

    try {
      await queueManager.initialize();
      isInitializedRef.current = true;
      console.log('✅ Generation: Queue manager initialized');
    } catch (error) {
      console.error('❌ Generation: Failed to initialize queue manager:', error);
      throw error;
    }
  }, []);

  /**
   * Main generation function
   *
   * This is the single entry point for ALL generation types.
   * It handles the preparation and submission:
   * 1. Get original image metadata
   * 2. Convert images to base64 (model-specific)
   * 3. File copying (temp → permanent) via addImage
   * 4. Library entry creation
   * 5. Queue job submission
   *
   * Job monitoring (realtime updates, downloads) is handled separately by useCloudQueueGeneration
   */
  const generate = useCallback(async (
    input: GenerationInput
  ): Promise<GenerationResult | null> => {
    const {
      prompt,
      model,
      modelName,
      originalImageUri = '',
      inputImages = [],
      parameters = {},
      metadata = {},
      batchId,
      showStartNotification = true,
      showCompletionNotification = true,
      useAlertForErrors = false,
    } = input;

    // Tools models that don't require a prompt (legacy fallback - prefer using supportsPrompt from cloud)
    const TOOLS_MODELS = ['background-remover', 'background-remover-fal', 'real-esrgan', 'real-esrgan-fal', 'topaz-image-upscale', 'topaz-upscale-fal', 'crystal-upscaler', 'crystal-upscaler-fal'];

    // Validate prompt (skip for tools models)
    if (!prompt.trim() && !TOOLS_MODELS.includes(model)) {
      Alert.alert('Prompt Required', 'Please enter a text prompt');
      return null;
    }

    try {
      // Initialize queue manager
      await initializeQueue();

      console.log('🚀 Generation: Starting', {
        model,
        modelName,
        hasOriginalImage: !!originalImageUri,
        inputImagesCount: inputImages.length,
        hasBatchId: !!batchId,
      });

      // Get original image metadata if provided
      let originalDimensions;
      if (originalImageUri) {
        console.log('📐 Getting original image metadata...');
        originalDimensions = await getImageMetadata(originalImageUri);
        console.log('📐 Original image metadata:', originalDimensions);
      }

      // Calculate coin cost for this model
      const coinCost = getModelCoinCost(model);
      console.log(`💰 Model ${model} cost: ${coinCost} coins`);

      // Create library entry (this also copies temp files to permanent storage)
      // The addImage function in LibraryContext handles file copying automatically
      const libraryId = await addImage({
        originalImageUri,
        inputImages,
        transformedImageUrl: null,
        prompt,
        model: modelName,
        status: 'processing',
        modelId: model,
        batchId,
        ...parameters,
        metadata: {
          ...metadata,
          cloudQueue: true,
          cost: coinCost,
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

      console.log('✅ Generation: Library entry created', { libraryId });

      // Show start notification
      if (showStartNotification) {
        showNotification('⚠️ Keep app open during generation');
      }

      // Process input images based on model type
      let processedParameters = { ...parameters };

      // Check if this is a Fal model (ends with -fal)
      const isFalModel = model.endsWith('-fal');

      if (inputImages.length > 0) {
        if (isFalModel) {
          // Fal models: Upload images to storage and pass URLs
          console.log('🖼️ Uploading images to storage for Fal model...');

          // Get current user for upload path
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            throw new Error('User not authenticated');
          }

          const imageUrls = await uploadImagesToStorage(inputImages, user.id);

          // Store URLs for Fal models
          // Most Fal models use image_urls (array), the edge function handles conversion
          processedParameters.image_urls = imageUrls;

          // Track uploaded URLs for cleanup after generation completes/fails
          processedParameters._uploadedImageUrls = imageUrls;

          console.log(`✅ Uploaded ${imageUrls.length} image(s) to storage`);
        } else {
          // Replicate models: Convert to base64
          console.log('🖼️ Converting input images to base64...');

          const base64Images = await Promise.all(
            inputImages.map(uri => convertImageToBase64(uri))
          );

          // Add to parameters based on model-specific requirements
          if (model === 'nano-banana') {
            processedParameters.image_input = base64Images;
          } else if (model === 'flux-kontext-multi-4' || model === 'flux-kontext-multi-2') {
            processedParameters.input_images = base64Images;
          } else if (model === 'flux-kontext-pro') {
            processedParameters.input_image = base64Images[0];
          } else if (model === 'seedream' || model === 'seedream-direct') {
            processedParameters.image = base64Images.length === 1 ? base64Images[0] : base64Images;
          } else if (model === 'gen4-image') {
            processedParameters.reference_images = base64Images;
          } else if (model === 'ideogram-v3-balanced') {
            processedParameters.style_reference_images = base64Images;
          } else if (model === 'ideogram-character') {
            processedParameters.character_reference_image = base64Images[0];
          } else if (model === 'reve-remix') {
            processedParameters.reference_images = base64Images;
          } else if (model === 'reve-edit') {
            processedParameters.input_image = base64Images[0];
          } else if (inputImages.length === 1) {
            processedParameters.image = base64Images[0];
          } else {
            processedParameters.images = base64Images;
          }

          console.log(`✅ Converted ${base64Images.length} image(s) to base64`);
        }
      }

      // Library-generation marker for orphan adoption (see
      // useCloudQueueGeneration) — Fal-path only; the legacy Replicate
      // function forwards unknown params to the model API.
      if (isFalModel) {
        processedParameters._source = 'library';
      }

      // Submit job to queue
      const response = await queueManager.startPrediction({
        model,
        prompt,
        parameters: processedParameters,
        metadata,
      });

      const jobId = response.job_id;

      console.log('✅ Generation: Job submitted to queue', { jobId });

      capturePH('generation_started', {
        model,
        model_name: modelName,
        coin_cost: coinCost,
        has_input_images: inputImages.length > 0,
        input_image_count: inputImages.length,
        is_fal_model: isFalModel,
        batch_id: batchId,
        library_id: libraryId,
        job_id: jobId,
      });

      // Update library entry with queue job ID
      await imageManager.updateImage(libraryId, {
        metadata: {
          ...metadata,
          queueJobId: jobId,
          cloudQueue: true,
          cost: coinCost,
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

      // Update UI state
      updateImage(libraryId, {
        queueJobId: jobId,
      });

      // Job monitoring happens automatically via useCloudQueueGeneration
      // which listens to realtime updates and handles downloads/completion

      return {
        libraryId,
        jobId,
      };
    } catch (error: any) {
      console.error('❌ Generation: Error', error);
      console.log('[Generation] Error details:', {
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
      const errorMessage = error.message || `Failed to start ${modelName} generation`;

      // Check for insufficient coins - show paywall
      if (error.code === 'COINS_INSUFFICIENT_BALANCE' ||
          error.code === 'INSUFFICIENT_FREE_GENERATIONS' ||
          error.code === 'FAILED_COIN_RESERVATION' ||
          error.statusCode === 402) {
        console.log('[Generation] 📱 INSUFFICIENT_COINS → showing paywall');
        showPaywall('insufficient_coins');
        return null;
      }

      // Check if error is about missing API key - show auth modal instead of notification
      if (errorMessage.toLowerCase().includes('api key required') ||
          errorMessage.toLowerCase().includes('no api key')) {
        showAuthModal();
      } else {
        showNotification(`❌ ${errorMessage}`, useAlertForErrors);
      }

      return null;
    }
  }, [addImage, updateImage, initializeQueue, showAuthModal, showPaywall]);

  /**
   * Batch generation
   *
   * Generates multiple images with the same prompt but potentially different settings
   */
  const generateBatch = useCallback(async (
    inputs: GenerationInput[]
  ): Promise<GenerationResult[]> => {
    console.log('🎯 Generation: Starting batch', { count: inputs.length });

    // Generate a batch ID for grouping
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Submit all jobs in parallel
    const results = await Promise.all(
      inputs.map(input =>
        generate({
          ...input,
          batchId,
          // Only show notification for first job
          showStartNotification: false,
          showCompletionNotification: false,
        })
      )
    );

    // Filter out failed generations
    const successful = results.filter((r): r is GenerationResult => r !== null);

    console.log('✅ Generation: Batch complete', {
      total: inputs.length,
      successful: successful.length,
      failed: inputs.length - successful.length,
    });

    // Show notification for batch
    if (successful.length > 0) {
      showNotification(`🚀 Started ${successful.length} generation${successful.length > 1 ? 's' : ''}`);
    }

    return successful;
  }, [generate]);

  return {
    generate,
    generateBatch,
  };
}
