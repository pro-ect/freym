import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Text, View, Pressable, StyleSheet, TextInput, ActivityIndicator, Alert, ScrollView, Image, Keyboard, ToastAndroid, Platform, StatusBar, TouchableOpacity, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useAnimatedKeyboard, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Path, Skia, SkPath } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import ZoomableImage from '../components/ZoomableImage';
import { ModelSelectionModal, AIModel } from '../components/ModelSelectionModal';
import { useCloudQueue } from '../../contexts/CloudQueueContext';
import { useLibrary } from '../../contexts/LibraryContext';
import { Zap, X, ChevronDown, Pencil, ArrowUp, ChevronLeft, Settings as SettingsIcon } from 'lucide-react-native';
// Pricing now comes directly from cloud models (editModels.costCoins)
import { useBackgroundTaskManager } from '../hooks/useBackgroundTaskManager';
import { useImageModels } from '../hooks/useCloudModels';
import { CloudModel } from '../../lib/cloudModels';
import { gptImage2CoinCost } from '../../lib/pricing';
import { useImageGeneration } from '../hooks/useImageGeneration';
import EditorPreviewGallery from '../components/EditorPreviewGallery';
import { useSettings } from '../../contexts/SettingsContext';
import { useApiKeyModal } from '../../contexts/ApiKeyModalContext';
import { useAuth } from '../../contexts/AuthModalContext';

import { useBalance } from '../../contexts/BalanceContext';
import {
  resumeTransformation as replicateResume
} from '../../lib/replicate/client';
import { supabase } from '../../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import { useReplicateBalance } from '../hooks/useReplicateBalance';
import GenerationsChip from '../components/GenerationsChip';
import GlassPill from '../components/GlassPill';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { ensureAIConsent } from '../../lib/ai/aiConsent';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';
import { useTranslation } from 'react-i18next';

interface ImageMetadata {
  inputSize?: { width: number; height: number; sizeKB: number; sizeMB: string };
  outputSize?: { width: number; height: number; sizeKB: number; sizeMB: string };
  model: string;
  apiEndpoint: string;
  compressionQuality?: string;
  format: string;
  timings?: { optimization?: string; api?: string; total: string };
  parameters?: Record<string, any>;
}

// Allow-list of model slugs in the Edit tab. Each supports BOTH text-to-image
// (no picture) AND image-to-image (with a picture) via Supabase
// `replicate_version` + `edit_endpoint`.
const EDIT_TAB_MODEL_SLUGS = new Set([
  'nano-banana-2-fal',
  'nano-banana-pro-2k-fal',
  'seedream-5-pro-fal',
  'gpt-image-2-fal',
  'seedream-4.5-fal',
]);

// Aspect ratio options that preserve input image aspect ratio
const AUTO_ASPECT_OPTIONS = ['auto', 'match_input_image', 'keep'];

// Map named size options to their approximate aspect ratios
const SIZE_TO_ASPECT_MAP: Record<string, number> = {
  'Square 2K': 1,
  'Square 4K': 1,
  'Portrait 2K': 3 / 4,
  'Portrait 4K': 3 / 4,
  'Landscape 2K': 4 / 3,
  'Landscape 4K': 4 / 3,
  'Vertical 2K': 9 / 16,
  'Vertical 4K': 9 / 16,
  'Wide 2K': 16 / 9,
  'Wide 4K': 16 / 9,
};

// Parse aspect ratio string like "16:9" to a number
function parseAspectRatio(ratio: string): number | null {
  if (SIZE_TO_ASPECT_MAP[ratio]) {
    return SIZE_TO_ASPECT_MAP[ratio];
  }
  const match = ratio.match(/^(\d+):(\d+)$/);
  if (match) {
    return parseInt(match[1]) / parseInt(match[2]);
  }
  return null;
}

// Find the closest aspect ratio option for an image
function findClosestAspectRatio(
  imageWidth: number,
  imageHeight: number,
  paramSchema: Record<string, any> | undefined
): string | null {
  if (!paramSchema) return null;

  // Get the aspect_ratio or image_size options from param_schema
  const aspectConfig = paramSchema.aspect_ratio || paramSchema.image_size;
  if (!aspectConfig?.options || !Array.isArray(aspectConfig.options)) {
    return null;
  }

  const options: string[] = aspectConfig.options;

  // Check if model has auto/match option - if so, use it
  for (const opt of options) {
    if (AUTO_ASPECT_OPTIONS.includes(opt.toLowerCase())) {
      return opt;
    }
  }

  // Calculate input image aspect ratio
  const inputRatio = imageWidth / imageHeight;

  // Find the closest match
  let closestOption = options[0];
  let closestDiff = Infinity;

  for (const option of options) {
    const optionRatio = parseAspectRatio(option);
    if (optionRatio !== null) {
      const diff = Math.abs(inputRatio - optionRatio);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestOption = option;
      }
    }
  }

  console.log(`📐 Closest aspect ratio for ${imageWidth}x${imageHeight} (ratio: ${inputRatio.toFixed(3)}): ${closestOption}`);
  return closestOption;
}

// Check if a model supports auto aspect ratio
function modelSupportsAutoAspect(paramSchema: Record<string, any> | undefined): boolean {
  if (!paramSchema) return false;
  const aspectConfig = paramSchema.aspect_ratio || paramSchema.image_size;
  if (!aspectConfig?.options || !Array.isArray(aspectConfig.options)) {
    return false;
  }
  return aspectConfig.options.some((opt: string) =>
    AUTO_ASPECT_OPTIONS.includes(opt.toLowerCase())
  );
}

// Convert CloudModel to AIModel for ModelSelectionModal
function cloudModelToAIModel(cloudModel: CloudModel): AIModel {
  return {
    id: cloudModel.slug,
    name: cloudModel.name,
    provider: cloudModel.slug.endsWith('-fal') ? 'Fal' : 'Replicate',
    description: cloudModel.description || '',
    capabilities: [],
    maxTokens: 4096,
    pricePerToken: 0.00001,
    color: '#8b5cf6', // Default purple, can be customized per model
    recommended: cloudModel.isNew,
    speed: 'fast',
    quality: 'high',
    api: cloudModel.slug.endsWith('-fal') ? 'fal' : 'replicate'
  };
}

