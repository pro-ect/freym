import { Platform, ToastAndroid, Alert } from 'react-native';
import { useLibrary } from '../../contexts/LibraryContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { imageManager } from '../../lib/imageManager';

/**
 * Toast notification helper
 */
export const showJobToast = (message: string, useAlert: boolean = false) => {
  if (useAlert) {
    Alert.alert('', message);
  } else if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert('', message);
  }
};

/**
 * Save generated image to imageManager with consistent pattern
 */
export const saveGeneratedImage = async (
  remoteUri: string,
  category: string,
  metadata: Record<string, any>,
  prefetch: boolean = true
) => {
  return await imageManager.saveImage({
    remoteUri,
    type: 'library',
    category,
    metadata: {
      ...metadata,
      status: 'completed',
      completedAt: Date.now(),
    },
    prefetch,
  });
};

/**
 * Options for creating a library job
 */
export interface LibraryJobOptions {
  // Required fields
  prompt: string;
  modelName: string;

  // Optional image inputs
  originalImageUri?: string;
  inputImages?: string[];

  // API configuration
  api?: 'seedream' | 'replicate' | string;
  modelId?: string;

  // Generation options (model-specific)
  options?: Record<string, any>;

  // Metadata
  metadata?: Record<string, any>;

  // UI feedback
  showStartNotification?: boolean;
  showCompletionNotification?: boolean;
  startNotificationMessage?: string;

  // Error handling
  useAlertForErrors?: boolean;
}

/**
 * Result of processing function
 */
export interface ProcessingResult {
  outputUrl: string;
  predictionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Unified hook for creating library jobs with consistent patterns
 *
 * This hook provides:
 * - Immediate library entry creation with 'processing' status
 * - Background processing with error handling
 * - Automatic image download and caching via imageManager
 * - Consistent toast/alert notifications
 * - Automatic media library saving (if enabled in settings)
 */
export function useLibraryJobCreation() {
  const { addImage, updateImage } = useLibrary();
  const { autoSaveToLibrary } = useSettings();
  const { showAuthModal } = useAuth();

  /**
   * Create a library job with unified processing pattern
   *
   * @param jobOptions - Configuration for the library job
   * @param processingFn - Async function that performs the actual generation/transformation
   * @returns Library ID or null if creation failed
   */
  const createJob = async (
    jobOptions: LibraryJobOptions,
    processingFn: (libraryId: string) => Promise<ProcessingResult>
  ): Promise<string | null> => {
    const {
      prompt,
      modelName,
      originalImageUri = '',
      inputImages = [],
      api,
      modelId,
      options,
      metadata = {},
      showStartNotification = true,
      showCompletionNotification = true,
      startNotificationMessage,
      useAlertForErrors = false,
    } = jobOptions;

    // Tools models that don't require a prompt (legacy fallback - prefer using supportsPrompt from cloud)
    const TOOLS_MODELS = ['background-remover', 'background-remover-fal', 'real-esrgan', 'real-esrgan-fal', 'topaz-image-upscale', 'topaz-upscale-fal', 'crystal-upscaler', 'crystal-upscaler-fal'];
    const isToolsModel = modelId && TOOLS_MODELS.includes(modelId);

    // Validate prompt (skip for tools models)
    if (!prompt.trim() && !isToolsModel) {
      Alert.alert('Prompt Required', 'Please enter a text prompt');
      return null;
    }

    try {
      // Create library entry immediately with 'processing' status
      const libraryId = await addImage({
        originalImageUri,
        inputImages,
        transformedImageUrl: null,
        prompt,
        model: modelName,
        status: 'processing',
        ...(api && { api }),
        ...(modelId && { modelId }),
        ...(options && { options }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      });

      // Start notification disabled - jobs run in background

      // Process in background - don't block UI
      (async () => {
        try {
          console.log(`Starting ${modelName} generation...`);
          console.log('Prompt:', prompt);

          // Execute the actual processing
          const result = await processingFn(libraryId);

          console.log('✅ Generation completed:', result.outputUrl);

          // Download the result and update existing record
          console.log('💾 Downloading generated image...');
          const { downloadImageToCache } = await import('../../lib/utils/imageDownloader');

          // Download to local cache
          const localUri = await downloadImageToCache(result.outputUrl);

          // Update the existing database record with the output
          await imageManager.updateImage(libraryId, {
            localUri,
            metadata: {
              model: modelName,
              prompt,
              originalImageUri,
              inputImages,
              status: 'completed',
              completedAt: Date.now(),
              ...(api && { api }),
              ...(modelId && { modelId }),
              ...(options && options),
              ...(metadata && metadata),
              ...(result.metadata && result.metadata),
            },
          });

          console.log('Image saved to:', localUri);

          // Optionally save to media library
          if (autoSaveToLibrary) {
            const { saveImageToMediaLibrary } = await import('../../lib/utils/imageDownloader');
            saveImageToMediaLibrary(localUri).catch(err => {
              console.warn('Failed to save to media library:', err);
            });
          }

          // Update library context with completed status
          updateImage(libraryId, {
            status: 'completed',
            transformedImageUrl: localUri,
            completedAt: Date.now(),
          });

          // Show completion notification
          if (showCompletionNotification) {
            showJobToast(`✅ ${modelName} completed!`);
          }
        } catch (error: any) {
          console.error(`${modelName} generation error:`, error);
          const errorMessage = error.message || `Failed to generate with ${modelName}`;

          try {
            // Update library with failed status
            updateImage(libraryId, {
              status: 'failed',
              error: errorMessage,
            });
          } catch (updateError: any) {
            console.error('⚠️ Error updating failed status:', updateError.message);
          }

          // Check if error is about missing API key - show auth modal instead of notification
          if (errorMessage.toLowerCase().includes('api key required') ||
              errorMessage.toLowerCase().includes('no api key')) {
            showAuthModal();
          } else {
            // Show error notification
            const errorNotification = `❌ Generation failed: ${errorMessage}`;
            showJobToast(errorNotification, useAlertForErrors);
          }
        }
      })();

      // Return library ID so caller knows generation was started
      return libraryId;
    } catch (error: any) {
      console.error('Setup error:', error);
      const errorMessage = error.message || 'Failed to start generation';

      // Check if error is about missing API key - show auth modal instead of alert
      if (errorMessage.toLowerCase().includes('api key required') ||
          errorMessage.toLowerCase().includes('no api key')) {
        showAuthModal();
      } else {
        Alert.alert('Error', errorMessage);
      }
      return null;
    }
  };

  return {
    createJob,
    showJobToast,
    saveGeneratedImage,
  };
}
