import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate as fmtDate } from '../../lib/i18n/format';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  Image as RNImage,
  Alert,
  Dimensions,
  Clipboard,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  X,
  Download,
  Share2,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  Cpu,
  Settings,
  Image as ImageIcon,
  Video as VideoIcon,
  Coins,
  ZoomIn,
  FileText,
  Link,
  RefreshCw,
  RotateCcw,
  Grid2X2,
  Grid3X3,
  BookPlus,
  ArrowUpCircle,
  Zap,
} from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LibraryImage, isProcessingStatus, useLibrary } from '../../contexts/LibraryContext';
import { ProcessingOverlay } from './ProcessingOverlay';
import { useSettings } from '../../contexts/SettingsContext';
import { gridCropInspireImage } from '../../lib/inspire/gridCropAndSave';
import RecipeBuilderModal, { type RecipeBuilderPrefill } from './RecipeBuilderModal';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import ZoomableImage from './ZoomableImage';
import { useCloudQueueGeneration } from '../hooks/useCloudQueueGeneration';
import { useAuth } from '../../contexts/AuthModalContext';
import { useBalance } from '../../contexts/BalanceContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { getModelCoinCost, getModelCoinCostAsync } from '../../lib/pricing';
import { showAlert, showConfirm } from '../../lib/utils/webAlert';
import { useRouter } from 'expo-router';

interface ImageDetailsModalProps {
  image: LibraryImage | null;
  images?: LibraryImage[];
  initialIndex?: number;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ICON_SIZE = 20;
const ICON_COLOR = '#9ca3af';

// Helper function defined outside component
const checkFileExists = async (uri: string): Promise<boolean> => {
  if (!uri || typeof uri !== 'string') return false;
  if (!uri.startsWith('file://')) return true;

  try {
    const info = await FileSystemLegacy.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
};

// Looping video preview that plays only when active in the carousel
function VideoPreview({ uri, isActive, style }: { uri: string; isActive: boolean; style: any }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });
  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);
  return <VideoView player={player} style={style} contentFit="contain" nativeControls />;
}


