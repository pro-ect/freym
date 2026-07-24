/**
 * Image Compression Utilities for Recipe Sharing
 *
 * Compresses images to reduce storage and bandwidth costs
 * Target: < 200KB per image for thumbnails
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

export interface CompressionOptions {
  maxWidth: number;      // Max width in pixels
  maxHeight: number;     // Max height in pixels
  quality: number;       // 0-1, JPEG quality
  targetSizeKB?: number; // Target file size (iterative compression)
}

export interface CompressionResult {
  uri: string;    // Local URI of compressed image
  sizeKB: number; // Size in KB
  width: number;  // Final width
  height: number; // Final height
}

/**
 * Copy image to accessible location if needed
 */
async function ensureImageAccessible(imageUri: string): Promise<string> {
  try {
    // Check if file exists and is readable
    const fileInfo = await FileSystem.getInfoAsync(imageUri);

    if (!fileInfo.exists) {
      throw new Error('Image file does not exist');
    }

    // If it's in cache, copy to document directory
    if (imageUri.includes('/Caches/') || imageUri.includes('/tmp/')) {
      const filename = imageUri.split('/').pop() || `image-${Date.now()}.jpg`;
      const newUri = `${FileSystem.documentDirectory}${filename}`;

      await FileSystem.copyAsync({
        from: imageUri,
        to: newUri,
      });

      console.log('Copied image from cache to documents:', newUri);
      return newUri;
    }

    return imageUri;
  } catch (error) {
    console.error('Error ensuring image accessible:', error);
    throw error;
  }
}

/**
 * Compress an image for recipe sharing
 * Target: < 500KB for good quality previews
 */
export async function compressImageForRecipe(
  imageUri: string,
  options: CompressionOptions = {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.9,
    targetSizeKB: 500,
  }
): Promise<CompressionResult> {
  try {
    // Step 0: Ensure image is accessible
    const accessibleUri = await ensureImageAccessible(imageUri);

    // Step 1: Resize image while preserving aspect ratio
    // Only specify width to maintain aspect ratio
    const resized = await ImageManipulator.manipulateAsync(
      accessibleUri,
      [
        {
          resize: {
            width: options.maxWidth,
            // Don't specify height - let it maintain aspect ratio
          },
        },
      ],
      {
        compress: options.quality,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    // Step 2: Check file size
    const fileInfo = await FileSystem.getInfoAsync(resized.uri);
    const sizeKB = fileInfo.size ? fileInfo.size / 1024 : 0;

    // Step 3: If still too large and quality can be reduced, try again
    // Minimum quality 0.7 to avoid artifacts
    if (options.targetSizeKB && sizeKB > options.targetSizeKB && options.quality > 0.7) {
      console.log(`Image too large (${Math.round(sizeKB)}KB), reducing quality...`);
      return await compressImageForRecipe(resized.uri, {
        ...options,
        quality: options.quality * 0.9, // Reduce quality by 10%
      });
    }

    return {
      uri: resized.uri,
      sizeKB: Math.round(sizeKB),
      width: resized.width,
      height: resized.height,
    };
  } catch (error) {
    console.error('Error compressing image:', error);
    throw error;
  }
}

/**
 * Get base64 data from compressed image (for embedding in JSON)
 * Use sparingly - prefer Supabase Storage for most cases
 */
export async function getCompressedImageBase64(
  imageUri: string,
  options?: CompressionOptions
): Promise<string> {
  const compressed = await compressImageForRecipe(imageUri, options);
  const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64;
}

/**
 * Convert base64 to local file URI
 */
export async function base64ToFileUri(
  base64: string,
  filename: string = 'image.jpg'
): Promise<string> {
  const localUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(localUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return localUri;
}

/**
 * Download image from URL to local storage
 */
export async function downloadImageToLocal(url: string): Promise<string> {
  // Use unique filename to avoid collisions (many URLs end with "result.jpg")
  const ext = (url.split('/').pop() || 'image.jpg').split('.').pop() || 'jpg';
  const filename = `recipe-dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const localUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.downloadAsync(url, localUri);
  return localUri;
}

/**
 * Get file size in KB
 */
export async function getFileSizeKB(uri: string): Promise<number> {
  const fileInfo = await FileSystem.getInfoAsync(uri);
  return fileInfo.size ? fileInfo.size / 1024 : 0;
}
