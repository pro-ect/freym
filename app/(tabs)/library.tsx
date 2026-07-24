import { View, Text, StyleSheet, Pressable, Dimensions, Alert, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLibrary, isProcessingStatus } from '../../contexts/LibraryContext';
import { safeAspectRatio, safeTileHeight } from '../../lib/layout/imageSizing';
import { useState, useEffect } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { Grid2X2, Grid3X3, CheckCircle2, XCircle, Loader, Heart, CloudOff, Cloud, Settings as SettingsIcon } from 'lucide-react-native';
import RemoteImage from '../components/RemoteImage';
import ImageDetailsModal from '../components/ImageDetailsModal';
import { LibraryImage } from '../../contexts/LibraryContext';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import { ProcessingOverlay } from '../components/ProcessingOverlay';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import MasonryGrid from '../components/MasonryGrid';
import GenerationsChip from '../components/GenerationsChip';
import GlassPill from '../components/GlassPill';
import { usePaywall } from '../../contexts/PaywallContext';
import { useReplicateBalance } from '../hooks/useReplicateBalance';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_GAP = 8;

type GridColumns = 2 | 3;

// Helper to check if item is a video
function isVideo(item: LibraryImage): boolean {
  if (item.metadata?.type === 'video') return true;
  const uri = item.transformedImageUrl || item.originalImageUri;
  if (!uri) return false;
  return uri.toLowerCase().match(/\.(mp4|mov|avi|webm|m4v)$/i) !== null;
}

// Paused first-frame thumbnail for video items
function VideoThumbnail({ uri, style }: { uri: string; style: any }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.loop = false;
  });
  return <VideoView player={player} style={style} contentFit="contain" nativeControls={false} playsInline />;
}

// Animated rotating loader component
function RotatingLoader({ size = 32, color = '#fff' }: { size?: number; color?: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000 }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Loader size={size} color={color} strokeWidth={2} />
    </Animated.View>
  );
}