export default function Editor() {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isPickerProcessing, setIsPickerProcessing] = useState(false);
  const [transformedImage, setTransformedImage] = useState<string | null>(null);
  const [isPressing, setIsPressing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isTransforming, setIsTransforming] = useState(false);
  const [selectedModels, setSelectedModels] = useState<AIModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [imageSize] = useState<'1K' | '2K' | '4K'>('4K'); // Always use best quality
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentDisplayImage, setCurrentDisplayImage] = useState<string | null>(null);
  const [batchOriginalImage, setBatchOriginalImage] = useState<string | null>(null); // The "original" for current batch (what we're editing from)

  // Cloud models from Supabase
  const { models: allCloudModels, isLoading: modelsLoading } = useImageModels();

  // Get API provider setting
  const { apiProvider } = useSettings();

  // Filter models: 1) by provider (fal vs replicate), 2) by 'edit' tag
  const editModels = useMemo(() => {
    // First filter by provider
    const providerFiltered = apiProvider === 'fal'
      ? allCloudModels.filter(m => m.slug.endsWith('-fal') || m.slug.endsWith('-phota'))
      : allCloudModels.filter(m => !m.slug.endsWith('-fal') && !m.slug.endsWith('-phota'));

    // Then filter to the curated allow-list of dual-mode (t2i + i2i) models.
    // Allow-list is the source of truth — `edit` tag is no longer required because
    // some entries (e.g. gpt-image-2-fal) are tagged only with text-to-image / image-to-image.
    return providerFiltered.filter(m => EDIT_TAB_MODEL_SLUGS.has(m.slug));
  }, [allCloudModels, apiProvider]);

  // Convert cloud models to AIModel format for ModelSelectionModal
  const aiModels = useMemo(() => {
    return editModels.map(cloudModelToAIModel);
  }, [editModels]);

  // Auto-select first model when models load or when provider changes
  useEffect(() => {
    if (aiModels.length === 0) return;

    // Check if current selection is valid (exists in current model list)
    const validSelection = selectedModels.filter(selected =>
      aiModels.some(m => m.id === selected.id)
    );

    if (validSelection.length === 0) {
      // No valid selection, prefer nano-banana-2-fal, fallback to first model
      const preferred = aiModels.find(m => m.id === 'nano-banana-2-fal') || aiModels[0];
      setSelectedModels([preferred]);
    } else if (validSelection.length !== selectedModels.length) {
      // Some models were invalid, update to only valid ones
      setSelectedModels(validSelection);
    }
  }, [aiModels]);

  // Get BYOK status for pricing display - use balance context as it's properly synced after key save
  const { hasCustomKey: hasCustomApiKey, balanceInfo: coinBalanceInfo } = useBalance();
  const { checkCanGenerate } = useApiKeyModal();
  const { requireSession } = useAuth();
  const { showPaywall } = usePaywall();

  // Use new unified generation hook
  const { generateBatch } = useImageGeneration();


  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnImageUri, setDrawnImageUri] = useState<string | null>(null);
  const [paths, setPaths] = useState<SkPath[]>([]);
  const currentPathRef = useRef<SkPath | null>(null);
  const drawingContainerRef = useRef<View>(null);

  // Drawing helper functions for gesture handler
  const startNewPath = useCallback((x: number, y: number) => {
    const newPath = Skia.Path.Make();
    newPath.moveTo(x, y);
    currentPathRef.current = newPath;
    setPaths((currentPaths) => [...currentPaths, newPath]);
  }, []);

  const updateCurrentPath = useCallback((x: number, y: number) => {
    if (currentPathRef.current) {
      currentPathRef.current.lineTo(x, y);
      // Force re-render by creating new array reference
      setPaths((currentPaths) => [...currentPaths]);
    }
  }, []);

  const transformButtonRef = useRef<View>(null);

  // Component mount state - prevents memory leaks
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fine-tune entry point: Library detail modal pushes here with
  // `fineTuneUri`/`fineTuneNonce` params to preload an existing photo.
  const router = useRouter();
  const fineTuneParams = useLocalSearchParams<{
    fineTuneUri?: string;
    fineTuneWidth?: string;
    fineTuneHeight?: string;
    fineTuneNonce?: string;
    standalone?: string;
  }>();
  const consumedFineTuneNonceRef = useRef<string | null>(null);
  // When opened as the standalone /fine-tune route (not the Edit tab) there is
  // no tab bar to leave by, so show a back button that pops the stack.
  const isStandalone = fineTuneParams.standalone === '1';

  // Library context
  const { addImage, updateImage, images } = useLibrary();

  // Cloud queue generation
  const { generateWithQueue } = useCloudQueue();

  // Restore batchId when tab is focused or component mounts
  // This fixes the issue where gallery disappears after tab switch
  useEffect(() => {
    // Only restore if we don't have a currentBatchId but have a selectedImage
    if (currentBatchId || !selectedImage) {
      return;
    }

    // Find the most recent batch that includes images with this original image
    const recentBatches = images
      .filter(img =>
        img.batchId &&
        img.originalImageUri === selectedImage &&
        // Only include recent images (within last hour)
        Date.now() - img.createdAt < 60 * 60 * 1000
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    if (recentBatches.length > 0 && recentBatches[0].batchId) {
      const mostRecentBatchId = recentBatches[0].batchId;
      console.log('🔄 Restoring batchId after tab switch:', {
        batchId: mostRecentBatchId,
        imagesInBatch: recentBatches.filter(img => img.batchId === mostRecentBatchId).length,
      });
      setCurrentBatchId(mostRecentBatchId);

      // Also restore the display image if we have a completed one
      const completedImages = recentBatches.filter(
        img => img.batchId === mostRecentBatchId && img.status === 'completed' && img.transformedImageUrl
      );
      if (completedImages.length > 0 && !currentDisplayImage) {
        setCurrentDisplayImage(completedImages[0].transformedImageUrl);
        setTransformedImage(completedImages[0].transformedImageUrl);
      }
    }
  }, [selectedImage, images, currentBatchId, currentDisplayImage]);

  // Text-to-image mode: auto-display the first completed result of the active batch
  // (no source photo means the empty state would otherwise persist after generation).
  useEffect(() => {
    if (!currentBatchId || selectedImage || currentDisplayImage) return;
    const firstDone = images.find(
      (img) =>
        (img.metadata?.batchId === currentBatchId || img.batchId === currentBatchId) &&
        img.status === 'completed' &&
        img.transformedImageUrl
    );
    if (firstDone?.transformedImageUrl) {
      setCurrentDisplayImage(firstDone.transformedImageUrl);
      setTransformedImage(firstDone.transformedImageUrl);
    }
  }, [images, currentBatchId, selectedImage, currentDisplayImage]);

  // Background task manager (keeping for backward compatibility with existing tasks)
  const backgroundTaskManager = useBackgroundTaskManager({
    onResume: async (task) => {
      console.log('🔄 Resuming task:', task.id);
      showToast(t('editor.resumingGeneration'));

      try {
        let result: string;

        if (task.api === 'replicate' && task.predictionId) {
          // Resume Replicate prediction (all models including seedream now use Replicate)
          console.log('Resuming Replicate prediction:', task.predictionId);
          result = await replicateResume(task.predictionId, { name: task.modelId });
        } else {
          throw new Error('Unable to resume: missing prediction ID or invalid API type');
        }

        // Save completed image to database
        console.log('💾 Saving completed image to database...');
        const { imageManager } = await import('../../lib/imageManager');
        await imageManager.saveImage({
          remoteUri: result,
          type: 'library',
          category: task.modelId || 'Generated',
          metadata: {
            prompt: task.prompt,
            model: task.modelId,
            status: 'completed',
            completedAt: Date.now(),
            originalImageUri: task.imageUri,
            inputImages: task.inputImages,
            api: task.api,
            predictionId: task.predictionId,
            taskId: task.id,
          },
          prefetch: true,
        });
        console.log('💾 Image saved to database successfully');

        // Update library with result
        updateImage(task.libraryId, {
          status: 'completed',
          transformedImageUrl: result,
          completedAt: Date.now(),
        });

        // Update UI if this is the current library item
        if (currentLibraryId === task.libraryId) {
          setTransformedImage(result);
          showToast(t('editor.generationCompleted'));
        }

        // Complete the background task
        backgroundTaskManager.completeTask(task.id, 'completed', result);
      } catch (error: any) {
        console.error('❌ Failed to resume task:', error);
        updateImage(task.libraryId, {
          status: 'failed',
          error: error.message,
        });
        backgroundTaskManager.completeTask(task.id, 'failed', error);
        showToast(t('editor.resumeFailed', { message: error.message }));
      }
    },
    onPause: (task) => {
      console.log('⏸️ Task paused:', task.id);
      // Update library item status
      updateImage(task.libraryId, {
        status: 'paused',
      });
    },
  });

  // Optimal default settings for Seedream 4.0
  const [sequentialGeneration] = useState<'auto' | 'disabled'>('disabled');
  const [maxImages, setMaxImages] = useState<number>(1);
  const [enableStream] = useState(false);
  const [responseFormat] = useState<'url' | 'b64_json'>('url');
  const [enableWatermark] = useState(false); // No watermark for best quality
  const [optimizePromptMode] = useState<'standard' | 'fast'>('standard'); // Best quality

  // Optimal default settings for Nano Banana
  const [numImages, setNumImages] = useState<number>(1);
  const [outputFormat] = useState<'jpg' | 'png'>('png'); // PNG for best quality
  const [aspectRatio, setAspectRatio] = useState<string>('keep'); // Keep original aspect ratio by default
  const [inputImageDimensions, setInputImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Recalculate aspect ratio when model changes (if image is already selected)
  useEffect(() => {
    if (!inputImageDimensions || selectedModels.length === 0) return;

    const selectedModel = selectedModels[0];
    const cloudModel = editModels.find(m => m.slug === selectedModel.id);
    const paramSchema = cloudModel?.paramSchema;

    if (paramSchema && !modelSupportsAutoAspect(paramSchema)) {
      // Model doesn't support auto - find closest match
      const closestAspect = findClosestAspectRatio(
        inputImageDimensions.width,
        inputImageDimensions.height,
        paramSchema
      );
      if (closestAspect && closestAspect !== aspectRatio) {
        setAspectRatio(closestAspect);
        console.log(`📐 Model changed - auto-selected aspect ratio '${closestAspect}' (model: ${cloudModel?.name})`);
      }
    } else if (aspectRatio !== 'keep') {
      // Model supports auto/match - reset to 'keep'
      setAspectRatio('keep');
      console.log(`📐 Model changed - reset to 'keep' (model supports auto aspect)`);
    }
  }, [selectedModels, editModels, inputImageDimensions]);

  // Consume Fine tune navigation params from Library detail modal.
  // The `fineTuneNonce` (timestamp) guards against the effect re-firing on
  // re-renders and lets the same URI re-trigger a load on subsequent taps.
  useEffect(() => {
    const { fineTuneUri, fineTuneWidth, fineTuneHeight, fineTuneNonce } = fineTuneParams;
    if (!fineTuneUri || !fineTuneNonce) return;
    if (consumedFineTuneNonceRef.current === fineTuneNonce) return;
    consumedFineTuneNonceRef.current = fineTuneNonce;

    setSelectedImage(fineTuneUri);
    setTransformedImage(null);
    setIsPressing(false);
    setCurrentLibraryId(null);
    setCurrentBatchId(null);
    setCurrentDisplayImage(null);
    setBatchOriginalImage(null);

    if (fineTuneWidth && fineTuneHeight) {
      const w = parseInt(fineTuneWidth, 10);
      const h = parseInt(fineTuneHeight, 10);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        setInputImageDimensions({ width: w, height: h });
      }
    }

    router.setParams({
      fineTuneUri: undefined,
      fineTuneWidth: undefined,
      fineTuneHeight: undefined,
      fineTuneNonce: undefined,
    });
  }, [fineTuneParams.fineTuneNonce]);

  // Track keyboard visibility
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  // Balance is now handled by BalanceContext with realtime updates

  // Calculate total cost using cloud model data directly (not fallback pricing)
  // Numeric coin cost for the current selection (used for both the price badge
  // and the pre-flight balance gate).
  const getTotalCostCoins = () => {
    return selectedModels.reduce((total, selectedModel) => {
      const cloudModel = editModels.find(m => m.slug === selectedModel.id);
      // GPT Image 2: quality × resolution pricing (quality defaults to high here;
      // the Imagine tab exposes size via aspectRatio but not the quality tier).
      if (cloudModel?.slug === 'gpt-image-2-fal') {
        const size = aspectRatio !== 'keep' ? aspectRatio : '1024x1024';
        return total + gptImage2CoinCost('high', size) * numImages;
      }
      // Seedream 5.0 Pro: 1K/2K tiers — 2K doubles the base cost. Must match
      // seedreamProCoinsForRun in create.tsx & start-prediction-fal/index.ts.
      if (cloudModel?.slug === 'seedream-5-pro-fal') {
        const size = aspectRatio !== 'keep' ? aspectRatio : '2K';
        const base = cloudModel.costCoins || 0;
        return total + (size.includes('2K') ? base * 2 : base) * numImages;
      }
      return total + (cloudModel?.costCoins || 0) * numImages;
    }, 0);
  };

  const getTotalCost = () => {
    // Get cost from cloud models which have accurate pricing from Supabase
    const totalCoins = getTotalCostCoins();

    if (hasCustomApiKey) {
      // BYOK users see USD (coins / 500 = dollars approximately)
      return `$${(totalCoins / 500).toFixed(2)}`;
    }
    return String(totalCoins);
  };

  // Coin deduction is now handled server-side in cloud/edge functions (secure)

  // Modern 2025 keyboard handling with Reanimated 4
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();

  // Animated style to move bottom container up when keyboard appears
  const bottomContainerStyle = useAnimatedStyle(() => {
    'worklet';
    const bottomInset = insets.bottom;
    const keyboardHeight = keyboard.height.value;
    const keyboardOffset = Math.max(0, keyboardHeight - bottomInset);
    const targetPadding = bottomInset + 16;

    return {
      transform: [{ translateY: withTiming(-keyboardOffset, { duration: 220 }) }],
      paddingBottom: withTiming(targetPadding, { duration: 220 }),
    };
  }, [insets.bottom]);

  // Toast utility function
  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      // On iOS, could use Alert or a custom toast component
      console.log('Toast:', message);
      // For now, just log. In production, use a toast library
    }
  };

  const pickImage = async () => {
    if (!(await ensureAIConsent())) return;
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== 'granted') {
      alert(t('editor.cameraRollPermission'));
      return;
    }

    // Open image picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setIsPickerProcessing(true);
      try {
        await ensureAssetsLocal([asset.uri]);
      } finally {
        setIsPickerProcessing(false);
      }
      setSelectedImage(asset.uri);
      setTransformedImage(null);
      setIsPressing(false);
      setCurrentLibraryId(null);
      setCurrentBatchId(null); // Reset batch when new image selected
      setCurrentDisplayImage(null); // Reset display image
      setBatchOriginalImage(null); // Reset batch original


      // Store image dimensions for aspect ratio calculation
      setInputImageDimensions({ width: asset.width, height: asset.height });

      // Calculate best aspect ratio for current model
      const selectedModel = selectedModels[0];
      const cloudModel = selectedModel ? editModels.find(m => m.slug === selectedModel.id) : null;
      const paramSchema = cloudModel?.paramSchema;

      if (paramSchema && !modelSupportsAutoAspect(paramSchema)) {
        // Model doesn't support auto - find closest match
        const closestAspect = findClosestAspectRatio(asset.width, asset.height, paramSchema);
        if (closestAspect) {
          setAspectRatio(closestAspect);
          console.log(`📐 Auto-selected aspect ratio '${closestAspect}' for ${asset.width}x${asset.height} (model: ${cloudModel?.name})`);
        } else {
          setAspectRatio('keep');
          console.log(`📐 No aspect options found, using 'keep' (${asset.width}x${asset.height})`);
        }
      } else {
        // Model supports auto/match or has no aspect config - use 'keep'
        setAspectRatio('keep');
        console.log(`📐 Model supports auto aspect, using 'keep' (${asset.width}x${asset.height})`);
      }

      // Reset drawing state when selecting new image
      setIsDrawingMode(false);
      setDrawnImageUri(null);
      setPaths([]);
      currentPathRef.current = null;
      // DON'T reset prompt, model, numImages, or settings - user wants to reuse them for new image
    }
  };

  // Toggle drawing mode
  const handleToggleDrawing = () => {
    if (!selectedImage) {
      Alert.alert(t('editor.noImageTitle'), t('editor.noImageMessage'));
      return;
    }

    // If turning off drawing mode, clear the canvas
    if (isDrawingMode) {
      setPaths([]);
      currentPathRef.current = null;
      setDrawnImageUri(null);
    } else {
      // Hide keyboard when activating draw mode
      Keyboard.dismiss();
    }

    setIsDrawingMode(!isDrawingMode);
  };

  // Capture drawn image (entire view: background image + drawing)
  const captureDrawnImage = async (): Promise<string | null> => {
    try {
      if (!drawingContainerRef.current) {
        console.log('No drawing container ref');
        return null;
      }

      console.log('Capturing entire drawing container...');

      // Capture the entire container (background image + canvas drawing)
      const uri = await captureRef(drawingContainerRef, {
        format: 'png',
        quality: 1,
      });

      console.log('Captured drawn image:', uri);
      return uri;
    } catch (error) {
      console.error('Error capturing drawn image:', error);
      return null;
    }
  };

  // Flying animation removed for cleaner UX

  const handleTransform = () => {
    // Registration is optional — just ensure a session (guests can generate).
    requireSession();

    // For API variant, check if user has API key (show modal if not)
    if (!checkCanGenerate()) {
      return;
    }

    // ✅ STEP 1: INSTANT VALIDATION (synchronous)
    // Prompt is required for both create (no image) and edit (with image) modes.
    if (!prompt.trim()) {
      Alert.alert(
        t('editor.noPromptTitle'),
        selectedImage
          ? t('editor.noPromptEditMessage')
          : t('editor.noPromptCreateMessage')
      );
      return;
    }

    if (selectedModels.length === 0) {
      Alert.alert(t('editor.noModelTitle'), t('editor.noModelMessage'));
      return;
    }

    // Pre-flight billing gate: block generation when the coin balance can't cover
    // it and show the paywall instead. BYOK users pay via their own key, and free
    // models (cost 0) are always allowed. Guests are gated the same as registered
    // users — balance > 0 generates, balance 0 hits the paywall. The server
    // enforces this too (start-prediction); this is the instant client-side guard.
    if (!hasCustomApiKey) {
      const costCoins = getTotalCostCoins();
      if (costCoins > 0 && coinBalanceInfo.rawValue < costCoins) {
        showPaywall('insufficient_coins');
        return;
      }
    }

    startGeneration();
  };

  const startGeneration = () => {
    // ✅ INSTANT HAPTIC FEEDBACK (feels responsive!)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // ✅ INSTANT UI STATE CHANGE (synchronous - no delay!)
    setIsTransforming(true);

    // ✅ DEFER HEAVY ASYNC LOGIC
    // requestAnimationFrame = next render frame
    // This ensures UI renders the loading state BEFORE we start heavy work
    requestAnimationFrame(() => {
      // Double RAF for guaranteed visual update
      requestAnimationFrame(() => {
        performTransformation().catch((error) => {
          console.error('❌ Transform error:', error);
          if (isMountedRef.current) {
            showToast(t('editor.generationFailed'));
            setIsTransforming(false);
          }
        });
      });
    });
  };

  const performTransformation = async () => {
    // ✅ EARLY EXIT: Check if component is still mounted
    if (!isMountedRef.current) {
      console.log('⚠️ Component unmounted, aborting transformation');
      return;
    }

    try {
      // Capture drawn image if in drawing mode
      let capturedDrawnImage: string | null = null;
      if (isDrawingMode && drawingContainerRef.current) {
        console.log('Drawing mode active, capturing drawn image...');
        capturedDrawnImage = await captureDrawnImage();

        // Check mount status after async operation
        if (!isMountedRef.current) return;

        if (capturedDrawnImage) {
          console.log('✅ Successfully captured drawn image');
        } else {
          console.log('❌ Failed to capture drawn image');
        }
      }

      // Prepare input — use drawn image if available, otherwise currently displayed image (from preview), or fall back to original.
      // May be null in text-to-image mode (no picture selected): generation proceeds without input images.
      const imageToSend = capturedDrawnImage || currentDisplayImage || selectedImage;

      // Flying animation removed for cleaner UX
      // if (isMountedRef.current) {
      //   triggerFlyingAnimation(imageToSend);
      // }

      // Generate a unique batch ID for this generation session
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      console.log('📦 Creating batch:', batchId);

      // Set current batch ID to show preview gallery
      if (isMountedRef.current) {
        setCurrentBatchId(batchId);
        setBatchOriginalImage(imageToSend); // Set the "original" for this batch (what we're editing from)
        setCurrentDisplayImage(imageToSend); // Show the actual input image being used
      }

      // Generate with all selected models - create numImages jobs for each model
      const generationPromises = selectedModels.flatMap((selectedModel) => {
        // Get cloud model config for image parameter name
        const cloudModel = editModels.find(m => m.slug === selectedModel.id);
        const imageParamName = cloudModel?.imageParameterName || 'image_urls';

        // Create numImages number of jobs for this model
        return Array.from({ length: numImages }, async (_, index) => {
          // Build parameters based on model's param_schema
          const paramSchema = cloudModel?.paramSchema;
          const hasImageSize = paramSchema?.image_size;
          const hasAspectRatio = paramSchema?.aspect_ratio;

          // Base parameters
          const parameters: Record<string, any> = {
            _imageParameterName: imageParamName,
          };

          // Add aspect ratio / image size if model needs it and we have a value
          if (aspectRatio !== 'keep') {
            if (hasImageSize) {
              // Model uses image_size (like seedream-4.5-fal, flux-2-pro-fal)
              parameters.image_size = aspectRatio;
            } else if (hasAspectRatio) {
              // Model uses aspect_ratio
              parameters.aspect_ratio = aspectRatio;
            }
          }

          // Add model-specific parameters
          if (selectedModel.api === 'seedream') {
            Object.assign(parameters, {
              size: imageSize,
              sequential_image_generation: sequentialGeneration,
              max_images: sequentialGeneration === 'auto' ? maxImages : undefined,
              stream: enableStream,
              response_format: responseFormat,
              watermark: enableWatermark,
              optimize_prompt_mode: optimizePromptMode,
            });
          } else if (selectedModel.id === 'nano-banana') {
            Object.assign(parameters, {
              num_images: 1,
              output_format: outputFormat,
            });
          }

          // Use cloud queue for generation (secure server-side coin handling).
          // When imageToSend is null, the edge function uses the model's t2i replicate_version.
          const libraryId = await generateWithQueue({
            prompt,
            model: selectedModel.id,
            modelName: selectedModel.name,
            originalImageUri: imageToSend || undefined,
            inputImages: imageToSend ? [imageToSend] : [],
            parameters,
            metadata: {
              // Batch/context-specific metadata
              batchId, // Add batch ID to metadata for grouping
              hasDrawing: !!capturedDrawnImage,
              multiModelBatch: selectedModels.length > 1,
              batchModels: selectedModels.map(m => m.name).join(', '),
              imageIndex: index + 1, // Track which image this is (1, 2, 3, etc.)
              totalImages: numImages, // Total images being generated for this model

              // Top-level fields for quick access (model-specific)
              ...(selectedModel.api === 'seedream' && {
                size: imageSize,
                watermark: enableWatermark,
                aspectRatio: aspectRatio !== 'keep' ? aspectRatio : undefined,
              }),
              ...(selectedModel.id === 'nano-banana' && {
                aspectRatio: aspectRatio !== 'keep' ? aspectRatio : undefined,
                numImages: 1,
                outputFormat,
              }),

              // Store full parameters for ImageDetailsModal display
              parameters: {
                ...parameters, // Include all API parameters
              },
            },
            showStartNotification: false, // Don't spam notifications
            showCompletionNotification: true,
            useAlertForErrors: true,
          });

          return { libraryId, modelName: selectedModel.name };
        });
      });

      // Wait for all generations to start
      const results = await Promise.all(generationPromises);

      // ✅ CHECK MOUNT before updating UI
      if (!isMountedRef.current) return;

      // Show summary notification
      const successCount = results.filter(r => r.libraryId).length;
      if (successCount > 0) {
        const totalJobs = selectedModels.length * numImages;
        const modelsText = selectedModels.length > 1
          ? t('editor.modelsCount', { n: selectedModels.length })
          : selectedModels[0].name;
        showToast(t('editor.startedJobs', { jobs: totalJobs, models: modelsText, images: numImages }));

        // Set the first library ID as current
        const firstResult = results.find(r => r.libraryId);
        if (firstResult?.libraryId && isMountedRef.current) {
          setCurrentLibraryId(firstResult.libraryId);
          console.log('✅ Generations started via cloud queue');
        }

        // Balance updates automatically via realtime subscription
      } else {
        showToast(t('editor.failedToStartGenerations'));
      }

      // ✅ UNBLOCK BUTTON: Jobs are queued, user can start new ones
      if (isMountedRef.current) {
        setIsTransforming(false);
      }
    } catch (error) {
      console.error('❌ Failed to start generation:', error);

      // Only update UI if still mounted
      if (isMountedRef.current) {
        showToast(t('editor.failedToStartGeneration'));
        setIsTransforming(false);
      }
    }
  };

  // Show current display image (from preview gallery selection) or fall back to original behavior
  const displayImage = isPressing && selectedImage && transformedImage
    ? selectedImage  // When pressing, always show the original uploaded image for comparison
    : (currentDisplayImage || transformedImage || selectedImage);  // Otherwise show: preview selection > transformed > original

  // Handle preview gallery image selection
  const handlePreviewImageSelect = (uri: string, isOriginal: boolean) => {
    console.log('🖼️ Preview image selected:', { uri: uri.substring(0, 50), isOriginal });
    setCurrentDisplayImage(uri);
    // Always update transformedImage to the selected URI so it displays correctly
    // This allows switching between images even in chained generations
    setTransformedImage(uri);
  };

  // Log which image is being displayed (only when isPressing changes)
  useEffect(() => {
    if (isPressing && transformedImage && selectedImage) {
      console.log('🖼️ DISPLAYING: ORIGINAL uploaded image');
    } else if (transformedImage) {
      console.log('🖼️ DISPLAYING: TRANSFORMED image');
    } else if (selectedImage) {
      console.log('🖼️ DISPLAYING: Selected image (no transformation yet)');
    }
  }, [isPressing]);

  return (
    <Pressable
      style={styles.container}
      onPress={() => Keyboard.dismiss()}
      accessible={false}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      {/* Header — translucent blur overlay matching Studio/Recipes */}
      <View pointerEvents="box-none" style={[styles.headerOverlay, { height: insets.top + 8 + 44 + 12 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
              locations={[0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            tint="systemChromeMaterialDark"
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>

        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          {isStandalone && (
            <Pressable
              style={styles.headerBackButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/library');
                }
              }}
            >
              <ChevronLeft size={26} color="#fff" strokeWidth={2} />
            </Pressable>
          )}
          <Pressable
            style={styles.headerLeft}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowModelPicker(true);
            }}
            disabled={isTransforming}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.headerTitle}>{t('editor.imagineWith')}</Text>
              <View style={{ maxWidth: '70%' }}>
                <Text
                  style={styles.headerModelName}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {selectedModels.length === 1
                    ? selectedModels[0].name
                    : t('editor.modelsCount', { n: selectedModels.length })}
                </Text>
                <View style={styles.modelNameUnderline} />
              </View>
            </View>
          </Pressable>
          <View style={styles.headerRight}>
            <GenerationsChip onPress={() => showPaywall('chip_tap')} />
            <GlassPill square onPress={() => setShowSettings(true)}>
              <SettingsIcon size={18} color="#fff" />
            </GlassPill>
          </View>
        </View>
      </View>

      {/* Empty State */}
      {!displayImage && (
        <View style={styles.emptyStateContainer}>
          <View style={styles.emptyStateCard}>
            {isPickerProcessing ? (
              <View style={styles.emptyStateProcessing}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.emptyStateProcessingText}>{t('editor.processing')}</Text>
              </View>
            ) : (
              <>
                <View>
                  <Image
                    source={require('../../assets/empty states/image.png')}
                    style={{
                      width: Math.min(288, Dimensions.get('window').width - 96),
                      height: Math.min(288, Dimensions.get('window').height * 0.35),
                    }}
                    resizeMode="contain"
                  />
                </View>
                <Text
                  style={styles.emptyStatePlain}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    pickImage();
                  }}
                >
                  {t('editor.emptyStatePrefix')}{' '}
                  <Text style={styles.emptyStatePlainLink}>{t('editor.emptyStateLink')}</Text>{' '}
                  {t('editor.emptyStateSuffix')}
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {displayImage ? (
        <>
          {/* Image Display */}
          {!isDrawingMode ? (
            <ZoomableImage
              uri={displayImage}
              onPressIn={() => {
                console.log('👆 PRESS IN detected');
                console.log('Original image exists?', !!selectedImage);
                console.log('Transformed image exists?', !!transformedImage);
                // Only enable press preview if we have both original and transformed images
                if (selectedImage && transformedImage) {
                  console.log('✅ Switching to ORIGINAL image');
                  setIsPressing(true);
                } else {
                  console.log('❌ No transformation yet, cannot compare');
                }
              }}
              onPressOut={() => {
                console.log('👇 PRESS OUT detected');
                console.log('✅ Switching back to TRANSFORMED image');
                setIsPressing(false);
              }}
            />
          ) : (
            /* Drawing Canvas Overlay */
            <View
              ref={drawingContainerRef}
              style={styles.drawingCanvasContainer}
              collapsable={false}
            >
              {/* Background Image */}
              <Image
                source={{ uri: selectedImage }}
                style={styles.backgroundImage}
                resizeMode="contain"
              />

              {/* Transparent Canvas on Top with Gesture Handler */}
              <GestureDetector gesture={Gesture.Pan()
                .onBegin((e) => {
                  'worklet';
                  runOnJS(startNewPath)(e.x, e.y);
                })
                .onUpdate((e) => {
                  'worklet';
                  runOnJS(updateCurrentPath)(e.x, e.y);
                })
                .minDistance(0)
              }>
                <Canvas style={styles.drawingCanvas}>
                  {paths.map((path, index) => (
                    <Path
                      key={index}
                      path={path}
                      color="rgba(255, 0, 0, 0.5)"
                      style="stroke"
                      strokeWidth={5}
                    />
                  ))}
                </Canvas>
              </GestureDetector>
            </View>
          )}

          {/* Close/Change Photo Button */}
          <Pressable
            style={styles.changePhotoButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedImage(null);
              setTransformedImage(null);
              setIsPressing(false);
              setMetadata(null);
              setShowInfo(false);
              setCurrentLibraryId(null);
              setCurrentBatchId(null); // Reset batch
              setCurrentDisplayImage(null); // Reset display image
              setBatchOriginalImage(null); // Reset batch original
              setInputImageDimensions(null); // Reset dimensions
              setAspectRatio('keep'); // Reset aspect ratio
              setIsDrawingMode(false);
              setDrawnImageUri(null);
              setPaths([]);
              currentPathRef.current = null;
            }}
          >
            <X size={20} color="#fff" strokeWidth={1.5} />
          </Pressable>

          {/* Info Panel Toggle */}
          {metadata && showInfo && (
            <View style={styles.infoToggleContainer}>
              <Pressable
                style={styles.infoToggleButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowInfo(!showInfo);
                }}
              >
                <Text style={styles.infoToggleIcon}>✕</Text>
              </Pressable>

              {showInfo && (
                <View style={styles.infoPanel}>
                  <ScrollView
                    style={styles.infoPanelScroll}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                  >
                    <Text style={styles.infoPanelTitle}>{t('editor.generationDetails')}</Text>

                    <View style={styles.infoSection}>
                      <Text style={styles.infoLabel}>{t('editor.infoModel')}</Text>
                      <Text style={styles.infoValue}>{metadata.model}</Text>
                    </View>

                    <View style={styles.infoSection}>
                      <Text style={styles.infoLabel}>{t('editor.infoApiEndpoint')}</Text>
                      <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">
                        {metadata.apiEndpoint}
                      </Text>
                    </View>

                    <View style={styles.infoSection}>
                      <Text style={styles.infoLabel}>{t('editor.infoFormat')}</Text>
                      <Text style={styles.infoValue}>{metadata.format}</Text>
                    </View>

                    {metadata.compressionQuality && (
                      <View style={styles.infoSection}>
                        <Text style={styles.infoLabel}>{t('editor.infoCompression')}</Text>
                        <Text style={styles.infoValue}>{metadata.compressionQuality}</Text>
                      </View>
                    )}

                    {metadata.timings && (
                      <View style={styles.infoSection}>
                        <Text style={styles.infoLabel}>{t('editor.infoGenerationTime')}</Text>
                        <Text style={styles.infoValue}>{metadata.timings.total}</Text>
                      </View>
                    )}

                    {metadata.parameters && (
                      <View style={styles.infoSection}>
                        <Text style={styles.infoLabel}>{t('editor.infoParameters')}</Text>
                        {Object.entries(metadata.parameters).map(([key, value]) => (
                          <Text key={key} style={styles.infoParam}>
                            • {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </Text>
                        ))}
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </>
      ) : null}

      {/* Model Selection Modal */}
      <ModelSelectionModal
        visible={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        models={aiModels}
        onModelsSelect={(models) => {
          setSelectedModels(models);
          setShowModelPicker(false);
        }}
        initialSelectedIds={selectedModels.map(m => m.id)}
        multiSelect={true}
      />


      <Animated.View
        style={[
          styles.bottomContainer,
          bottomContainerStyle
        ]}
      >
        {/* Preview Gallery - shown when batch is active */}
        <EditorPreviewGallery
          batchId={currentBatchId}
          originalImageUri={batchOriginalImage || selectedImage}
          currentImageUri={displayImage}
          onImageSelect={handlePreviewImageSelect}
        />

        {/* Input Block with All Controls Inside */}
        <Pressable
          style={styles.inputBlockWrapper}
          onPress={(e) => e.stopPropagation()}
        >
          <BlurView intensity={80} tint="dark" style={styles.inputBlockBlur} />
          <View style={styles.inputBlock}>
            {/* Text Input */}
            <View style={styles.inputFieldWrapper}>
              <TextInput
                style={styles.inputField}
                placeholder={selectedImage ? t('editor.promptEditPlaceholder') : t('editor.promptCreatePlaceholder')}
                placeholderTextColor="#666"
                value={prompt}
                onChangeText={setPrompt}
                onFocus={() => setIsKeyboardVisible(true)}
                onBlur={() => setIsKeyboardVisible(false)}
                multiline
                editable={!isTransforming}
                textAlignVertical="top"
              />
              {prompt.length > 0 && !isTransforming && (
                <Pressable
                  style={styles.promptClearButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPrompt('');
                  }}
                  hitSlop={8}
                >
                  <X size={14} color="#fff" strokeWidth={2} />
                </Pressable>
              )}
            </View>

          {/* Bottom Row: All Control Buttons */}
          <View style={styles.inputControlsRow}>
            {/* Left Side: Control Buttons */}
            <View style={styles.inputLeftButtons}>
              {/* Draw Button — temporarily hidden, keep code for later */}
              {false && (
              <Pressable
                style={[
                  styles.smallRoundButton,
                  isDrawingMode && styles.smallRoundButtonActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleToggleDrawing();
                }}
                disabled={isTransforming || !selectedImage}
              >
                <Pencil size={18} color={isDrawingMode ? "#000" : "#fff"} strokeWidth={1.5} />
              </Pressable>
              )}

              {/* Number of Images Selector — temporarily hidden, keep code for later */}
              {false && (
              <Pressable
                style={styles.numberSelectorButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setNumImages(numImages >= 4 ? 1 : numImages + 1);
                }}
                disabled={isTransforming}
              >
                <Text style={styles.numberSelectorValue}>{numImages}</Text>
              </Pressable>
              )}

              {/* Keyboard Hide Button - only show when keyboard is visible */}
              {isKeyboardVisible && (
                <Pressable
                  style={styles.smallRoundButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Keyboard.dismiss();
                  }}
                >
                  <ChevronDown size={18} color="#fff" strokeWidth={1.5} />
                </Pressable>
              )}
            </View>

            {/* Right Side: Cost Display + Send Button */}
            <View style={styles.rightButtonsContainer}>
              {/* Cost Display (Coins or USD based on BYOK) */}
              <View style={styles.coinCostButton}>
                {!hasCustomApiKey && <Zap size={22} color="#F4D58D" strokeWidth={2.5} fill="#F4D58D" />}
                <Text style={styles.coinCostButtonText}>{getTotalCost()}</Text>
              </View>

              {/* Send Button — works in both text-to-image (no image) and edit (with image) modes */}
              <Pressable
                ref={transformButtonRef}
                style={[
                  styles.sendButton,
                  (isTransforming || !prompt.trim()) && styles.sendButtonDisabled
                ]}
                onPress={handleTransform}
                disabled={isTransforming || !prompt.trim()}
              >
                {isTransforming ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <ArrowUp size={20} color="#000" strokeWidth={2} />
                )}
              </Pressable>
            </View>
          </View>
          </View>
        </Pressable>
      </Animated.View>

      {/* Settings Modal */}
      <LibrarySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 200,
  },
  emptyStateCard: {
    padding: 32,
    alignItems: 'center',
  },
  emptyStateIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(244, 213, 141, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    marginBottom: 8,
  },
  emptyStatePlain: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 32,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 40,
    letterSpacing: -0.5,
    paddingHorizontal: 8,
  },
  emptyStateProcessing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 80,
  },
  emptyStateProcessingText: {
    color: '#9ca3af',
    fontFamily: 'SFRounded-Medium',
    fontSize: 18,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  emptyStatePlainLink: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  emptyStateDescription: {
    color: '#6b7280',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyStateButton: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 28,
    height: 77,
    borderRadius: 38,
    width: '100%',
  },
  emptyStateButtonText: {
    color: '#111',
    fontSize: 22,
    fontFamily: 'Manrope-Bold',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerBackButton: {
    marginRight: 6,
    marginLeft: -4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    color: '#fff',
    fontFamily: 'SFRounded-Regular',
    fontSize: 22,
    fontWeight: '400',
  },
  headerModelName: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: 'SFRounded-Regular',
    fontSize: 22,
    fontWeight: '400',
  },
  modelNameUnderline: {
    position: 'absolute',
    bottom: -3,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coinBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244, 213, 141, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  coinText: {
    color: '#F4D58D',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },
  settingsButton: {
    padding: 8,
  },
  infoButtonOnImage: {
    position: 'absolute',
    top: 100,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  infoIconText: {
    fontSize: 18,
  },
  changePhotoButton: {
    position: 'absolute',
    top: 140,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  compactControlsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  modelNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxWidth: 140,
  },
  modelNameText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  numImagesCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  numberButtonCompact: {
    width: 24,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberButtonTextCompact: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  numberDisplayCompact: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 16,
    textAlign: 'center',
  },
  aspectRatioCompact: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  aspectRatioTextCompact: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  resolutionCompact: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  resolutionButtonCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  resolutionButtonActive: {
    backgroundColor: '#007AFF',
  },
  resolutionTextCompact: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '500',
  },
  resolutionTextActive: {
    fontWeight: '700',
  },
  drawButtonCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  drawButtonTextCompact: {
    fontSize: 16,
  },
  advancedButtonCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  advancedButtonTextCompact: {
    fontSize: 16,
  },
  keyboardHideButtonCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modelSelectorButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modelSelectorLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  modelSelectorText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  modelSelectorIcon: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  multiModelBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
    minWidth: 20,
    alignItems: 'center',
  },
  multiModelBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  numberOfImagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  numberOfImagesLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  numberInputContainerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drawButtonDisabled: {
    opacity: 0.5,
  },
  drawButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  drawButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  drawButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  drawButtonTextActive: {
    fontWeight: '700',
  },
  drawingCanvasContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0a0a0a',
    position: 'relative',
  },
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  drawingCanvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  canvasContainer: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  canvasStyle: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  drawingControls: {
    position: 'absolute',
    top: 100,
    left: 16,
    flexDirection: 'row',
    gap: 12,
  },
  drawingControlButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  disabledDrawButton: {
    opacity: 0.3,
  },
  drawingControlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  advancedButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  advancedButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modelPickerContainer: {
    backgroundColor: 'rgba(30, 30, 30, 0.98)',
    borderRadius: 16,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modelPickerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modelOptionSelected: {
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    borderColor: '#007AFF',
  },
  modelOptionContent: {
    flex: 1,
  },
  modelOptionName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modelOptionDescription: {
    color: '#999',
    fontSize: 12,
  },
  modelOptionCheck: {
    color: '#007AFF',
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 12,
  },
  advancedSettingsModal: {
    backgroundColor: 'rgba(20, 20, 20, 0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    position: 'absolute',
    bottom: 0,
  },
  advancedSettingsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  advancedSettingsModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  advancedSettingsModalClose: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  advancedSettingsModalScroll: {
    padding: 20,
  },
  advancedSettingsModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  sizeButtonCompact: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  inputContainerFullWidth: {
    position: 'relative',
    width: '100%',
  },
  textInputWrapper: {
    flex: 1,
    position: 'relative',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingRight: 48,
    color: '#fff',
    fontSize: 16,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  inputFullWidth: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingRight: 100,
    color: '#fff',
    fontSize: 16,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    width: '100%',
  },
  closeKeyboardButton: {
    position: 'absolute',
    right: 8,
    top: 8,
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  closeKeyboardButtonInside: {
    position: 'absolute',
    right: 90,
    bottom: 8,
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  transformButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 20,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transformButtonInside: {
    position: 'absolute',
    right: 4,
    top: 4,
    bottom: 4,
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  transformButtonDisabled: {
    backgroundColor: '#555',
  },
  transformButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transformButtonContentInside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  transformButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  coinCostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(244, 213, 141, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 213, 141, 0.4)',
  },
  coinCostBadgeInside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(244, 213, 141, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coinCostText: {
    color: '#F4D58D',
    fontSize: 12,
    fontWeight: '700',
  },
  coinCostTextInside: {
    color: '#F4D58D',
    fontSize: 10,
    fontWeight: '700',
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sizeButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  sizeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  sizeButtonTextActive: {
    fontWeight: '700',
  },
  infoToggleContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    alignItems: 'flex-end',
    maxWidth: '90%',
  },
  infoToggleButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  infoToggleIcon: {
    fontSize: 20,
    color: '#fff',
  },
  infoPanel: {
    marginTop: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    minWidth: 280,
    maxWidth: 340,
    maxHeight: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 10,
  },
  infoPanelScroll: {
    maxHeight: 360,
  },
  infoPanelTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
    paddingBottom: 8,
  },
  infoSection: {
    marginBottom: 10,
  },
  infoLabel: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  infoParam: {
    color: '#ddd',
    fontSize: 12,
    marginLeft: 8,
    marginTop: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingDescription: {
    color: '#999',
    fontSize: 11,
    lineHeight: 14,
  },
  toggleButtonGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  toggleButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  toggleButtonTextActive: {
    fontWeight: '700',
  },
  numberInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  numberButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  numberButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  numberDisplay: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'center',
  },
  // New Compact Design Styles
  inputBlockWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  inputBlockBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  inputBlock: {
    padding: 18,
    backgroundColor: 'transparent',
  },
  inputFieldWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  inputField: {
    color: '#fff',
    fontSize: 17,
    fontFamily: 'Manrope-Regular',
    minHeight: 50,
    maxHeight: 150,
    paddingRight: 32,
  },
  promptClearButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  inputLeftButtons: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  smallRoundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(90, 90, 90, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallRoundButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  numberSelectorButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(90, 90, 90, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberSelectorValue: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Manrope-SemiBold',
  },
  rightButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coinCostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(244, 213, 141, 0.15)',
    borderRadius: 24,
    paddingHorizontal: 12,
    height: 48,
    gap: 1,
    borderWidth: 1,
    borderColor: 'rgba(244, 213, 141, 0.3)',
  },
  coinCostButtonText: {
    color: '#F4D58D',
    fontSize: 16,
    fontFamily: 'Manrope-SemiBold',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(90, 90, 90, 0.9)',
  },
});
