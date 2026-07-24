/**
 * Image Upload Utility for Supabase Storage
 *
 * Uploads images to Supabase storage and returns public URLs.
 * Used for Fal.ai models that require image URLs instead of base64.
 * Images are optimized (resized/compressed) before upload.
 */

import { Platform } from 'react-native';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { decode } from 'base64-arraybuffer';

const BUCKET_NAME = 'generation-inputs';
const MAX_DIMENSION = 2048; // Good balance for Fal.ai (supports up to 4096 but 2K is plenty)
const TARGET_SIZE_KB = 1000; // Target ~1MB per image

/**
 * Optimize image for upload - resize to 2K max, compress to ~1MB
 * Balances quality vs upload speed for multiple reference images
 * @param localUri - Local file URI
 * @returns Optimized image base64
 */
async function optimizeImage(localUri: string): Promise<{ uri: string; base64: string }> {
  console.log('📤 [Storage] Optimizing image...');

  // ImageManipulator needs a local file — pull remote URIs (e.g. an Inspire
  // reference photo whose background download hasn't finished) into the cache.
  // (Web keeps its old behavior: blob URLs pass straight through and the
  // legacy filesystem API is unavailable there anyway.)
  if (Platform.OS !== 'web' && (localUri.startsWith('http://') || localUri.startsWith('https://'))) {
    console.log('📤 [Storage] Remote URI, downloading before optimize...');
    const path = `${cacheDirectory}upload_src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const dl = await downloadAsync(localUri, path);
    localUri = dl.uri;
  }

  // First pass: get dimensions
  const info = await ImageManipulator.manipulateAsync(localUri, [], {});
  console.log(`📤 [Storage] Original: ${info.width}x${info.height}`);

  // Resize if exceeds max dimension
  const actions: ImageManipulator.Action[] = [];
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    if (info.width >= info.height) {
      actions.push({ resize: { width: MAX_DIMENSION } });
    } else {
      actions.push({ resize: { height: MAX_DIMENSION } });
    }
  }

  // Start with high quality
  let quality = 0.92;
  let result = await ImageManipulator.manipulateAsync(localUri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  let sizeKB = Math.round((result.base64!.length * 3) / 4 / 1024);
  console.log(`📤 [Storage] First pass: ${result.width}x${result.height}, ${sizeKB}KB @ ${Math.round(quality * 100)}%`);

  // If still too large, compress more (but not below 80% quality)
  while (sizeKB > TARGET_SIZE_KB && quality > 0.80) {
    quality -= 0.05;
    result = await ImageManipulator.manipulateAsync(localUri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    sizeKB = Math.round((result.base64!.length * 3) / 4 / 1024);
    console.log(`📤 [Storage] Recompressed: ${sizeKB}KB @ ${Math.round(quality * 100)}%`);
  }

  console.log(`📤 [Storage] Final: ${result.width}x${result.height}, ${sizeKB}KB`);

  return {
    uri: result.uri,
    base64: result.base64!,
  };
}

/**
 * Upload a single image to Supabase storage
 * @param localUri - Local file URI (file:// or content://)
 * @param userId - User ID for path organization
 * @returns Public URL of uploaded image
 */
export async function uploadImageToStorage(
  localUri: string,
  userId: string
): Promise<string> {
  console.log('📤 [Storage] Processing image:', localUri.substring(0, 50) + '...');

  try {
    // Optimize image (resize + compress)
    const { base64 } = await optimizeImage(localUri);

    const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
    console.log(`📤 [Storage] Optimized size: ${sizeKB} KB`);

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileName = `${userId}/${timestamp}_${randomId}.jpg`;

    console.log('📤 [Storage] Uploading to path:', fileName);

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, decode(base64), {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('📤 [Storage] Upload error:', error);
      throw error;
    }

    console.log('📤 [Storage] Upload successful:', data.path);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(data.path);

    console.log('📤 [Storage] Public URL:', urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error('📤 [Storage] Failed to upload image:', error);
    throw new Error(`Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload multiple images to Supabase storage
 * @param localUris - Array of local file URIs
 * @param userId - User ID for path organization
 * @returns Array of public URLs
 */
export async function uploadImagesToStorage(
  localUris: string[],
  userId: string
): Promise<string[]> {
  console.log(`📤 [Storage] Uploading ${localUris.length} images...`);

  const uploadPromises = localUris.map((uri, index) => {
    console.log(`📤 [Storage] Queuing upload ${index + 1}/${localUris.length}`);
    return uploadImageToStorage(uri, userId);
  });

  const urls = await Promise.all(uploadPromises);

  console.log(`📤 [Storage] All ${urls.length} images uploaded successfully`);
  return urls;
}

/**
 * Clean up uploaded images after generation completes or fails
 * @param urls - Array of public URLs to delete
 */
export async function cleanupUploadedImages(urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  console.log(`🗑️ [Storage] Cleaning up ${urls.length} temporary images...`);

  try {
    // Extract file paths from URLs
    const paths = urls.map(url => {
      const urlObj = new URL(url);
      // Path format: /storage/v1/object/public/bucket-name/path/to/file
      const pathMatch = urlObj.pathname.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
      return pathMatch ? pathMatch[1] : null;
    }).filter(Boolean) as string[];

    if (paths.length > 0) {
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(paths);

      if (error) {
        console.warn('🗑️ [Storage] Cleanup warning:', error);
      } else {
        console.log('🗑️ [Storage] Cleanup successful');
      }
    }
  } catch (error) {
    console.warn('🗑️ [Storage] Cleanup failed:', error);
    // Don't throw - cleanup failures shouldn't break the flow
  }
}
