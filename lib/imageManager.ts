/**
 * Image Manager - Core API
 *
 * Central module for all image operations:
 * - Downloading remote images to local cache
 * - Copying local files to managed storage
 * - SQLite metadata management
 * - expo-image cache integration
 * - Cache cleanup and statistics
 */

import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { db } from './database/db';
import { queries } from './database/queries';
import type {
  ImageRecord,
  ImageType,
  SaveImageParams,
  CacheStats,
  QueryOptions,
} from './types';

const CACHE_DIR = `${FileSystemLegacy.cacheDirectory}generated_images/`;
const DOCUMENT_DIR = `${FileSystemLegacy.documentDirectory}generated_images/`;

// Relative path prefix for storage (without container-specific path)
const RELATIVE_PATH_PREFIX = 'generated_images/';

/**
 * Convert absolute path to relative path for storage
 * This ensures paths survive app reinstalls when iOS changes container UUID
 */
function toRelativePath(absolutePath: string): string {
  // Already relative
  if (absolutePath.startsWith(RELATIVE_PATH_PREFIX)) {
    return absolutePath;
  }

  // Extract relative portion from absolute path
  const idx = absolutePath.indexOf(RELATIVE_PATH_PREFIX);
  if (idx !== -1) {
    return absolutePath.substring(idx);
  }

  // Not a managed path, return as-is
  return absolutePath;
}

/**
 * Convert relative path to absolute path for file operations
 * Resolves using current documentDirectory or cacheDirectory based on image type
 * Also handles legacy absolute paths from before reinstall (extracts relative portion)
 */
function toAbsolutePath(relativePath: string, type: ImageType): string {
  // Resolve based on type - uploads are temporary (cache), everything else is persistent (document)
  const baseDir = type === 'upload'
    ? FileSystemLegacy.cacheDirectory
    : FileSystemLegacy.documentDirectory;

  // Handle legacy absolute paths (from before app reinstall)
  // These contain old container UUIDs that no longer exist
  if (relativePath.startsWith('/') || relativePath.startsWith('file://')) {
    // Check if this is an old managed path that needs re-resolving
    const idx = relativePath.indexOf(RELATIVE_PATH_PREFIX);
    if (idx !== -1) {
      // Extract relative portion and resolve with current container
      const extractedRelative = relativePath.substring(idx);
      return `${baseDir}${extractedRelative}`;
    }
    // External path (not managed by us) - return as-is
    return relativePath;
  }

  return `${baseDir}${relativePath}`;
}

class ImageManager {
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Get the base directory for a given image type
   * CRITICAL: Library/generated images use documentDirectory (persistent) to prevent iOS auto-deletion
   * Only uploads use cacheDirectory (temporary storage)
   */
  private getBaseDir(type: ImageType): string {
    // Use persistent storage for soul, library, and generated images
    // Only uploads are temporary and can use cache
    return type === 'upload' ? CACHE_DIR : DOCUMENT_DIR;
  }

