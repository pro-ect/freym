/**
 * Image Storage System - TypeScript Types
 *
 * Shared type definitions for the image management system
 */

export type ImageType = 'soul' | 'library' | 'upload' | 'generated';
export type ImageStatus = 'active' | 'deleted' | 'pending_sync';

/**
 * Core image record stored in SQLite
 */
export interface ImageRecord {
  id: string;
  localUri: string;
  remoteUri?: string;
  type: ImageType;
  category?: string;
  metadata?: ImageMetadata;
  createdAt: number;
  lastAccessedAt: number;
  syncedAt?: number;
  status: ImageStatus;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  is_favorite?: number;
  favorite_synced_at?: number;
  favorite_remote_id?: string;
}

/**
 * Flexible metadata structure for different image types
 */
export interface ImageMetadata {
  // Library images
  prompt?: string;
  model?: string;
  originalImageUri?: string;

  // Generation metadata
  api?: 'replicate' | 'seedream';
  predictionId?: string;
  taskId?: string;
  modelId?: string;
  options?: Record<string, any>;

  // Processing
  hasReferenceImages?: boolean;
  numReferenceImages?: number;
  referenceImages?: string[];

  // User data
  tags?: string[];
  notes?: string;

  // Soul-specific
  soulId?: string;
  soulName?: string;
  position?: number;

  // Placeholder support
  blurhash?: string;
  thumbhash?: string;

  // Any other custom fields
  [key: string]: any;
}

/**
 * Parameters for saving a new image
 */
export interface SaveImageParams {
  // Either localUri or remoteUri must be provided
  localUri?: string;
  remoteUri?: string;

  // Required fields
  type: ImageType;

  // Optional fields
  category?: string;
  metadata?: ImageMetadata;
  mimeType?: string;
  width?: number;
  height?: number;

  // Behavior flags
  prefetch?: boolean; // Auto-prefetch with expo-image after save
}

/**
 * Cache statistics for analytics and cleanup
 */
export interface CacheStats {
  totalImages: number;
  totalSizeBytes: number;
  totalSizeMB: number;
  oldestImageDate: number;
  newestImageDate: number;
  byType: Record<ImageType, number>;
  avgFileSizeBytes: number;
}

/**
 * Sync result for remote storage sync
 */
export interface SyncResult {
  uploaded?: number;
  downloaded?: number;
  failed?: number;
  skipped?: number;
  errors?: string[];
}

/**
 * Query options for filtering images
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  category?: string;
  status?: ImageStatus;
  orderBy?: 'createdAt' | 'lastAccessedAt';
  orderDirection?: 'ASC' | 'DESC';
}
