/**
 * Image Download Utilities
 *
 * Handles downloading images from URLs (like Replicate) and saving them
 * to the device's local storage and media library.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

/**
 * Hard ceiling for a single media download. `File.downloadFileAsync` exposes no
 * timeout/abort, so a stalled CDN stream would otherwise await forever and wedge
 * the job on "Saving to library / Almost done…". Racing it against a timeout
 * turns the hang into a rejection that the queue's retry/watchdog paths handle.
 */
const DOWNLOAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Download media (image or video) from URL and save to local cache
 * Returns the local file URI
 * Automatically detects file type from URL extension
 */
export async function downloadMediaToCache(mediaUrl: string): Promise<string> {
  try {
    const downloadStartTime = Date.now();
    const startTimestamp = new Date().toISOString();
    console.log(`⏰ [${startTimestamp}] 📥 downloadMediaToCache START`);
    console.log(`⏰ [${startTimestamp}] 🌐 Downloading media from URL:`, mediaUrl);

    // Validate URL
    if (!mediaUrl || mediaUrl === 'null' || mediaUrl === 'undefined') {
      throw new Error('Invalid media URL: URL is null or undefined');
    }

    // Get or create directory for generated media (use Documents for persistence)
    const cacheDirStartTime = Date.now();
    const cacheDir = new Directory(Paths.document, 'generated_images');
    try {
      // Try to create directory (will fail if it already exists, which is fine)
      if (!cacheDir.exists) {
        cacheDir.create();
      }
    } catch (error: any) {
      // Ignore "already exists" errors
      if (!error.message?.includes('already exists')) {
        throw error;
      }
    }
    console.log(`⏰ [${new Date().toISOString()}] 📁 Cache directory ready (${Date.now() - cacheDirStartTime}ms)`);

    // Detect file type from URL extension
    const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.m4v'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'];

    const urlLower = mediaUrl.toLowerCase();
    let extension = '.jpg'; // default to jpg

    // Check for video extensions
    for (const ext of videoExtensions) {
      if (urlLower.includes(ext)) {
        extension = ext;
        break;
      }
    }

    // If not video, check for image extensions
    if (extension === '.jpg') {
      for (const ext of imageExtensions) {
        if (urlLower.includes(ext)) {
          extension = ext;
          break;
        }
      }
    }

    // Generate unique filename with correct extension
    const prefix = extension.startsWith('.') && extension !== '.jpg'
      ? (videoExtensions.includes(extension) ? 'vid' : 'img')
      : 'img';
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}${extension}`;

    console.log(`⏰ [${new Date().toISOString()}] 📄 Target filename: ${filename}`);

    // Create a File object for the destination
    const destinationFile = new File(cacheDir, filename);

    // Download the media using new File API
    console.log(`⏰ [${new Date().toISOString()}] 🌐 Starting File.downloadFileAsync...`);
    const fileDownloadStartTime = Date.now();
    const downloadedFile = await withTimeout(
      File.downloadFileAsync(mediaUrl, destinationFile, {
        idempotent: true, // Overwrite if file already exists
      }),
      DOWNLOAD_TIMEOUT_MS,
      'File.downloadFileAsync'
    );
    const fileDownloadEndTime = Date.now();
    console.log(`⏰ [${new Date().toISOString()}] ✅ File.downloadFileAsync complete (${fileDownloadEndTime - fileDownloadStartTime}ms)`);

    const totalTime = Date.now() - downloadStartTime;
    console.log(`⏰ [${new Date().toISOString()}] ✅ Media downloaded to: ${downloadedFile.uri}`);
    console.log(`⏰ [${new Date().toISOString()}] 📊 Total download time: ${totalTime}ms`);
    return downloadedFile.uri;
  } catch (error: any) {
    console.error('Error downloading media:', error);
    throw new Error(`Failed to download media: ${error.message}`);
  }
}

/**
 * Download image from URL and save to local cache
 * Returns the local file URI
 * @deprecated Use downloadMediaToCache instead for better video support
 */
export async function downloadImageToCache(imageUrl: string): Promise<string> {
  return downloadMediaToCache(imageUrl);
}

/**
 * Save image to device's media library (permanent storage)
 * Requires media library permissions
 */
export async function saveImageToMediaLibrary(localUri: string): Promise<void> {
  try {
    // Request permissions
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('Media library permission not granted, skipping save');
      return;
    }

    // Save to media library
    await MediaLibrary.saveToLibraryAsync(localUri);
    console.log('Image saved to media library');
  } catch (error: any) {
    console.error('Error saving to media library:', error);
    throw new Error(`Failed to save to media library: ${error.message}`);
  }
}

/**
 * Download image from URL and optionally save to media library
 * Returns the local cache URI
 * @param imageUrl - URL of the image to download
 * @param saveToLibrary - Whether to also save to media library (default: false)
 */
export async function downloadAndSaveImage(
  imageUrl: string,
  saveToLibrary: boolean = false
): Promise<string> {
  // Download to cache first
  const localUri = await downloadImageToCache(imageUrl);

  // Save to media library if requested (don't block on this)
  if (saveToLibrary) {
    saveImageToMediaLibrary(localUri).catch(error => {
      console.warn('Failed to save to media library:', error);
      // Continue even if media library save fails
    });
  }

  return localUri;
}

/**
 * Clear all cached images
 */
export async function clearImageCache(): Promise<void> {
  try {
    // Clear the generated_images directory
    const cacheDir = new Directory(Paths.document, 'generated_images');

    if (!cacheDir.exists) {
      console.log('Cache directory does not exist, nothing to clear');
      return;
    }

    // Delete the entire directory
    cacheDir.delete();
    console.log('Cache cleared successfully');
  } catch (error: any) {
    console.error('Error clearing cache:', error);
    throw new Error(`Failed to clear cache: ${error.message}`);
  }
}

/**
 * Get cache size in MB
 */
export async function getCacheSize(): Promise<number> {
  try {
    const cacheDir = new Directory(Paths.document, 'generated_images');

    if (!cacheDir.exists) {
      return 0;
    }

    // List all files in the directory
    const files = cacheDir.list();
    let totalSize = 0;

    for (const item of files) {
      try {
        if (item instanceof File) {
          totalSize += item.size || 0;
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    // Return size in MB
    return totalSize / (1024 * 1024);
  } catch (error) {
    console.error('Error getting cache size:', error);
    return 0;
  }
}