  /**
   * Initialize the image manager
   * Creates cache directories and ensures database is ready
   * Uses a lock to prevent concurrent initializations
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized) {
      console.log('⚡ ImageManager already initialized - skipping');
      return;
    }

    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      console.log('⏳ ImageManager initialization in progress - waiting...');
      return this.initializationPromise;
    }

    // Start initialization and store the promise
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async performInitialization(): Promise<void> {

    const startTime = Date.now();
    console.log('🔧 ImageManager: Starting initialization...');

    // Initialize database first
    const dbStartTime = Date.now();
    await db.initialize();
    const dbDuration = Date.now() - dbStartTime;
    console.log(`✅ ImageManager: Database initialized in ${dbDuration}ms`);

    // Create all directories at once using intermediates: true
    // This is much faster than checking each directory individually
    const dirsStartTime = Date.now();

    // Create all required directories in parallel
    await Promise.all([
      // Cache directories (only uploads use cache now)
      FileSystemLegacy.makeDirectoryAsync(`${CACHE_DIR}upload`, { intermediates: true }),
      FileSystemLegacy.makeDirectoryAsync(`${CACHE_DIR}temp`, { intermediates: true }),

      // Document directories (persistent storage for library/generated/soul)
      FileSystemLegacy.makeDirectoryAsync(`${DOCUMENT_DIR}soul`, { intermediates: true }),
      FileSystemLegacy.makeDirectoryAsync(`${DOCUMENT_DIR}library`, { intermediates: true }),
      FileSystemLegacy.makeDirectoryAsync(`${DOCUMENT_DIR}generated`, { intermediates: true }),
    ]);

    const dirsDuration = Date.now() - dirsStartTime;
    console.log(`✅ ImageManager: All directories created in ${dirsDuration}ms`);

    // Migrate existing images from cache to document directory (one-time migration)
    await this.migrateImagesToDocumentDirectory();

    this.initialized = true;
    const totalDuration = Date.now() - startTime;
    console.log(`🎉 ImageManager initialized successfully in ${totalDuration}ms`);
  }

  /**
   * Migrate existing library/generated images from cache to document directory
   * This is a one-time migration to prevent iOS from auto-deleting user images
   */
  private async migrateImagesToDocumentDirectory(): Promise<void> {
    try {
      // Get all library and generated images
      const images = await queries.getAllImages();
      const toMigrate = images.filter(
        (img) => (img.type === 'library' || img.type === 'generated') && img.status === 'active'
      );

      if (toMigrate.length === 0) {
        console.log('📦 ImageManager: No images to migrate');
        return;
      }

      console.log(`📦 ImageManager: Migrating ${toMigrate.length} images to document directory...`);
      let migratedCount = 0;
      let skippedCount = 0;
      let alreadyOkCount = 0;
      let errorCount = 0;

      for (const img of toMigrate) {
        try {
          const uri = img.localUri;

          // If localUri is already absolute, check if the file exists at that path
          if (uri.startsWith('/') || uri.startsWith('file://')) {
            const fileInfo = await FileSystemLegacy.getInfoAsync(uri);
            if (fileInfo.exists) {
              // File exists at absolute path — convert DB record to relative path
              const relativePath = toRelativePath(uri);
              if (relativePath !== uri) {
                await queries.updateImage(img.id, { localUri: relativePath });
              }
              alreadyOkCount++;
              continue;
            }
            // Absolute path but file missing — try to find it via relative extraction
            const relativePath = toRelativePath(uri);
            if (relativePath !== uri) {
              const resolvedPath = `${FileSystemLegacy.documentDirectory}${relativePath}`;
              const resolvedInfo = await FileSystemLegacy.getInfoAsync(resolvedPath);
              if (resolvedInfo.exists) {
                await queries.updateImage(img.id, { localUri: relativePath });
                alreadyOkCount++;
                continue;
              }
            }
            // Truly missing — skip but don't delete (could be transient)
            console.warn(`📦 Image file missing (absolute): ${uri}`);
            errorCount++;
            continue;
          }

          // Relative path — check if file is in document directory (correct location)
          const destPath = `${FileSystemLegacy.documentDirectory}${uri}`;
          const destInfo = await FileSystemLegacy.getInfoAsync(destPath);
          if (destInfo.exists) {
            skippedCount++;
            continue; // Already in the right place
          }

          // Check if file is in cache directory (needs migration)
          const sourcePath = `${FileSystemLegacy.cacheDirectory}${uri}`;
          const sourceInfo = await FileSystemLegacy.getInfoAsync(sourcePath);
          if (sourceInfo.exists) {
            // Move from cache to document directory
            await FileSystemLegacy.moveAsync({ from: sourcePath, to: destPath });
            migratedCount++;
            continue;
          }

          // File not found in either location — skip but don't delete
          console.warn(`📦 Image file missing (relative): ${uri}`);
          errorCount++;
        } catch (error) {
          console.warn(`📦 Failed to migrate image ${img.id}:`, error);
          errorCount++;
        }
      }

      console.log(
        `✅ ImageManager: Migration complete - migrated: ${migratedCount}, already ok: ${alreadyOkCount}, skipped: ${skippedCount}, errors: ${errorCount}`
      );
    } catch (error) {
      console.error('❌ ImageManager: Migration failed:', error);
      // Don't throw - app should still work even if migration fails
    }
  }