export default function Library() {
  const { t } = useTranslation();
  const {
    images,
    deleteImage,
    loadMore,
    hasMore,
    isLoadingMore,
    isLoadingInitial,
    refresh,
    toggleFavorite,
    showFavoritesOnly,
    setShowFavoritesOnly,
  } = useLibrary();
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();
  const insets = useSafeAreaInsets();
  const { forceLibraryEmptyState, isAdmin } = useSettings();
  const { showPaywall } = usePaywall();
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  // Frozen snapshot of images array when modal opens - prevents wrong image bug
  const [modalImagesSnapshot, setModalImagesSnapshot] = useState<typeof images | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [imageGridColumns, setImageGridColumns] = useState<GridColumns>(2);

  // Refresh library when tab is focused
  useFocusEffect(
    useCallback(() => {
      refresh().catch((error) => {
        console.warn('Failed to refresh library on focus:', error);
      });
    }, [refresh])
  );

  const handleDelete = useCallback((id: string) => {
    Alert.alert(
      t('libraryTab.deleteImageTitle'),
      t('libraryTab.deleteImageMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteImage(id),
        },
      ]
    );
  }, [deleteImage]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || isLoadingInitial) {
      return;
    }
    loadMore().catch((error) => {
      console.warn('Failed to load more library images:', error);
    });
  }, [hasMore, isLoadingMore, isLoadingInitial, loadMore]);

  // Handle opening modal - capture frozen snapshot of images array
  const handleOpenImageDetails = useCallback((imageId: string) => {
    const snapshot = [...images];
    if (__DEV__) {
      const clickedItem = images.find(img => img.id === imageId);
      const indexInSnapshot = snapshot.findIndex(img => img.id === imageId);
      console.log('📸 [Library] CLICK EVENT:');
      console.log('  - Clicked ID:', imageId);
      console.log('  - Clicked item status:', clickedItem?.status);
      console.log('  - Clicked item URI:', clickedItem?.transformedImageUrl || clickedItem?.originalImageUri);
      console.log('  - Total images in array:', images.length);
      console.log('  - Index in snapshot:', indexInSnapshot);
      console.log('  - Item at that index:', snapshot[indexInSnapshot]?.id, snapshot[indexInSnapshot]?.status);
    }
    setModalImagesSnapshot(snapshot); // Freeze current array state
    setSelectedImageId(imageId);
  }, [images]);

  // Handle closing modal - clear snapshot
  const handleCloseModal = useCallback(() => {
    setSelectedImageId(null);
    setModalImagesSnapshot(null);
  }, []);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    console.log('🔄 Library Screen: User triggered pull-to-refresh');
    setIsManualRefreshing(true);
    try {
      await refresh();
    } catch (error) {
      console.warn('Failed to refresh library images:', error);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refresh]);

  // Ordering is handled once in LibraryContext via sortLibraryImages — `images`
  // arrives already sorted, so the screen never sorts locally.

  const renderFooter = useCallback(() => {
    if (!isLoadingMore) {
      return null;
    }
    return (
      <View style={styles.footerLoader}>
        <RotatingLoader size={20} color="#fff" />
      </View>
    );
  }, [isLoadingMore]);


  const renderItem = useCallback((
    item: typeof images[0],
    imageDimensions?: { width: number; height: number },
    updateDimensions?: (id: string, width: number, height: number) => void
  ) => {
    const displayUri = item.transformedImageUrl || item.originalImageUri;
    const isProcessing = isProcessingStatus(item.status);
    const isFailed = item.status === 'failed';
    const itemIsVideo = isVideo(item);
    const hasDisplayUri = Boolean(displayUri);

    // Calculate image height based on aspect ratio. Prefer dimensions
    // measured by <Image>'s onLoad; fall back to dimensions baked into
    // metadata at creation time (e.g., Inspire grid-crop tiles, where the
    // exact tile size is known before the file is decoded). This kills the
    // "tiles flash square, then jump to portrait" reflow.
    // Math.floor: fractional layout dims feed native CALayers and a non-finite
    // value crashes iOS — floor keeps the column width an integer.
    const columnWidth = Math.floor(
      (SCREEN_WIDTH - (imageGridColumns + 1) * ITEM_GAP) / imageGridColumns
    );
    const tileDims = item.metadata?.tileDimensions;
    const knownDims = imageDimensions ?? tileDims;
    let imageHeight = columnWidth; // Default to square
    if (knownDims) {
      // safeAspectRatio rejects 0/NaN/Infinity/string dims (the old typeof-number
      // check let 0 through → Infinity height → CALayer NaN crash on iOS).
      const ratio = safeAspectRatio(knownDims.width, knownDims.height);
      imageHeight = safeTileHeight(columnWidth, ratio, 80, 600);
    }

    const handleImageLoad = (event: any) => {
      const { width, height } = event.source;
      if (width && height && updateDimensions && !knownDims) {
        updateDimensions(item.id, width, height);
      }
    };

    return (
      <Pressable
        style={[styles.imageContainer, { width: columnWidth, marginBottom: ITEM_GAP }]}
        onPress={() => handleOpenImageDetails(item.id)}
        onLongPress={() => handleDelete(item.id)}
      >
        {itemIsVideo && hasDisplayUri ? (
          <VideoThumbnail
            uri={displayUri}
            style={[styles.image, { height: imageHeight }]}
          />
        ) : hasDisplayUri ? (
          <RemoteImage
            source={{ uri: displayUri }}
            style={[styles.image, { height: imageHeight }]}
            contentFit="cover"
            onLoad={handleImageLoad}
            cachePolicy="memory-disk"
            priority={isProcessing ? 'low' : 'normal'}
            transition={{ duration: 200 }}
            blurRadius={isProcessing ? 100 : 0}
          />
        ) : (
          <View style={[styles.image, styles.placeholder, { height: imageHeight }]}>
            <MaterialIcons name="image" size={32} color="#333" />
          </View>
        )}

        {/* Video play icon */}
        {itemIsVideo && !isProcessing && !isFailed && (
          <View style={styles.videoPlayIcon}>
            <MaterialIcons name="play-circle-filled" size={48} color="rgba(255,255,255,0.9)" />
          </View>
        )}

        {/* Overlay for status */}
        {isProcessing && (
          <ProcessingOverlay
            status={item.status}
            createdAt={item.createdAt}
            modelId={item.modelId}
            etaSeconds={item.metadata?.etaSeconds}
            startedAt={item.metadata?.startedAt}
            variant="card"
          />
        )}
        {isFailed && (
          <>
            <XCircle size={18} color="#ff4444" strokeWidth={2.5} fill="rgba(255, 68, 68, 0.2)" style={styles.failedBadge} />
            {item.error ? (
              <View style={styles.failedReasonOverlay}>
                <Text style={styles.failedReasonText} numberOfLines={3}>{item.error}</Text>
              </View>
            ) : null}
          </>
        )}

        {/* Completed badge */}
        {item.status === 'completed' && !itemIsVideo && (
          <CheckCircle2 size={18} color="#FFD700" strokeWidth={2.5} fill="rgba(255, 215, 0, 0.2)" style={styles.completedBadge} />
        )}

        {/* Video duration badge */}
        {itemIsVideo && item.metadata?.duration && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{item.metadata.duration}s</Text>
          </View>
        )}

        {/* Favorite heart icon (completed items only, admin-only) */}
        {isAdmin && item.status === 'completed' && (
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={(e) => {
              e.stopPropagation();
              toggleFavorite(item.id);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Heart
              size={16}
              color={item.isFavorite ? '#ff4d8d' : '#fff'}
              fill={item.isFavorite ? '#ff4d8d' : 'transparent'}
              strokeWidth={2}
            />
            {/* Sync status indicator */}
            {item.isFavorite && item.favoriteSyncStatus === 'syncing' && (
              <View style={styles.syncBadge}>
                <RotatingLoader size={8} color="#fff" />
              </View>
            )}
            {item.isFavorite && item.favoriteSyncStatus === 'synced' && (
              <View style={styles.syncBadge}>
                <Cloud size={8} color="#4ade80" fill="#4ade80" />
              </View>
            )}
            {item.isFavorite && item.favoriteSyncStatus === 'failed' && (
              <View style={styles.syncBadge}>
                <CloudOff size={8} color="#ff4444" />
              </View>
            )}
          </TouchableOpacity>
        )}

      </Pressable>
    );
  }, [handleDelete, handleOpenImageDetails, imageGridColumns, toggleFavorite, isAdmin]);


  // Use frozen snapshot for modal to prevent wrong image bug during array updates
  const imagesForModal = modalImagesSnapshot || images;

  // Find selected image index from the frozen snapshot
  const selectedImageIndex = selectedImageId
    ? imagesForModal.findIndex(img => img.id === selectedImageId)
    : -1;

  // Get the actual selected image from the frozen snapshot
  const selectedImage = selectedImageId
    ? imagesForModal.find(img => img.id === selectedImageId) || null
    : null;

  return (
    <>
      <ImageDetailsModal
        image={selectedImage}
        images={imagesForModal}
        initialIndex={selectedImageIndex >= 0 ? selectedImageIndex : 0}
        onClose={handleCloseModal}
        onDelete={deleteImage}
      />
    <View style={styles.container}>
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
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>{showFavoritesOnly ? t('libraryTab.titleFavorites') : t('libraryTab.title')}</Text>
          </View>
          <View style={styles.headerRight}>
            {isAdmin && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              <View style={styles.favoritesGlassPill}>
                <BlurView
                  intensity={60}
                  tint="systemUltraThinMaterial"
                  style={styles.favoritesGlassContent}
                >
                  <Heart
                    size={18}
                    color={showFavoritesOnly ? '#ff4d8d' : '#fff'}
                    fill={showFavoritesOnly ? '#ff4d8d' : 'transparent'}
                    strokeWidth={2}
                  />
                </BlurView>
              </View>
            </TouchableOpacity>
            )}
            <GenerationsChip onPress={() => showPaywall('chip_tap')} />
            <GlassPill square onPress={() => setShowSettings(true)}>
              <SettingsIcon size={18} color="#fff" />
            </GlassPill>
          </View>
        </View>
      </View>

      {/* Content */}
      {isLoadingInitial && images.length === 0 ? (
        <View style={styles.loadingContainer}>
          <RotatingLoader size={32} color="#fff" />
          <Text style={styles.loadingText}>{t('libraryTab.loadingLibrary')}</Text>
        </View>
      ) : showFavoritesOnly && images.length === 0 ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleRefresh}
              tintColor="#fff"
              colors={['#fff']}
            />
          }
        >
          <Heart size={64} color="#333" strokeWidth={1.5} />
          <Text style={styles.emptyText}>{t('libraryTab.noFavoritesTitle')}</Text>
          <Text style={styles.emptySubtext}>
            {t('libraryTab.noFavoritesSubtext')}
          </Text>
        </ScrollView>
      ) : images.length === 0 || forceLibraryEmptyState ? (
        <View style={styles.emptyContainer}>
          <Image
            source={require('../../assets/empty states/frame.png')}
            style={{ width: 432, height: 432, marginTop: -50, marginBottom: -60 }}
            contentFit="contain"
          />
          <Text style={styles.emptyText}>{t('libraryTab.noMediaTitle')}</Text>
          <Text style={styles.emptySubtext}>
            {t('libraryTab.noMediaSubtext')}
          </Text>
        </View>
      ) : (
        <MasonryGrid
          data={images}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={imageGridColumns}
          onRefresh={handleRefresh}
          isRefreshing={isManualRefreshing || (isLoadingInitial && images.length > 0)}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter()}
          contentContainerStyle={styles.grid}
        />
      )}

      {/* Settings Modal */}
      <LibrarySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
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
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    color: '#fff',
    fontFamily: 'SFRounded-Regular',
    fontSize: 24,
    fontWeight: '400',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  gridSwitcher: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
  },
  grid: {
    padding: ITEM_GAP,
    paddingTop: 130, // Account for fixed header
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    marginTop: 4,
  },
  row: {
    gap: ITEM_GAP,
    marginBottom: ITEM_GAP,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  image: {
    width: '100%',
    borderRadius: 8,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  completedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  failedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  failedReasonOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  failedReasonText: {
    color: '#ffb3b3',
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 13,
  },
  videoPlayIcon: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -24 }, { translateY: -24 }],
    zIndex: 10,
  },
  durationBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  favoriteButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 12,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  syncBadge: {
    marginLeft: 1,
  },
  favoritesGlassPill: {
    height: 44,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  favoritesGlassContent: {
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 12,
    paddingTop: 130, // Match header offset
  },
  emptyText: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    marginTop: 0,
  },
  emptySubtext: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
