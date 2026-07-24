import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useLibrary, LibraryImage, isProcessingStatus } from '../../contexts/LibraryContext';

interface EditorPreviewGalleryProps {
  batchId: string | null;
  originalImageUri: string | null;
  currentImageUri: string | null;
  onImageSelect: (uri: string, isOriginal: boolean) => void;
}

const THUMBNAIL_SIZE = 80;

// Processing overlay component with animation
function ThumbnailProcessingOverlay({ status }: { status: string }) {
  const opacity = useSharedValue(0.7);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.5, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.thumbnailOverlay, animatedStyle]}>
      <ActivityIndicator size="small" color="#fff" />
    </Animated.View>
  );
}

export default function EditorPreviewGallery({
  batchId,
  originalImageUri,
  currentImageUri,
  onImageSelect,
}: EditorPreviewGalleryProps) {
  const { t } = useTranslation();
  const { images } = useLibrary();
  const [batchImages, setBatchImages] = useState<LibraryImage[]>([]);

  // Filter images by batch ID
  useEffect(() => {
    if (!batchId) {
      setBatchImages([]);
      return;
    }

    const filtered = images.filter(
      (img) => img.metadata?.batchId === batchId || img.batchId === batchId
    );

    console.log('🖼️ EditorPreviewGallery: Filtering batch images:', {
      batchId,
      totalImages: images.length,
      filteredCount: filtered.length,
      filtered: filtered.map(img => ({
        id: img.id,
        status: img.status,
        model: img.model,
        transformedImageUrl: img.transformedImageUrl ? 'has URL' : 'NULL',
        originalImageUri: img.originalImageUri ? 'has URI' : 'NULL',
        metadataBatchId: img.metadata?.batchId,
        topLevelBatchId: img.batchId,
      })),
    });

    // Sort by creation time (oldest first)
    const sorted = [...filtered].sort((a, b) => a.createdAt - b.createdAt);

    console.log('🖼️ EditorPreviewGallery: Setting batchImages:', sorted.length);
    setBatchImages(sorted);
  }, [batchId, images]);

  // Don't show gallery if no batch is active
  // Always show if we have a batchId, even if no images yet (show original while waiting)
  if (!batchId) {
    return null;
  }

  // Build thumbnails array: original first, then generated images
  const thumbnails: Array<{
    uri: string;
    isOriginal: boolean;
    status?: string;
    libraryImage?: LibraryImage;
  }> = [];

  // Add original image first
  if (originalImageUri) {
    thumbnails.push({
      uri: originalImageUri,
      isOriginal: true,
    });
  }

  // Add generated images
  batchImages.forEach((img) => {
    const displayUri = img.transformedImageUrl || img.originalImageUri;
    console.log('🖼️ EditorPreviewGallery: Processing image for thumbnail:', {
      id: img.id.substring(0, 8),
      status: img.status,
      transformedImageUrl: img.transformedImageUrl ? 'has URL' : 'NULL',
      originalImageUri: img.originalImageUri ? 'has URI' : 'NULL',
      displayUri: displayUri ? 'has displayUri' : 'NULL',
      willAddToThumbnails: !!displayUri,
    });
    if (displayUri) {
      thumbnails.push({
        uri: displayUri,
        isOriginal: false,
        status: img.status,
        libraryImage: img,
      });
    }
  });

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {thumbnails.map((thumb, index) => {
          const isSelected = currentImageUri === thumb.uri;
          const isProcessing = thumb.status && isProcessingStatus(thumb.status);
          const isFailed = thumb.status === 'failed';

          return (
            <Pressable
              key={`${thumb.isOriginal ? 'original' : thumb.libraryImage?.id || index}`}
              style={[
                styles.thumbnail,
                isSelected && styles.thumbnailSelected,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onImageSelect(thumb.uri, thumb.isOriginal);
              }}
            >
              {/* Image with blur for loading state */}
              <Image
                source={{ uri: thumb.uri }}
                style={styles.thumbnailImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={{ duration: 200 }}
              />

              {/* Blur overlay for processing images */}
              {isProcessing && originalImageUri && (
                <View style={styles.blurContainer}>
                  <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
                  <ThumbnailProcessingOverlay status={thumb.status!} />
                </View>
              )}

              {/* Failed overlay */}
              {isFailed && (
                <View style={[styles.thumbnailOverlay, styles.failedOverlay]}>
                  <Text style={styles.failedText}>✕</Text>
                </View>
              )}

              {/* Original badge */}
              {thumb.isOriginal && (
                <View style={styles.originalBadge}>
                  <Text style={styles.originalBadgeText}>{t('editorPreview.original')}</Text>
                </View>
              )}

              {/* Generated image badge - shown for completed non-original images */}
              {!thumb.isOriginal && thumb.status === 'completed' && (
                <View style={styles.generatedBadge}>
                  <Text style={styles.generatedBadgeText}>{t('editorPreview.editThis')}</Text>
                </View>
              )}

              {/* Selection border */}
              {isSelected && <View style={styles.selectedBorder} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: THUMBNAIL_SIZE + 16,
    marginBottom: 12,
  },
  scrollContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  thumbnailSelected: {
    opacity: 1,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  blurContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  failedOverlay: {
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
  },
  failedText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  originalBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  originalBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  generatedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  generatedBadgeText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  selectedBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: '#3b82f6',
    borderRadius: 12,
  },
});