  /**
   * Save an image (download if remote, copy if local, store metadata)
   *
   * @param params - Image save parameters
   * @returns The saved image record
   */
  async saveImage(params: SaveImageParams): Promise<ImageRecord> {
    await this.initialize();

    const id = this.generateId();
    const timestamp = Date.now();

    // Download or copy image file
    let localUri: string;
    if (params.remoteUri) {
      console.log(`Downloading image from: ${params.remoteUri}`);
      localUri = await this.downloadImage(params.remoteUri, id, params.type);
      console.log(`Downloaded to: ${localUri}`);
    } else if (params.localUri) {
      console.log(`Copying image from: ${params.localUri}`);
      localUri = await this.copyToCache(params.localUri, id, params.type);
      console.log(`Copied to: ${localUri}`);
    } else {
      throw new Error('Either remoteUri or localUri must be provided');
    }

    // Get file info
    const file = new File(localUri);
    let fileSize: number | undefined;
    try {
      const info = await file.stat();
      fileSize = info.size;
    } catch {
      fileSize = undefined;
    }

    // Convert to relative path for storage (survives reinstalls)
    const relativeUri = toRelativePath(localUri);

    // Create record with relative path for database storage
    const dbRecord: ImageRecord = {
      id,
      localUri: relativeUri, // Store relative path
      remoteUri: params.remoteUri,
      type: params.type,
      category: params.category,
      metadata: params.metadata,
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      status: 'active',
      fileSize,
      mimeType: params.mimeType || this.guessMimeType(localUri),
      width: params.width,
      height: params.height,
    };

    // Insert into database with relative path
    await queries.insertImage(dbRecord);

    // Return record with absolute path for immediate use
    const record: ImageRecord = {
      ...dbRecord,
      localUri, // Return absolute path to caller
    };

    // Prefetch with expo-image if requested
    if (params.prefetch) {
      Image.prefetch(localUri, 'disk').catch((error) => {
        console.warn('Failed to prefetch image:', error);
      });
    }

    console.log(`Image saved successfully: ${id}`);
    return record;
  }

  /**
   * Resolve a record's relative path to absolute
   */
  private resolveRecordPath(record: ImageRecord): ImageRecord {
    return {
      ...record,
      localUri: toAbsolutePath(record.localUri, record.type),
    };
  }

  /**
   * Get an image by ID
   * Updates lastAccessedAt for LRU cache cleanup
   */
  async getImage(id: string): Promise<ImageRecord | null> {
    await this.initialize();

    const record = await queries.getImageById(id);

    if (record) {
      // Resolve relative path to absolute
      const resolvedRecord = this.resolveRecordPath(record);

      // Update last accessed time (async, don't block)
      queries.updateLastAccessed(id, Date.now()).catch((error) => {
        console.warn('Failed to update lastAccessedAt:', error);
      });

      // Verify file still exists using legacy API for reliability
      try {
        const fileInfo = await FileSystemLegacy.getInfoAsync(resolvedRecord.localUri);
        if (!fileInfo.exists) {
          console.warn(`Image file missing: ${resolvedRecord.localUri}`);
          // Mark as deleted
          await queries.updateImageStatus(id, 'deleted');
          return null;
        }
      } catch (error) {
        // If we can't check file existence, log warning but don't fail
        console.warn(`Could not verify file existence for ${resolvedRecord.localUri}:`, error);
      }

      return resolvedRecord;
    }

    return null;
  }

  /**
   * Get images by type with optional filtering
   * Resolves relative paths to absolute
   */
  async getImagesByType(
    type: ImageType,
    options?: QueryOptions
  ): Promise<ImageRecord[]> {
    await this.initialize();
    const records = await queries.getImagesByType(type, options);
    return records.map(r => this.resolveRecordPath(r));
  }

  /**
   * Get all active images
   * Resolves relative paths to absolute
   */
  async getAllImages(): Promise<ImageRecord[]> {
    await this.initialize();
    const records = await queries.getAllActiveImages();
    return records.map(r => this.resolveRecordPath(r));
  }

  /**
   * Update an image record
   */
  async updateImage(
    id: string,
    updates: Partial<ImageRecord>
  ): Promise<void> {
    await this.initialize();
    await queries.updateImage(id, updates);
  }

  /**
   * Delete an image (soft delete by default)
   *
   * @param id - Image ID
   * @param hard - If true, permanently delete file and record
   */
  async deleteImage(id: string, hard = false): Promise<void> {
    await this.initialize();

    const record = await this.getImage(id);
    if (!record) {
      console.warn(`Image not found: ${id}`);
      return;
    }

    if (hard) {
      // Delete physical file using legacy API
      try {
        const fileInfo = await FileSystemLegacy.getInfoAsync(record.localUri);
        if (fileInfo.exists) {
          await FileSystemLegacy.deleteAsync(record.localUri);
        }
        console.log(`Deleted file: ${record.localUri}`);
      } catch (error) {
        console.warn('Failed to delete file:', error);
      }

      // Delete from database
      await queries.deleteImage(id);
      console.log(`Hard deleted image: ${id}`);

      // Clear from expo-image memory cache
      await Image.clearMemoryCache();
    } else {
      // Soft delete
      await queries.updateImageStatus(id, 'deleted');
      console.log(`Soft deleted image: ${id}`);
    }
  }

  /**
   * Prefetch multiple images for faster rendering
   * Loads images into expo-image memory+disk cache
   */
  async prefetchImages(ids: string[]): Promise<void> {
    await this.initialize();

    if (ids.length === 0) return;

    console.log(`Prefetching ${ids.length} images...`);

    const records = await Promise.all(ids.map((id) => this.getImage(id)));

    const uris = records
      .filter((r): r is ImageRecord => r !== null)
      .map((r) => r.localUri);

    if (uris.length > 0) {
      try {
        await Image.prefetch(uris, 'memory-disk');
        console.log(`Prefetched ${uris.length} images`);
      } catch (error) {
        console.warn('Failed to prefetch images:', error);
      }
    }
  }