export default function ImageDetailsModal({
  image,
  images = [],
  initialIndex = 0,
  onClose,
  onDelete
}: ImageDetailsModalProps) {
  // Debug logging for wrong-image bug
  console.log('🔍 [ImageDetailsModal] RECEIVED PROPS:');
  console.log('  - image prop ID:', image?.id);
  console.log('  - image prop status:', image?.status);
  console.log('  - images array length:', images.length);
  console.log('  - initialIndex:', initialIndex);
  console.log('  - images array IDs:', images.slice(0, 5).map(img => ({ id: img.id, status: img.status })));

  // ALL HOOKS MUST BE AT THE TOP - before any conditional returns
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAdmin } = useSettings();
  const { requireSession } = useAuth();
  const { balanceInfo, hasCustomKey } = useBalance();
  const { showPaywall } = usePaywall();
  const router = useRouter();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenImageUri, setFullscreenImageUri] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [recheckingStatus, setRecheckingStatus] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showHiddenDetails, setShowHiddenDetails] = useState(false);
  const [retryStartedNotification, setRetryStartedNotification] = useState(false);

  // Reset admin reveal when swiping to a different image
  React.useEffect(() => {
    setShowHiddenDetails(false);
  }, [currentIndex]);
  const flatListRef = useRef<FlatList>(null);
  const { recheckJobStatus, retryFailedJob, generateWithQueue } = useCloudQueueGeneration();
  const { addImage } = useLibrary();
  const [cropping, setCropping] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleCost, setUpscaleCost] = useState<number>(() => getModelCoinCost('crystal-upscaler-fal'));

  // Refresh upscale cost from cloud pricing once on mount.
  React.useEffect(() => {
    let cancelled = false;
    getModelCoinCostAsync('crystal-upscaler-fal').then((cost) => {
      if (!cancelled) setUpscaleCost(cost);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [recipePrefill, setRecipePrefill] = useState<RecipeBuilderPrefill | null>(null);
  const [validationResults, setValidationResults] = useState<{
    transformedImageValid: boolean;
    originalImageValid: boolean;
    validInputImages: string[];
    validReferenceImages: string[];
  }>({
    transformedImageValid: false,
    originalImageValid: false,
    validInputImages: [],
    validReferenceImages: [],
  });

  // Refs for FlatList callbacks - use callback ref to avoid stale closure
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== undefined) {
      setCurrentIndex(viewableItems[0].index);
    }
  });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 });

  // Sync currentIndex with initialIndex when modal opens with a new image
  // useState only uses initialIndex on first mount, so we need this effect
  useEffect(() => {
    console.log('🔄 [ImageDetailsModal] Syncing currentIndex to initialIndex:', initialIndex);
    setCurrentIndex(initialIndex);
    // Also scroll FlatList to the correct position
    if (flatListRef.current && initialIndex >= 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 100);
    }
  }, [initialIndex, image?.id]); // Reset when initialIndex or selected image changes

  // Determine which images to use for swipe navigation
  // Note: images array should be a frozen snapshot from parent to prevent wrong image bug
  const allImages = images.length > 0 ? images : (image ? [image] : []);
  const currentImage = allImages[currentIndex] || image;

  // Items whose model+prompt are admin-curated should be hidden from regular
  // users. Mirrors the existing community-recipe gate.
  //
  // Copy Shot ("Inspire") prompts are top-secret and must NEVER be shown. The
  // metadata markers (fromImagine / copyshot*) cover the normal flow, but the
  // model-based fallback (model === 'Inspire' / modelId === 'gpt-image-2-fal')
  // is what catches orphan-adopted jobs (adoptJob) whose metadata markers were
  // lost — that path is exactly how a secret prompt leaked into this modal.
  const m = currentImage?.metadata;
  const isCopyShot = !!(
    m?.fromImagine ||
    m?.fromInspire ||
    m?.copyshotSingle ||
    m?.copyshotV2 ||
    m?.onboardingFlow ||
    m?.source === 'onboarding' ||
    m?.localTool === 'inspire-grid-crop' ||
    currentImage?.model === 'Inspire' ||
    currentImage?.modelId === 'gpt-image-2-fal'
  );
  const hasHiddenSource = !!(
    m?.fromCommunityRecipe ||
    m?.fromInspire ||
    isCopyShot
  );
  const revealSensitive = !hasHiddenSource || showHiddenDetails;

  // Debug logging for wrong-image bug
  console.log('🔍 [ImageDetailsModal] CURRENT STATE:');
  console.log('  - currentIndex state:', currentIndex);
  console.log('  - allImages.length:', allImages.length);
  console.log('  - currentImage ID:', currentImage?.id);
  console.log('  - currentImage status:', currentImage?.status);
  console.log('  - currentImage URI:', currentImage?.transformedImageUrl || currentImage?.originalImageUri);

  // Auto-dismiss retry notification after 4 seconds
  useEffect(() => {
    if (retryStartedNotification) {
      const timer = setTimeout(() => {
        setRetryStartedNotification(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [retryStartedNotification]);

  // Validate URIs when current image changes
  useEffect(() => {
    const validateUris = async () => {
      if (!currentImage) return;

      console.log(`🔍 [ImageDetails] Validating URIs for image ${currentImage.id}:`, {
        transformedImageUrl: currentImage.transformedImageUrl?.substring(0, 80),
        originalImageUri: currentImage.originalImageUri?.substring(0, 80),
      });

      const transformedImageValid = currentImage.transformedImageUrl
        ? await checkFileExists(currentImage.transformedImageUrl)
        : false;

      const originalImageValid = currentImage.originalImageUri
        ? await checkFileExists(currentImage.originalImageUri)
        : false;

      console.log(`🔍 [ImageDetails] Validation results for ${currentImage.id}:`, {
        transformedImageValid,
        originalImageValid,
        transformedIsRemote: currentImage.transformedImageUrl?.startsWith('http'),
        originalIsRemote: currentImage.originalImageUri?.startsWith('http'),
      });

      const validInputImages: string[] = [];
      if (currentImage.inputImages && currentImage.inputImages.length > 0) {
        for (const uri of currentImage.inputImages) {
          if (await checkFileExists(uri)) {
            validInputImages.push(uri);
          }
        }
      }

      const validReferenceImages: string[] = [];
      if (currentImage.metadata?.referenceImages && Array.isArray(currentImage.metadata.referenceImages)) {
        for (const uri of currentImage.metadata.referenceImages) {
          if (await checkFileExists(uri)) {
            validReferenceImages.push(uri);
          }
        }
      }

      setValidationResults({
        transformedImageValid,
        originalImageValid,
        validInputImages,
        validReferenceImages,
      });
    };

    validateUris();
  }, [currentImage?.id]);

  // Don't render if no image - AFTER all hooks
  if (!image) return null;

  const displayUri = currentImage?.transformedImageUrl || currentImage?.originalImageUri;
  const isCompleted = currentImage?.status === 'completed';

  const getDuration = () => {
    // Prefer stored duration (computed once at completion, stable across restarts)
    if (currentImage.metadata?.generationDurationSec != null) {
      const sec = currentImage.metadata.generationDurationSec;
      if (sec > 0 && sec < 3600) return sec.toFixed(1);
    }
    // Fallback to timestamp calculation
    if (currentImage.completedAt && currentImage.createdAt) {
      const durationSec = (currentImage.completedAt - currentImage.createdAt) / 1000;
      if (durationSec > 0 && durationSec < 3600) return durationSec.toFixed(1);
    }
    return null;
  };

  const formatDate = (timestamp: number) => {
    return fmtDate(timestamp, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isVideo = () => {
    if (currentImage.metadata?.type === 'video') return true;
    return displayUri?.toLowerCase().match(/\.(mp4|mov|avi|webm|m4v)$/i) !== null;
  };

  const handleDownload = async () => {
    if (!displayUri) {
      Alert.alert(t('common.error'), t('imageDetails.noImageToSave'));
      return;
    }
    try {
      setDownloading(true);
      console.log('Save: Starting download, displayUri:', displayUri);

      const { status } = await MediaLibrary.requestPermissionsAsync();
      console.log('Save: Permission status:', status);
      if (status !== 'granted') {
        Alert.alert(t('imageDetails.permissionRequired'), t('imageDetails.grantGalleryAccess'));
        return;
      }

      let localUri = displayUri;

      // If it's a remote URL, download it first
      if (displayUri.startsWith('http://') || displayUri.startsWith('https://')) {
        const fileExtension = isVideo() ? 'mp4' : 'jpg';
        const fileName = `download_${Date.now()}.${fileExtension}`;
        const localPath = `${FileSystemLegacy.cacheDirectory}${fileName}`;
        console.log('Save: Downloading to:', localPath);

        const downloadResult = await FileSystemLegacy.downloadAsync(displayUri, localPath);
        console.log('Save: Download result:', downloadResult.status, downloadResult.uri);
        if (downloadResult.status !== 200) {
          throw new Error(`Failed to download file: status ${downloadResult.status}`);
        }
        localUri = downloadResult.uri;
      }

      // Verify file exists before saving
      const fileInfo = await FileSystemLegacy.getInfoAsync(localUri);
      console.log('Save: File info:', fileInfo);
      if (!fileInfo.exists) {
        throw new Error('File does not exist at path');
      }

      console.log('Save: Saving to library:', localUri);
      const asset = await MediaLibrary.createAssetAsync(localUri);
      console.log('Save: Asset created:', asset);
      Alert.alert(t('imageDetails.success'), isVideo() ? t('imageDetails.videoSaved') : t('imageDetails.imageSaved'));
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert(t('common.error'), isVideo() ? t('imageDetails.failedSaveVideo') : t('imageDetails.failedSaveImage'));
    } finally {
      setDownloading(false);
    }
  };

  const handleFineTune = () => {
    const uri = currentImage?.transformedImageUrl || currentImage?.originalImageUri;
    if (!uri) return;
    const width = currentImage?.metadata?.outputSize?.width;
    const height = currentImage?.metadata?.outputSize?.height;
    onClose();
    // Route through the standalone /fine-tune screen rather than the editor
    // tab. The Edit tab may be hidden, and a hidden NativeTabs trigger is not
    // navigable (it throws), so /(tabs)/editor can't be relied on here.
    router.push({
      pathname: '/fine-tune',
      params: {
        fineTuneUri: uri,
        ...(width ? { fineTuneWidth: String(width) } : {}),
        ...(height ? { fineTuneHeight: String(height) } : {}),
        fineTuneNonce: String(Date.now()),
        standalone: '1',
      },
    });
  };

  const handleImproveWithAgent = () => {
    const uri = currentImage?.transformedImageUrl || currentImage?.originalImageUri;
    if (!uri) return;
    onClose();
    router.push({
      pathname: '/agent',
      params: { attachUrl: uri, attachNonce: String(Date.now()) },
    });
  };

  const handleCopyPrompt = () => {
    // Never let a hidden/secret prompt (e.g. Copy Shot) be copied out, even if
    // the section somehow rendered.
    if (!revealSensitive) return;
    if (currentImage.prompt) {
      Clipboard.setString(currentImage.prompt);
      Alert.alert(t('imageDetails.copied'), t('imageDetails.promptCopied'));
    }
  };

  const handleCreateRecipe = () => {
    if (!currentImage) return;
    const outputUri = currentImage.transformedImageUrl || currentImage.originalImageUri;
    // Reference image = the FIRST input only; rest are typically user selfies
    // (soul images) that shouldn't be baked into the recipe.
    const firstInput = currentImage.inputImages?.[0];
    setRecipePrefill({
      modelId: currentImage.modelId,
      prompt: currentImage.prompt || '',
      referenceImageUris: firstInput ? [firstInput] : [],
      exampleResultUris: outputUri ? [outputUri] : [],
      isPublic: true,
    });
  };

  const handleGridCrop = async (n: 2 | 3) => {
    if (!displayUri || cropping) return;
    setCropping(true);
    try {
      // For the manual button, prefer the in-modal displayUri (which may be
      // a cached local copy) over the library row's transformedImageUrl.
      const source: LibraryImage = {
        ...currentImage,
        transformedImageUrl: displayUri,
      };
      const result = await gridCropInspireImage({ sourceImage: source, n, addImage });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.alreadyCropped) {
        Alert.alert(t('imageDetails.alreadyCropped'), t('imageDetails.alreadyCroppedMessage'));
      } else {
        Alert.alert(t('imageDetails.cropComplete', { n }), t('imageDetails.cropCreatedItems', { n: result.created }));
      }
    } catch (err) {
      console.error('[Inspire] grid crop failed:', err);
      Alert.alert(t('imageDetails.cropFailed'), err instanceof Error ? err.message : t('imageDetails.unknownError'));
    } finally {
      setCropping(false);
    }
  };

  const handleUpscale = async () => {
    if (!displayUri || upscaling) return;
    if (isVideo()) return;
    requireSession();
    if (!balanceInfo.hasFalKey && !balanceInfo.hasReplicateKey && balanceInfo.rawValue < upscaleCost) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showPaywall('insufficient_coins');
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setUpscaling(true);
      const result = await generateWithQueue({
        prompt: '',
        supportsPrompt: false,
        model: 'crystal-upscaler-fal',
        modelName: 'Crystal Upscaler',
        originalImageUri: displayUri,
        inputImages: [displayUri],
        // _imageParameterName tells generateWithQueue to UPLOAD the input to storage
        // and send it as image_urls (Fal needs a URL, not a local uri/base64). The
        // edge function then converts image_urls -> image_url for crystal-upscaler
        // (image_parameter_name='image_url'). Without this hint the image wasn't
        // uploaded and Fal returned 422.
        parameters: { scale_factor: 2, creativity: 0, output_format: 'jpg', _imageParameterName: 'image_urls' },
        metadata: {
          isUpscale: true,
          upscaledFrom: currentImage.id,
        },
        showStartNotification: false,
        showCompletionNotification: false,
      });
      if (result) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const goToLibrary = await showConfirm(
          t('imageDetails.upscalingStarted'),
          t('imageDetails.upscalingStartedMessage'),
          { confirmText: t('imageDetails.goToLibrary'), cancelText: t('imageDetails.stayHere') },
        );
        if (goToLibrary) {
          onClose();
          router.push('/(tabs)/library');
        }
      }
    } catch (err) {
      console.error('[Upscale] failed:', err);
      showAlert(t('imageDetails.upscaleFailed'), err instanceof Error ? err.message : t('imageDetails.unknownError'));
    } finally {
      setUpscaling(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      isVideo() ? t('imageDetails.deleteVideoTitle') : t('imageDetails.deleteImageTitle'),
      isVideo() ? t('imageDetails.deleteVideoConfirm') : t('imageDetails.deleteImageConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            onDelete(currentImage.id);
            if (allImages.length <= 1) {
              onClose();
            } else {
              // Move to next or previous
              if (currentIndex >= allImages.length - 1) {
                setCurrentIndex(currentIndex - 1);
              }
            }
          },
        },
      ]
    );
  };

  const handleRecheckStatus = async () => {
    if (!currentImage?.id) return;

    setRecheckingStatus(true);
    try {
      const result = await recheckJobStatus(currentImage.id);

      if (result.success) {
        if (result.status === 'completed') {
          Alert.alert(t('imageDetails.success'), t('imageDetails.alreadyGenerated'));
        } else if (result.status === 'processing' || result.status === 'pending') {
          Alert.alert(t('imageDetails.stillProcessing'), t('imageDetails.stillProcessingMessage'));
        } else if (result.status === 'failed') {
          Alert.alert(t('imageDetails.confirmedFailed'), result.errorMessage || t('imageDetails.generationFailed'));
        }
      } else {
        Alert.alert(t('common.error'), result.errorMessage || t('imageDetails.failedCheckStatus'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('imageDetails.failedCheckStatus'));
    } finally {
      setRecheckingStatus(false);
    }
  };

  const handleRetry = async () => {
    if (!currentImage?.id) return;

    setRetrying(true);
    try {
      const newLibraryId = await retryFailedJob(currentImage.id);
      if (newLibraryId) {
        setRetryStartedNotification(true);
      }
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('imageDetails.failedRetry'));
    } finally {
      setRetrying(false);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
    }
  };

  const goToNext = () => {
    if (currentIndex < allImages.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
    }
  };

  if (isFullscreen) {
    return (
      <Modal visible={true} animationType="fade" statusBarTranslucent>
        <View style={styles.fullscreenContainer}>
          <ZoomableImage uri={fullscreenImageUri || displayUri} />
          <Pressable
            style={styles.fullscreenCloseButton}
            onPress={() => {
              setIsFullscreen(false);
              setFullscreenImageUri('');
            }}
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    );
  }

  const renderImagePreview = ({ item, index }: { item: LibraryImage; index: number }) => {
    const itemDisplayUri = item.transformedImageUrl || item.originalImageUri;
    const itemIsVideo = item.metadata?.type === 'video' || itemDisplayUri?.toLowerCase().match(/\.(mp4|mov|avi|webm|m4v)$/i) !== null;
    const isProcessing = isProcessingStatus(item.status);

    // Debug logging to diagnose image loading issues
    console.log(`🖼️ [ImageDetails] Rendering image ${item.id}:`, {
      displayUri: itemDisplayUri ? (itemDisplayUri.startsWith('file://') ? 'file://' + itemDisplayUri.split('/').pop() : itemDisplayUri.substring(0, 80) + '...') : 'null',
      isLocalFile: itemDisplayUri?.startsWith('file://'),
      isRemoteUrl: itemDisplayUri?.startsWith('http'),
      hasTransformed: !!item.transformedImageUrl,
      hasOriginal: !!item.originalImageUri,
      status: item.status,
      createdAt: new Date(item.createdAt).toISOString(),
      resultUrl: item.metadata?.resultUrl ? 'exists' : 'missing',
    });

    return (
      <Pressable
        style={styles.previewContainer}
        onPress={() => {
          // Don't allow fullscreen zoom when processing
          if (!itemIsVideo && itemDisplayUri && !isProcessing) {
            setFullscreenImageUri(itemDisplayUri);
            setIsFullscreen(true);
          }
        }}
      >
        {itemIsVideo && itemDisplayUri ? (
          <VideoPreview
            uri={itemDisplayUri}
            isActive={index === currentIndex}
            style={styles.previewImage}
          />
        ) : itemDisplayUri ? (
          <Image
            source={{ uri: itemDisplayUri }}
            style={styles.previewImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            blurRadius={isProcessing ? 50 : 0}
            onError={(e) => {
              console.error(`❌ [ImageDetails] Failed to load image ${item.id}:`, {
                uri: itemDisplayUri?.substring(0, 100),
                error: e,
              });
            }}
            onLoad={() => {
              console.log(`✅ [ImageDetails] Successfully loaded image ${item.id}`);
            }}
          />
        ) : (
          <View style={[styles.previewImage, styles.placeholder]}>
            <ImageIcon size={64} color="#555" />
          </View>
        )}
        {/* Processing overlay */}
        {isProcessing && (
          <ProcessingOverlay
            status={item.status}
            createdAt={item.createdAt}
            modelId={item.modelId}
            etaSeconds={item.metadata?.etaSeconds}
            startedAt={item.metadata?.startedAt}
            variant="modal"
          />
        )}
        {/* Zoom hint - only show when not processing */}
        {!itemIsVideo && itemDisplayUri && !isProcessing && (
          <View style={styles.zoomHint}>
            <ZoomIn size={16} color="#fff" />
            <Text style={styles.zoomHintText}>{t('imageDetails.tapToZoom')}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={true}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={onClose}>
            <BlurView intensity={40} tint="dark" style={styles.glassButton}>
              <X size={18} color="#fff" />
            </BlurView>
          </TouchableOpacity>
          <Text style={styles.title}>
            {isVideo() ? t('imageDetails.video') : t('imageDetails.image')}
          </Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Image Preview with Swipe */}
          {allImages.length > 1 ? (
            <View style={styles.carouselContainer}>
              <FlatList
                ref={flatListRef}
                data={allImages}
                renderItem={renderImagePreview}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onViewableItemsChanged={onViewableItemsChanged.current}
                viewabilityConfig={viewabilityConfig.current}
                initialScrollIndex={currentIndex}
                getItemLayout={(_, index) => ({
                  length: SCREEN_WIDTH,
                  offset: SCREEN_WIDTH * index,
                  index,
                })}
                extraData={[currentIndex, images.length, images.map(img => img.status).join(',')]}
              />
              {/* Navigation arrows */}
              {currentIndex > 0 && (
                <TouchableOpacity style={[styles.navArrow, styles.navArrowLeft]} onPress={goToPrevious}>
                  <ChevronLeft size={28} color="#fff" />
                </TouchableOpacity>
              )}
              {currentIndex < allImages.length - 1 && (
                <TouchableOpacity style={[styles.navArrow, styles.navArrowRight]} onPress={goToNext}>
                  <ChevronRight size={28} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            renderImagePreview({ item: currentImage, index: 0 })
          )}

          {/* Action Buttons */}
          <View style={styles.section}>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, downloading && styles.actionButtonDisabled]}
                onPress={handleDownload}
                disabled={downloading}
              >
                <Download size={ICON_SIZE} color="#fff" />
                <Text style={styles.actionButtonText}>
                  {downloading ? t('imageDetails.saving') : t('common.save')}
                </Text>
              </TouchableOpacity>

              {!isVideo() && (
                <TouchableOpacity style={styles.actionButton} onPress={handleFineTune}>
                  <Sparkles size={ICON_SIZE} color="#fff" />
                  <Text style={styles.actionButtonText}>{t('imageDetails.fineTune')}</Text>
                </TouchableOpacity>
              )}

              {isAdmin && currentImage.metadata?.fromInspire && !currentImage.metadata?.localTool && !isVideo() && (
                <>
                  <TouchableOpacity
                    style={[styles.actionButton, cropping && styles.actionButtonDisabled]}
                    onPress={() => handleGridCrop(2)}
                    disabled={cropping}
                  >
                    <Grid2X2 size={ICON_SIZE} color="#fff" />
                    <Text style={styles.actionButtonText}>2×2</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, cropping && styles.actionButtonDisabled]}
                    onPress={() => handleGridCrop(3)}
                    disabled={cropping}
                  >
                    <Grid3X3 size={ICON_SIZE} color="#fff" />
                    <Text style={styles.actionButtonText}>3×3</Text>
                  </TouchableOpacity>
                </>
              )}

              {isAdmin && currentImage.status === 'completed' && !isVideo() && (
                <TouchableOpacity style={styles.actionButton} onPress={handleCreateRecipe}>
                  <BookPlus size={ICON_SIZE} color="#fff" />
                  <Text style={styles.actionButtonText}>Create Recipe</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={handleDelete}
              >
                <Trash2 size={ICON_SIZE} color="#ef4444" />
                <Text style={[styles.actionButtonText, styles.deleteButtonText]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Improve with Aya agent — above upscale, for any completed image */}
          {isCompleted && !isVideo() && (
            <View style={styles.section}>
              <TouchableOpacity style={styles.agentCard} onPress={handleImproveWithAgent} activeOpacity={0.9}>
                <Image source={require('../../assets/agent-persona.png')} style={styles.agentMascot} contentFit="contain" />
                <View style={styles.agentTextWrap}>
                  <Text style={styles.agentTitle}>{t('imageDetails.improveWithAgentTitle')}</Text>
                  <Text style={styles.agentSubtitle}>{t('imageDetails.improveWithAgentSubtitle')}</Text>
                </View>
                <ChevronRight size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Upscale CTA — only for completed, non-video, non-upscale outputs */}
          {isCompleted && !isVideo() && !currentImage.modelId?.includes('upscale') && (
            <View style={styles.section}>
              <View style={[styles.upscaleCard, upscaling && styles.actionButtonDisabled]}>
                <View style={styles.upscaleHeader}>
                  <View style={styles.upscaleTextWrap}>
                    <Text style={styles.upscaleTitle}>
                      {upscaling ? t('imageDetails.startingUpscale') : t('imageDetails.loveThisPhoto')}
                    </Text>
                    <Text style={styles.upscaleSubtitle}>
                      {upscaling
                        ? t('imageDetails.upscaleInProgressSubtitle')
                        : t('imageDetails.upscalePromptSubtitle')}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.upscaleCta}
                  onPress={handleUpscale}
                  disabled={upscaling}
                  activeOpacity={0.85}
                >
                  {hasCustomKey ? (
                    <>
                      <ArrowUpCircle size={20} color="#fff" />
                      <Text style={styles.upscaleCtaText}>{t('imageDetails.upscaleTo4K')}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.upscaleCtaText}>{t('imageDetails.upscaleTo4K')}</Text>
                      <View style={styles.upscaleCostInline}>
                        <Zap size={15} color="#fff" strokeWidth={2.5} fill="#fff" />
                        <Text style={styles.upscaleCtaText}>{upscaleCost}</Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Generation Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('imageDetails.generation')}</Text>
            <View style={styles.card}>
              {/* Model — hidden for community-recipe / Inspire items unless admin reveals */}
              {currentImage.model && revealSensitive && (
                <View style={styles.infoRow}>
                  <Cpu size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.model')}</Text>
                    <Text style={styles.infoValue}>{currentImage.model}</Text>
                  </View>
                </View>
              )}

              {currentImage.status && (
                <View style={styles.infoRow}>
                  <Sparkles size={ICON_SIZE} color={
                    currentImage.status === 'completed' ? '#10b981' :
                    currentImage.status === 'failed' ? '#ef4444' : ICON_COLOR
                  } />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.status')}</Text>
                    <Text style={[
                      styles.infoValue,
                      currentImage.status === 'completed' && styles.statusCompleted,
                      currentImage.status === 'failed' && styles.statusFailed,
                    ]}>
                      {currentImage.status.charAt(0).toUpperCase() + currentImage.status.slice(1)}
                    </Text>
                  </View>
                </View>
              )}

              {getDuration() && (
                <View style={styles.infoRow}>
                  <Clock size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.generationTime')}</Text>
                    <Text style={styles.infoValue}>{getDuration()}s</Text>
                  </View>
                </View>
              )}

              {currentImage.metadata?.cost && (
                <View style={styles.infoRow}>
                  <Zap size={ICON_SIZE} color="#FFD700" fill="#FFD700" strokeWidth={2.5} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.cost')}</Text>
                    <Text style={[styles.infoValue, styles.coinValue]}>{t('imageDetails.coinsValue', { n: currentImage.metadata.cost })}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Prompt Section — hidden for community-recipe / Inspire items unless admin reveals */}
          {currentImage.prompt && revealSensitive && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('imageDetails.prompt')}</Text>
              <View style={styles.card}>
                <View style={styles.promptContainer}>
                  <Text style={styles.promptText}>{currentImage.prompt}</Text>
                  <TouchableOpacity style={styles.copyButton} onPress={handleCopyPrompt}>
                    <Copy size={18} color="#6b7280" />
                    <Text style={styles.copyButtonText}>{t('imageDetails.copy')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* Admin toggle for hidden details (community recipe / Inspire items) */}
          {hasHiddenSource && isAdmin && !showHiddenDetails && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.adminRevealButton}
                onPress={() => setShowHiddenDetails(true)}
              >
                <MaterialIcons name="visibility" size={16} color="#666" />
                <Text style={styles.adminRevealText}>Show Model & Prompt (Admin)</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Technical Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('imageDetails.details')}</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Clock size={ICON_SIZE} color={ICON_COLOR} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>{t('imageDetails.created')}</Text>
                  <Text style={styles.infoValue}>{formatDate(currentImage.createdAt)}</Text>
                </View>
              </View>

              {currentImage.metadata?.resultUrl && (
                <TouchableOpacity
                  style={styles.infoRow}
                  onPress={() => {
                    Clipboard.setString(currentImage.metadata!.resultUrl);
                    Alert.alert(t('imageDetails.copied'), t('imageDetails.urlCopied'));
                  }}
                >
                  <Link size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.sourceUrl')}</Text>
                    <Text style={styles.infoValueSmall} numberOfLines={1} ellipsizeMode="middle">
                      {currentImage.metadata.resultUrl}
                    </Text>
                  </View>
                  <Copy size={16} color="#6b7280" />
                </TouchableOpacity>
              )}

              {currentImage.metadata?.dimensions && (
                <View style={styles.infoRow}>
                  <ImageIcon size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.dimensions')}</Text>
                    <Text style={styles.infoValue}>
                      {currentImage.metadata.dimensions.width} × {currentImage.metadata.dimensions.height}
                    </Text>
                  </View>
                </View>
              )}

              {currentImage.metadata?.aspectRatio && (
                <View style={styles.infoRow}>
                  <Settings size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.aspectRatio')}</Text>
                    <Text style={styles.infoValue}>{currentImage.metadata.aspectRatio}</Text>
                  </View>
                </View>
              )}

              {isVideo() && currentImage.metadata?.duration && (
                <View style={styles.infoRow}>
                  <VideoIcon size={ICON_SIZE} color={ICON_COLOR} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>{t('imageDetails.duration')}</Text>
                    <Text style={styles.infoValue}>{currentImage.metadata.duration}s</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Parameters Section */}
          {currentImage.metadata?.parameters && Object.keys(currentImage.metadata.parameters).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('imageDetails.parameters')}</Text>
              <View style={styles.card}>
                {Object.entries(currentImage.metadata.parameters).map(([key, value]) => (
                  value !== undefined && value !== null && (
                    <View key={key} style={styles.infoRow}>
                      <Settings size={ICON_SIZE} color={ICON_COLOR} />
                      <View style={styles.infoContent}>
                        <Text style={styles.infoLabel}>
                          {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </Text>
                        <Text style={styles.infoValue}>{String(value)}</Text>
                      </View>
                    </View>
                  )
                ))}
              </View>
            </View>
          )}

          {/* Input Images — skip recipe reference images (admin-baked, invisible to users) */}
          {(() => {
            const refCount = currentImage.metadata?.recipeReferenceImageCount || 0;
            const displayInputImages = refCount > 0
              ? validationResults.validInputImages.slice(refCount)
              : validationResults.validInputImages;
            return displayInputImages.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('imageDetails.inputImages')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbnailScroll}>
                  {displayInputImages.map((uri, index) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        setFullscreenImageUri(uri);
                        setIsFullscreen(true);
                      }}
                    >
                      <Image source={{ uri }} style={styles.thumbnailImage} cachePolicy="memory-disk" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null;
          })()}

          {/* Reference Images */}
          {validationResults.validReferenceImages.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('imageDetails.referenceImages')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbnailScroll}>
                {validationResults.validReferenceImages.map((uri, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      setFullscreenImageUri(uri);
                      setIsFullscreen(true);
                    }}
                  >
                    <Image source={{ uri }} style={styles.thumbnailImage} cachePolicy="memory-disk" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Error Section */}
          {currentImage.error && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, styles.errorTitle]}>{t('common.error')}</Text>
              <View style={[styles.card, styles.errorCard]}>
                <Text style={styles.errorText}>{currentImage.error}</Text>
              </View>
            </View>
          )}

          {/* Recheck & Retry Buttons for Failed Jobs */}
          {currentImage.status === 'failed' && currentImage.metadata?.queueJobId && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('imageDetails.recoveryOptions')}</Text>

              {/* Retry started notification */}
              {retryStartedNotification && (
                <View style={styles.retryNotification}>
                  <Text style={styles.retryNotificationText}>
                    {t('imageDetails.newGenerationStarted')}
                  </Text>
                </View>
              )}

              <View style={styles.recoveryRow}>
                <TouchableOpacity
                  style={[styles.recoveryButton, recheckingStatus && styles.recoveryButtonDisabled]}
                  onPress={handleRecheckStatus}
                  disabled={recheckingStatus || retrying}
                >
                  <RefreshCw size={18} color="#fff" />
                  <Text style={styles.recoveryButtonText}>
                    {recheckingStatus ? t('imageDetails.checking') : t('imageDetails.recheckStatus')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.recoveryButton, styles.retryButton, retrying && styles.recoveryButtonDisabled]}
                  onPress={handleRetry}
                  disabled={recheckingStatus || retrying}
                >
                  <RotateCcw size={18} color="#fff" />
                  <Text style={styles.recoveryButtonText}>
                    {retrying ? t('imageDetails.retrying') : t('common.retry')}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.recoveryHint}>
                {t('imageDetails.recoveryHint')}
              </Text>
            </View>
          )}

          <View style={styles.footer} />
        </ScrollView>
      </View>

      {recipePrefill && (
        <RecipeBuilderModal
          visible={!!recipePrefill}
          recipe={null}
          prefill={recipePrefill}
          onClose={() => setRecipePrefill(null)}
          onSave={() => setRecipePrefill(null)}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  carouselContainer: {
    position: 'relative',
  },
  previewContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
  placeholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomHint: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  zoomHintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  navArrow: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -24 }],
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navArrowLeft: {
    left: 12,
  },
  navArrowRight: {
    right: 12,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  upscaleCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 45, 149, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 149, 0.35)',
    gap: 14,
  },
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  agentMascot: { width: 44, height: 44, tintColor: '#fff' },
  agentTextWrap: { flex: 1 },
  agentTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  agentSubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 18, marginTop: 2 },
  upscaleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  upscaleTextWrap: {
    flex: 1,
  },
  upscaleTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  upscaleSubtitle: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 16,
  },
  upscaleCta: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: '#FF2D95',
  },
  upscaleCostInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  upscaleCtaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a1a1a',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  deleteButtonText: {
    color: '#ef4444',
  },
  promptContainer: {
    padding: 16,
  },
  promptText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#222',
    borderRadius: 8,
  },
  copyButtonText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    color: '#fff',
    fontSize: 15,
  },
  infoValueSmall: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  statusCompleted: {
    color: '#10b981',
  },
  statusFailed: {
    color: '#ef4444',
  },
  coinValue: {
    color: '#FFD700',
  },
  thumbnailScroll: {
    marginTop: 8,
  },
  thumbnailImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#1a1a1a',
  },
  errorTitle: {
    color: '#ef4444',
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  errorText: {
    color: '#f87171',
    fontSize: 14,
    lineHeight: 20,
    padding: 16,
  },
  recoveryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  recoveryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryButton: {
    backgroundColor: '#059669',
  },
  recoveryButtonDisabled: {
    opacity: 0.5,
  },
  recoveryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  recoveryHint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  retryNotification: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  retryNotificationText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  adminRevealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
  },
  adminRevealText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },
  footer: {
    height: 40,
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullscreenCloseButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
});