  /**
   * Clear old cached images
   *
   * @param daysOld - Delete images not accessed in this many days
   * @returns Number of images deleted
   */
  async clearOldCache(daysOld = 30): Promise<number> {
    await this.initialize();

    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    console.log(`Clearing cache older than ${daysOld} days...`);

    const oldImages = await queries.getImagesOlderThan(cutoffTime);
    console.log(`Found ${oldImages.length} old images`);

    let deletedCount = 0;
    for (const image of oldImages) {
      try {
        await this.deleteImage(image.id, true);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete image ${image.id}:`, error);
      }
    }

    console.log(`Deleted ${deletedCount} old images`);
    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    await this.initialize();

    const allImages = await queries.getAllActiveImages();

    const stats: CacheStats = {
      totalImages: allImages.length,
      totalSizeBytes: 0,
      totalSizeMB: 0,
      oldestImageDate: Number.MAX_SAFE_INTEGER,
      newestImageDate: 0,
      byType: { soul: 0, library: 0, upload: 0, generated: 0 },
      avgFileSizeBytes: 0,
    };

    for (const image of allImages) {
      stats.totalSizeBytes += image.fileSize || 0;
      stats.byType[image.type]++;

      if (image.createdAt < stats.oldestImageDate) {
        stats.oldestImageDate = image.createdAt;
      }
      if (image.createdAt > stats.newestImageDate) {
        stats.newestImageDate = image.createdAt;
      }
    }

    stats.totalSizeMB = stats.totalSizeBytes / (1024 * 1024);
    stats.avgFileSizeBytes =
      stats.totalImages > 0 ? stats.totalSizeBytes / stats.totalImages : 0;

    return stats;
  }

  /**
   * Clear all expo-image caches (memory + disk)
   */
  async clearExpoImageCache(): Promise<void> {
    console.log('Clearing expo-image caches...');
    await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
    console.log('expo-image caches cleared');
  }

  /**
   * Search images by keyword (searches category and metadata)
   */
  async searchImages(searchTerm: string): Promise<ImageRecord[]> {
    await this.initialize();
    return queries.searchImages(searchTerm);
  }

  // Private helper methods

  private generateId(): string {
    return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async ensureSubdirectory(name: string, baseDir: string): Promise<void> {
    const dirPath = `${baseDir}${name}/`;
    const info = await FileSystemLegacy.getInfoAsync(dirPath);
    if (!info.exists) {
      await FileSystemLegacy.makeDirectoryAsync(dirPath, { intermediates: true });
      console.log(`Created subdirectory: ${name} in ${baseDir}`);
    }
  }

  private async downloadImage(
    remoteUri: string,
    id: string,
    type: ImageType
  ): Promise<string> {
    const extension = this.getExtensionFromUrl(remoteUri);
    const filename = `${id}${extension}`;
    const baseDir = this.getBaseDir(type);
    const localUri = `${baseDir}${type}/${filename}`;

    try {
      const result = await FileSystemLegacy.downloadAsync(remoteUri, localUri);
      return result.uri;
    } catch (error) {
      throw new Error(
        `Failed to download image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async copyToCache(
    sourceUri: string,
    id: string,
    type: ImageType
  ): Promise<string> {
    const extension = this.getExtensionFromUrl(sourceUri);
    const filename = `${id}${extension}`;
    const baseDir = this.getBaseDir(type);
    const destUri = `${baseDir}${type}/${filename}`;

    try {
      await FileSystemLegacy.copyAsync({
        from: sourceUri,
        to: destUri,
      });
      return destUri;
    } catch (error) {
      throw new Error(
        `Failed to copy image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private getExtensionFromUrl(url: string): string {
    // Match both image and video extensions
    const match = url.match(/\.(jpg|jpeg|png|gif|webp|heic|mp4|mov|avi|webm|m4v)($|\?)/i);
    return match ? `.${match[1].toLowerCase()}` : '.jpg';
  }

  private guessMimeType(uri: string): string {
    const ext = uri.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      // Images
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      heic: 'image/heic',
      // Videos
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
      m4v: 'video/x-m4v',
    };
    return mimeMap[ext || ''] || 'image/jpeg';
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const imageManager = new ImageManager();

// Export path helpers for use by other modules (e.g., SoulsContext)
export { toRelativePath, toAbsolutePath };
