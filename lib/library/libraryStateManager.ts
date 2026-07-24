/**
 * Library State Manager
 *
 * Central state management for library images with EventEmitter pattern.
 * Provides single source of truth for library state:
 * - Loads from SQLite on initialization
 * - Subscribes to QueueManager for real-time updates
 * - Emits state change events to observers (LibraryContext)
 * - Writes to SQLite asynchronously in background
 *
 * This solves the status monitoring issues by:
 * 1. Making in-memory state the source of truth
 * 2. SQLite becomes persistence layer only
 * 3. Always reconciling queue state with library state
 * 4. No stale data on refresh - state is always current
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { imageManager, toAbsolutePath } from '../imageManager';
import { queueManager } from '../queue/queueManager';
import type { QueueJob } from '../queue/types';
import type { ImageRecord } from '../types';
import { queries } from '../database/queries';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase';

// Re-export types from LibraryContext for backward compatibility
export type LibraryImageStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'waiting'
  | 'downloading'
  | 'saving'
  | 'paused'
  | 'completed'
  | 'failed';

export const PROCESSING_STATUSES: LibraryImageStatus[] = [
  'pending',
  'uploading',
  'processing',
  'waiting',
  'downloading',
  'saving',
];

const PROCESSING_STATUS_SET = new Set(PROCESSING_STATUSES);

export function isProcessingStatus(status: LibraryImageStatus): boolean {
  return PROCESSING_STATUS_SET.has(status);
}

// Monotonic rank for status progression. Used by refresh() to avoid
// visually rolling a tile backwards when SQLite lags in-memory state.
const STATUS_RANK: Record<LibraryImageStatus, number> = {
  pending: 0,
  waiting: 0,
  paused: 0,
  uploading: 1,
  processing: 2,
  downloading: 3,
  saving: 4,
  completed: 5,
  failed: 5,
};

export type FavoriteSyncStatus = 'none' | 'syncing' | 'synced' | 'failed';

export interface LibraryImage {
  id: string;
  originalImageUri: string;
  inputImages?: string[];
  transformedImageUrl: string | null;
  prompt: string;
  model: string;
  status: LibraryImageStatus;
  createdAt: number;
  completedAt?: number;
  metadata?: any;
  error?: string;
  predictionId?: string;
  taskId?: string;
  api?: 'replicate' | 'seedream';
  modelId?: string;
  options?: Record<string, any>;
  queueJobId?: string;
  batchId?: string;
  isFavorite: boolean;
  favoriteSyncStatus: FavoriteSyncStatus;
}

export interface LibraryState {
  images: LibraryImage[];
  isLoaded: boolean;
  hasMore: boolean;
  loadedCount: number;
}

// ---------------------------------------------------------------------------
// Canonical library ordering — single source of truth.
//
// Every code path that produces an ordered list of library images MUST funnel
// through sortLibraryImages() so the grid, favorites filter, and cloud-favorite
// downloads all agree, and ties are stable (no flicker on refresh).
// ---------------------------------------------------------------------------

function effectiveLibraryTimestamp(image: LibraryImage): number {
  const metadataCompletedAt = image.metadata?.completedAt;
  const completedAt =
    typeof metadataCompletedAt === 'number' ? metadataCompletedAt : image.completedAt;
  return isProcessingStatus(image.status) || image.status === 'paused'
    ? image.createdAt
    : completedAt ?? image.createdAt;
}

// Two tiles belong to the same generation grid when they share a parent
// generation (Inspire crops carry metadata.sourceLibraryId) or a batch id.
function sameGeneratedGrid(a: LibraryImage, b: LibraryImage): boolean {
  const aParent = a.metadata?.parentJobId ?? a.metadata?.sourceLibraryId;
  const bParent = b.metadata?.parentJobId ?? b.metadata?.sourceLibraryId;
  if (aParent && aParent === bParent) return true;
  const aBatch = a.batchId ?? a.metadata?.batchId;
  const bBatch = b.batchId ?? b.metadata?.batchId;
  return !!aBatch && aBatch === bBatch;
}

// Position of a tile inside its generation grid (Inspire crops use gridIndex).
function gridIndex(image: LibraryImage): number | undefined {
  const index = image.metadata?.cropIndex ?? image.metadata?.gridIndex;
  return typeof index === 'number' ? index : undefined;
}

export function compareLibraryImages(a: LibraryImage, b: LibraryImage): number {
  // 1. Active (processing/paused) jobs pinned to top
  const aActive = isProcessingStatus(a.status) || a.status === 'paused';
  const bActive = isProcessingStatus(b.status) || b.status === 'paused';
  if (aActive !== bActive) return aActive ? -1 : 1;

  // 2. Tiles from the same generation grid: order by crop/grid index
  const aGridIndex = gridIndex(a);
  const bGridIndex = gridIndex(b);
  if (
    sameGeneratedGrid(a, b) &&
    aGridIndex !== undefined &&
    bGridIndex !== undefined &&
    aGridIndex !== bGridIndex
  ) {
    return aGridIndex - bGridIndex;
  }

  // 3. Newest effective timestamp first, then stable tiebreakers
  const timestampDelta = effectiveLibraryTimestamp(b) - effectiveLibraryTimestamp(a);
  if (timestampDelta !== 0) return timestampDelta;
  const createdDelta = b.createdAt - a.createdAt;
  if (createdDelta !== 0) return createdDelta;
  return a.id.localeCompare(b.id);
}

// Stable sort (preserves original index on ties).
export function sortLibraryImages(images: LibraryImage[]): LibraryImage[] {
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => compareLibraryImages(a.image, b.image) || a.index - b.index)
    .map(({ image }) => image);
}

type StateChangeListener = (state: LibraryState) => void;

const PAGE_SIZE = 60;
const TEMP_IMAGE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - check Replicate directly if stuck this long

// Client-side download watchdog: a server-completed job can wedge in the local
// "downloading" phase (hung/failed CDN download). The download itself now times
// out (imageDownloader), but a permanently-failing result URL would otherwise
// re-trigger forever. Cap the retries, then surface a failed/retry state.
const MAX_DOWNLOAD_ATTEMPTS = 4;

// Queue jobs whose library tile the user deleted. Without these tombstones,
// orphan adoption would resurrect a deleted tile on every refresh for 24h
// (the generation_queue row outlives the local library row).
const DELETED_QUEUE_JOBS_KEY = '@library_deleted_queue_jobs';
const TOMBSTONE_MAX_AGE_MS = 2 * ONE_DAY_MS;

// Don't adopt jobs younger than this — the queueJobId stamp for a
// just-started generation may still be in flight on its placeholder.
const ADOPTION_GRACE_MS = 2 * 60 * 1000;

const FAVORITES_BUCKET = 'library-favorites';
const FAVORITES_SYNC_MAX_DIMENSION = 1536;

async function optimizeFavoriteImage(localUri: string): Promise<string> {
  const info = await ImageManipulator.manipulateAsync(localUri, [], {});
  const actions: ImageManipulator.Action[] = [];
  if (info.width > FAVORITES_SYNC_MAX_DIMENSION || info.height > FAVORITES_SYNC_MAX_DIMENSION) {
    if (info.width >= info.height) {
      actions.push({ resize: { width: FAVORITES_SYNC_MAX_DIMENSION } });
    } else {
      actions.push({ resize: { height: FAVORITES_SYNC_MAX_DIMENSION } });
    }
  }
  const result = await ImageManipulator.manipulateAsync(localUri, actions, {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return result.base64!;
}

/**
 * Singleton state manager for library
 */
export class LibraryStateManager {
  private static instance: LibraryStateManager;

  private state: LibraryState = {
    images: [],
    isLoaded: false,
    hasMore: true,
    loadedCount: 0,
  };

  private listeners: Set<StateChangeListener> = new Set();
  private queueUnsubscribe: (() => void) | null = null;
  private isInitialized = false;
  private isInitializing = false;

  // Track pending SQLite updates to prevent duplicates
  private pendingUpdates = new Map<string, number>();

  // Debounced writes waiting for their trailing flush (never dropped)
  private deferredPersists = new Map<string, {
    updates: Partial<LibraryImage>;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // Track active jobs (jobId -> libraryId mapping)
  private activeJobs = new Map<string, string>();

  // Bounded-retry counter for the download watchdog (jobId -> attempts).
  private downloadAttempts = new Map<string, number>();

  // Track temp ID to real DB ID mapping
  private idMapping = new Map<string, string>();

  // Track temp IDs currently being saved to SQLite (prevents race condition duplicates)
  private savingInProgress = new Set<string>();

  // Prevent concurrent cloud favorites downloads
  private isDownloadingCloudFavorites = false;

  // Tombstones for queue jobs whose tiles were deleted (jobId -> deletedAt)
  private deletedQueueJobs: Map<string, number> | null = null;

  // Prevent concurrent orphan-adoption passes + throttle SQLite scans
  private isAdoptingOrphans = false;
  private lastAdoptionScanAt = 0;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): LibraryStateManager {
    if (!LibraryStateManager.instance) {
      LibraryStateManager.instance = new LibraryStateManager();
    }
    return LibraryStateManager.instance;
  }

  /**
   * Initialize the state manager
   * - Loads from SQLite
   * - Subscribes to QueueManager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('📚 LibraryStateManager: Already initialized');
      return;
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return;
    }

    this.isInitializing = true;
    const startTime = Date.now();

    try {
      console.log('📚 LibraryStateManager: Initializing...');

      // Initialize dependencies
      await imageManager.initialize();
      await queueManager.initialize();

      // Load initial data from SQLite
      await this.loadInitialImages();

      // Subscribe to queue manager for real-time updates
      this.subscribeToQueue();

      // Let QueueManager's polling keep running while any library tile is
      // still processing — even when its own job map has no active entries
      // (covers jobs whose Realtime INSERT event was missed).
      queueManager.setActivityProbe(() =>
        this.state.images.some(img => isProcessingStatus(img.status))
      );

      this.isInitialized = true;
      const duration = Date.now() - startTime;
      console.log(`✅ LibraryStateManager: Initialized in ${duration}ms`);

      // One-time repair: an earlier adoption build (2026-07-05) surfaced
      // internal utility jobs (soul-creation background removal) as library
      // tiles. Remove them; deleteImage tombstones the job so it can't come
      // back. Safe to drop this sweep after a few releases.
      this.purgeAdoptedUtilityTiles().catch(() => {});
    } catch (error) {
      console.error('❌ LibraryStateManager: Initialization failed:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Load initial images from SQLite
   */
  private async loadInitialImages(): Promise<void> {
    try {
      const records = await imageManager.getImagesByType('library', {
        limit: PAGE_SIZE,
        offset: 0,
      });

      const libraryImages = await Promise.all(
        records.map(r => this.mapRecordToLibraryImage(r))
      );

      // Reconcile with queue state
      const reconciledImages = await this.reconcileWithQueue(libraryImages);

      this.state = {
        images: reconciledImages,
        isLoaded: true,
        hasMore: libraryImages.length === PAGE_SIZE,
        loadedCount: libraryImages.length,
      };

      console.log(`📚 LibraryStateManager: Loaded ${libraryImages.length} images from SQLite`);

      // Notify listeners
      this.notifyListeners();
    } catch (error) {
      console.error('❌ LibraryStateManager: Failed to load initial images:', error);
      throw error;
    }
  }

  /**
   * Reconcile library images with queue state
   * This ensures processing jobs show correct status from QueueManager
   */
  private async reconcileWithQueue(images: LibraryImage[]): Promise<LibraryImage[]> {
    const now = Date.now();
    const allJobs = queueManager.getAllJobs();
    const jobsMap = new Map(allJobs.map(job => [job.id, job]));

    // Jobs already claimed by some image (persisted or in-memory) — the
    // proximity re-link below must never steal these.
    const claimedJobIds = new Set<string>();
    for (const list of [images, this.state.images]) {
      for (const claimant of list) {
        const qid = claimant.queueJobId || claimant.metadata?.queueJobId;
        if (qid) claimedJobIds.add(qid);
      }
    }

    const reconciled = images.map(original => {
      let img = original;

      // Skip if not a processing job
      if (!isProcessingStatus(img.status)) {
        return img;
      }

      // Get queueJobId from various possible locations
      let queueJobId = img.queueJobId || img.metadata?.queueJobId;
      const replicateId = img.predictionId || img.metadata?.predictionId || img.metadata?.replicateId;

      if (!queueJobId && !replicateId) {
        // Last-ditch re-link before failing: the queueJobId stamp can be
        // lost (app suspended mid-start, dropped write). Match an unclaimed
        // queue job by model + prompt + creation-time proximity.
        const relinked = allJobs.find(j =>
          !claimedJobIds.has(j.id) &&
          !j.parameters?._serverCrop &&
          j.model === (img.modelId || img.metadata?.modelId) &&
          (j.prompt || '') === (img.prompt || '') &&
          Math.abs(j.createdAt.getTime() - img.createdAt) < 2 * 60 * 1000
        );

        if (relinked) {
          console.log(`🔗 LibraryStateManager: Re-linked ${img.id} → job ${relinked.id.substring(0, 8)} by proximity`);
          claimedJobIds.add(relinked.id);
          queueJobId = relinked.id;
          this.activeJobs.set(relinked.id, img.id);
          img = { ...img, queueJobId: relinked.id, metadata: { ...img.metadata, queueJobId: relinked.id } };
          this.persistToSQLite(img.id, { metadata: { queueJobId: relinked.id } });
        } else {
          // Mark orphaned processing jobs as failed after 5 minutes
          const jobAge = now - img.createdAt;
          if (jobAge > 5 * 60 * 1000) {
            imageManager.updateImage(img.id, {
              metadata: { ...img.metadata, status: 'failed', error: 'Job lost tracking information. Please retry.' },
            }).catch(() => {});
            return { ...img, status: 'failed' as const, error: 'Job lost tracking information. Please retry.' };
          }
          return img;
        }
      }

      // Try to find job by queueJobId first
      let job = queueJobId ? jobsMap.get(queueJobId) : null;

      // Fallback: try to match by replicateId
      if (!job && replicateId) {
        job = allJobs.find(j => j.replicateId === replicateId) || null;
        if (job) this.activeJobs.set(job.id, img.id);
      }

      // Track this job
      if (queueJobId && job) {
        this.activeJobs.set(queueJobId, img.id);
      }

      // Job not in queue - check age
      if (!job) {
        const ageMs = now - img.createdAt;
        if (ageMs > ONE_DAY_MS) {
          return { ...img, status: 'failed' as const, error: 'Generation expired (>24h). Please retry.' };
        }
        return img;
      }

      // If job completed but needs download, trigger it
      if (job.status === 'completed' && job.resultUrl && !job.localUri && !job.isDownloading) {
        if (img.transformedImageUrl) {
          // Use actual completion time from queue, not current time
          const actualCompletedAt = job.completedAt?.getTime() || img.completedAt || Date.now();
          const durationSec = img.metadata?.generationDurationSec ?? ((actualCompletedAt - img.createdAt) / 1000);
          return { ...img, status: 'completed' as const, completedAt: actualCompletedAt, metadata: { ...img.metadata, generationDurationSec: durationSec > 0 && durationSec < 3600 ? parseFloat(durationSec.toFixed(1)) : undefined } };
        }
        // Download watchdog: cap retries so a permanently-failing result URL
        // doesn't spin on "Saving to library" forever. After the cap, mark the
        // item failed with a retry hint instead of leaving it stuck.
        const attempts = this.downloadAttempts.get(job.id) || 0;
        if (attempts >= MAX_DOWNLOAD_ATTEMPTS) {
          console.warn(`⛔ LibraryStateManager: Download for job ${job.id.substring(0, 8)} failed ${attempts}× — marking failed`);
          this.downloadAttempts.delete(job.id);
          imageManager.updateImage(img.id, {
            metadata: { ...img.metadata, status: 'failed', error: 'Could not save the result. Please retry.' },
          }).catch(() => {});
          return { ...img, status: 'failed' as const, error: 'Could not save the result. Please retry.' };
        }
        this.downloadAttempts.set(job.id, attempts + 1);
        // Use job.id (not queueJobId) since job might have been found via replicateId fallback
        queueManager.downloadJobResult(job.id).catch(() => {});
        return { ...img, status: 'downloading' as const };
      }

      // Update based on queue status
      if (job.status === 'completed' && job.localUri && !job.isDownloading) {
        // Download succeeded — clear the watchdog counter.
        this.downloadAttempts.delete(job.id);
        // Use actual completion time from queue, not current time
        const actualCompletedAt = job.completedAt?.getTime() || img.completedAt || Date.now();
        const durationSec = img.metadata?.generationDurationSec ?? ((actualCompletedAt - img.createdAt) / 1000);
        return {
          ...img,
          status: 'completed' as const,
          transformedImageUrl: job.localUri,
          completedAt: actualCompletedAt,
          metadata: { ...img.metadata, resultUrl: job.resultUrl, generationDurationSec: durationSec > 0 && durationSec < 3600 ? parseFloat(durationSec.toFixed(1)) : undefined },
        };
      }

      if (job.status === 'completed' && job.isDownloading) {
        return { ...img, status: 'downloading' as const };
      }

      if (job.status === 'failed') {
        return { ...img, status: 'failed' as const, error: job.errorMessage || 'Generation failed' };
      }

      // Check if job is stuck (processing too long)
      const jobAge = Date.now() - img.createdAt;
      if (job.id && jobAge > STUCK_JOB_THRESHOLD_MS && jobAge < ONE_DAY_MS) {
        this.checkStuckJob(job.id).catch(() => {});
      }

      return img;
    });

    return reconciled;
  }

  /**
   * Check status of a stuck job directly from Replicate
   * Called when webhooks fail and job is stuck in "processing" for too long
   */
  private async checkStuckJob(jobId: string): Promise<void> {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) return;

      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/check-prediction-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ jobId }),
      });

      if (!response.ok) {
        console.error(`❌ checkStuckJob ${jobId.substring(0, 8)}: ${await response.text()}`);
        return;
      }

      // If job was updated, Realtime subscription will pick it up
    } catch (error) {
      console.error(`❌ checkStuckJob ${jobId.substring(0, 8)}:`, error);
    }
  }

  /**
   * Load (and prune) tombstones of queue jobs whose tiles were deleted.
   */
  private async loadTombstones(): Promise<Map<string, number>> {
    if (this.deletedQueueJobs) return this.deletedQueueJobs;
    const tombstones = new Map<string, number>();
    try {
      const raw = await AsyncStorage.getItem(DELETED_QUEUE_JOBS_KEY);
      if (raw) {
        const parsed: Record<string, number> = JSON.parse(raw);
        const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
        for (const [jobId, deletedAt] of Object.entries(parsed)) {
          if (typeof deletedAt === 'number' && deletedAt > cutoff) {
            tombstones.set(jobId, deletedAt);
          }
        }
      }
    } catch (error) {
      console.error('❌ LibraryStateManager: Failed to load job tombstones:', error);
    }
    this.deletedQueueJobs = tombstones;
    return tombstones;
  }

  private persistTombstones(): void {
    if (!this.deletedQueueJobs) return;
    const obj: Record<string, number> = {};
    this.deletedQueueJobs.forEach((deletedAt, jobId) => {
      obj[jobId] = deletedAt;
    });
    AsyncStorage.setItem(DELETED_QUEUE_JOBS_KEY, JSON.stringify(obj)).catch(error => {
      console.error('❌ LibraryStateManager: Failed to persist job tombstones:', error);
    });
  }

  /**
   * Mark a queue job as "its tile was deleted by the user" so orphan
   * adoption never resurrects it.
   */
  private tombstoneQueueJob(jobId: string | undefined | null): void {
    if (!jobId) return;
    this.loadTombstones()
      .then(tombstones => {
        tombstones.set(jobId, Date.now());
        this.persistTombstones();
      })
      .catch(() => {});
    queueManager.removeJob(jobId);
  }

  /**
   * Remove library tiles that were wrongly adopted from internal utility
   * jobs (background-remover soul/onboarding preprocessing). Identified by
   * the adoption stamp + utility model — real user generations never match.
   */
  private async purgeAdoptedUtilityTiles(): Promise<void> {
    const isLeaked = (model: string | undefined, metadata: any) =>
      metadata?.adoptedFromQueue === true &&
      typeof (metadata?.model || model) === 'string' &&
      String(metadata?.model || model).startsWith('background-remover');

    // In-memory placeholders (processing adoptions never reach SQLite)
    const leakedInMemory = this.state.images.filter(img => isLeaked(img.model, img.metadata));

    // Persisted tiles (completed adoptions)
    const allRecords = await imageManager.getAllImages();
    const leakedRecords = allRecords.filter(rec => isLeaked(rec.category, rec.metadata));

    const ids = new Set<string>([
      ...leakedInMemory.map(img => img.id),
      ...leakedRecords.map(rec => rec.id),
    ]);
    if (ids.size === 0) return;

    console.log(`🧹 LibraryStateManager: Purging ${ids.size} wrongly-adopted utility tile(s)`);
    for (const id of ids) {
      await this.deleteImage(id).catch(() => {});
    }
  }

  /**
   * Adopt orphaned queue jobs — generation_queue rows that no library image
   * claims. This is the durable recovery path: placeholders can be lost to
   * process kills (text-to-image tiles live only in memory until completion)
   * or to a queueJobId stamp that never landed. The server-side job row
   * always survives, so we rebuild the tile from it.
   */
  private async adoptOrphanedJobs(force: boolean = false): Promise<void> {
    if (this.isAdoptingOrphans) return;
    this.isAdoptingOrphans = true;
    try {
      const jobs = queueManager.getAllJobs();
      if (jobs.length === 0) return;

      const now = Date.now();

      // Fast known-set from in-memory state + live job tracking
      const knownJobIds = new Set<string>();
      for (const img of this.state.images) {
        const qid = img.queueJobId || img.metadata?.queueJobId;
        if (qid) knownJobIds.add(qid);
        const parent = img.metadata?.parentJobId;
        if (parent) knownJobIds.add(parent);
      }

      const candidates = jobs.filter(job => {
        if (knownJobIds.has(job.id)) return false;
        // Opt-in: only jobs stamped by the library generation flows are
        // eligible. Internal features (soul-creation background removal,
        // onboarding preprocessing) run queue jobs with no library tile and
        // must never surface here.
        if (job.parameters?._source !== 'library') return false;
        // Belt-and-braces: utility models are never library tiles
        if (job.model?.startsWith('background-remover')) return false;
        // Failed jobs have no tile to recover; coins are refunded server-side
        if (job.status === 'failed') return false;
        // Copy Shot server-crop jobs fan out into child tiles via parentJobId
        // and have their own recovery flow (handleServerCropJob)
        if (job.parameters?._serverCrop) return false;
        const ageMs = now - job.createdAt.getTime();
        if (ageMs < ADOPTION_GRACE_MS) return false; // stamp may still be in flight
        if (ageMs > ONE_DAY_MS) return false;
        return true;
      });
      if (candidates.length === 0) return;

      // Throttle the slow path — a completed job whose tile lives beyond the
      // loaded page would otherwise trigger a full SQLite scan on every
      // queue notification.
      if (!force && now - this.lastAdoptionScanAt < 30 * 1000) return;
      this.lastAdoptionScanAt = now;

      // Slow known-set (only when there are candidates): full SQLite scan
      // covers rows beyond the loaded page; tombstones cover deleted tiles.
      const [allRecords, tombstones] = await Promise.all([
        imageManager.getAllImages(),
        this.loadTombstones(),
      ]);
      const recordStatusByJobId = new Map<string, string | undefined>();
      for (const rec of allRecords) {
        const qid = rec.metadata?.queueJobId;
        if (qid) {
          knownJobIds.add(qid);
          recordStatusByJobId.set(qid, rec.metadata?.status);
        }
        const parent = rec.metadata?.parentJobId;
        if (parent) knownJobIds.add(parent);
      }

      const orphans: QueueJob[] = [];
      for (const job of candidates) {
        if (tombstones.has(job.id)) continue;
        if (knownJobIds.has(job.id)) {
          // Claimed by a SQLite row we just discovered. If that row is
          // already terminal, the job is fully consumed — drop it from the
          // queue map so it stops looking like an adoption candidate.
          const recStatus = recordStatusByJobId.get(job.id);
          if (recStatus === 'completed' || recStatus === 'failed') {
            queueManager.removeJob(job.id);
          }
          continue;
        }
        orphans.push(job);
      }
      if (orphans.length === 0) return;

      console.log(`🩹 LibraryStateManager: Adopting ${orphans.length} orphaned queue job(s)`);

      for (const job of orphans) {
        try {
          await this.adoptJob(job);
        } catch (error) {
          console.error(`❌ LibraryStateManager: Failed to adopt job ${job.id.substring(0, 8)}:`, error);
        }
      }

      this.notifyListeners();
    } finally {
      this.isAdoptingOrphans = false;
    }
  }

  /**
   * Create a library image for a queue job that lost its local placeholder.
   */
  private async adoptJob(job: QueueJob): Promise<void> {
    // Copy Shot ("Inspire") prompts are top-secret and must never be persisted
    // on-device. Orphan-adopted jobs lose their metadata markers, so detect by
    // model and (a) blank the prompt, (b) stamp a hidden marker so the detail
    // modal's secrecy gate still catches the item. This is the exact path that
    // previously leaked a secret prompt into the UI.
    const isCopyShot = job.model === 'Inspire' || job.model === 'gpt-image-2-fal';
    const safePrompt = isCopyShot ? '' : job.prompt;

    const baseMetadata = {
      cloudQueue: true,
      queueJobId: job.id,
      replicateId: job.replicateId || undefined,
      modelId: job.model,
      model: job.model,
      prompt: safePrompt,
      startedAt: job.createdAt.getTime(),
      adoptedFromQueue: true,
      ...(isCopyShot ? { fromImagine: true } : {}),
    };

    if (job.status === 'completed' && job.localUri) {
      // Result already downloaded — create the SQLite row directly
      const completedAt = job.completedAt?.getTime() || job.updatedAt.getTime();
      const dbRecord = await imageManager.saveImage({
        localUri: job.localUri,
        type: 'library',
        category: job.model,
        metadata: {
          ...baseMetadata,
          status: 'completed',
          completedAt,
          resultUrl: job.resultUrl,
        },
        prefetch: false,
      });
      const image = await this.mapRecordToLibraryImage(dbRecord);
      this.state = {
        ...this.state,
        images: [image, ...this.state.images],
        loadedCount: this.state.loadedCount + 1,
      };
      this.activeJobs.set(job.id, dbRecord.id);
      queueManager.removeJob(job.id);
      console.log(`🩹 LibraryStateManager: Adopted completed job ${job.id.substring(0, 8)} → ${dbRecord.id}`);
      return;
    }

    // Pending/processing, or completed but not yet downloaded — recreate an
    // in-memory placeholder; the normal subscribe/reconcile flow finishes it
    // (and persistToSQLite creates the row once the result lands).
    const tempId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const placeholder: LibraryImage = {
      id: tempId,
      originalImageUri: '',
      transformedImageUrl: null,
      prompt: safePrompt,
      model: job.model,
      modelId: job.model,
      status: 'processing',
      createdAt: job.createdAt.getTime(),
      queueJobId: job.id,
      metadata: { ...baseMetadata, status: 'processing' },
      isFavorite: false,
      favoriteSyncStatus: 'none',
    };
    this.state = {
      ...this.state,
      images: [placeholder, ...this.state.images],
      loadedCount: this.state.loadedCount + 1,
    };
    this.activeJobs.set(job.id, tempId);
    console.log(`🩹 LibraryStateManager: Adopted in-flight job ${job.id.substring(0, 8)} → ${tempId} (${job.status})`);

    if (job.status === 'completed' && job.resultUrl && !job.localUri && !job.isDownloading) {
      queueManager.downloadJobResult(job.id).catch(() => {});
    }
  }

  /**
   * Subscribe to QueueManager for real-time updates
   */
  private subscribeToQueue(): void {
    if (this.queueUnsubscribe) {
      return; // Already subscribed
    }

    this.queueUnsubscribe = queueManager.subscribe(async (jobs) => {
      // Process completed or failed jobs
      for (const job of jobs) {
        // Skip non-terminal states
        if (job.status !== 'completed' && job.status !== 'failed') {
          continue;
        }

        // Try to find matching library image (by jobId or replicateId)
        const libraryId = this.activeJobs.get(job.id) || this.findLibraryIdByJobId(job.id, job.replicateId);

        if (!libraryId) {
          // Don't evict — useCloudQueueGeneration's subscriber may still resolve
          // this job once its queueJobId stamp lands on the placeholder (race
          // that stranded Inspire's 2nd tile on 'uploading').
          continue;
        }

        // Track this job
        this.activeJobs.set(job.id, libraryId);

        // Handle completed jobs
        if (job.status === 'completed' && job.localUri && !job.isDownloading) {
          // Use actual completion time from queue, not current time
          const img = this.state.images.find(i => i.id === libraryId);
          const actualCompletedAt = job.completedAt?.getTime() || img?.completedAt || Date.now();
          const durationSec = img?.metadata?.generationDurationSec ?? ((actualCompletedAt - (img?.createdAt || actualCompletedAt)) / 1000);
          await this.updateImageInState(libraryId, {
            status: 'completed',
            transformedImageUrl: job.localUri,
            completedAt: actualCompletedAt,
            metadata: {
              resultUrl: job.resultUrl, // Save Replicate URL for potential re-download
              generationDurationSec: durationSec > 0 && durationSec < 3600 ? parseFloat(durationSec.toFixed(1)) : undefined,
            },
          });

          // Remove from active jobs AND from queue (cleanup)
          this.activeJobs.delete(job.id);
          queueManager.removeJob(job.id);
        }

        // Handle downloading state
        if (job.status === 'completed' && job.isDownloading) {
          await this.updateImageInState(libraryId, {
            status: 'downloading',
          });
        }

        // Handle failed jobs
        if (job.status === 'failed') {
          await this.updateImageInState(libraryId, {
            status: 'failed',
            error: job.errorMessage || 'Generation failed',
          });

          // Remove from active jobs AND from queue (cleanup)
          this.activeJobs.delete(job.id);
          queueManager.removeJob(job.id);
        }
      }

      // Recover any job no library image claims (placeholder lost to a
      // process kill or a queueJobId stamp that never landed). Cheap when
      // there are no candidates; SQLite scans are throttled internally.
      this.adoptOrphanedJobs().catch(() => {});
    });
  }

  /**
   * Find library ID by queue job ID or replicate ID
   * Searches both queueJobId and predictionId/replicateId fields
   */
  private findLibraryIdByJobId(jobId: string, replicateId?: string | null): string | null {
    const match = this.state.images.find(img => {
      // Check by queueJobId
      if (img.queueJobId === jobId || img.metadata?.queueJobId === jobId) {
        return true;
      }
      // Also check by replicateId if provided
      if (replicateId) {
        const imgReplicateId = img.predictionId || img.metadata?.predictionId || img.metadata?.replicateId;
        if (imgReplicateId === replicateId) {
          return true;
        }
      }
      return false;
    });
    return match?.id || null;
  }

  /**
   * Update image in state (in-memory)
   * Also triggers async SQLite update
   */
  private async updateImageInState(id: string, updates: Partial<LibraryImage>): Promise<void> {
    // CRITICAL: Resolve temp ID to real DB ID if mapping exists
    const realId = this.idMapping.get(id) || id;
    if (realId !== id) {
      console.log(`🔄 LibraryStateManager.updateImageInState: Resolving temp ID ${id} → real ID ${realId}`);
    }

    // Find existing image
    const existingImage = this.state.images.find(img => img.id === realId);
    if (!existingImage) {
      return; // Image not found
    }

    // Skip redundant updates - don't update if already in same terminal state
    if (existingImage.status === 'completed' && updates.status === 'completed' &&
        existingImage.transformedImageUrl && !updates.transformedImageUrl) {
      return; // Already completed with URL, skip
    }

    // CRITICAL: Track queueJobId mapping when it's added via update
    const queueJobId = updates.queueJobId || updates.metadata?.queueJobId;
    if (queueJobId && !this.activeJobs.has(queueJobId)) {
      console.log(`🔗 LibraryStateManager: Tracking queueJobId ${queueJobId} → ${realId}`);
      this.activeJobs.set(queueJobId, realId);
    }

    // Update in-memory state immediately
    const updatedImages = this.state.images.map(img => {
      if (img.id !== realId) return img;

      console.log(`✏️ LibraryStateManager.updateImageInState: Updating image ${realId} with:`, {
        status: updates.status,
        hasTransformedUrl: !!updates.transformedImageUrl,
        hasQueueJobId: !!updates.metadata?.queueJobId,
      });

      // Clean up ID mapping if image is now completed or failed (no longer needs updates)
      if (updates.status === 'completed' || updates.status === 'failed') {
        if (realId !== id) {
          console.log(`🧹 LibraryStateManager: Cleaning up temp ID mapping for ${id}`);
          this.idMapping.delete(id);
        }
      }

      return {
        ...img,
        ...updates,
        metadata: {
          ...img.metadata,
          ...updates.metadata,
        },
      };
    });

    this.state = {
      ...this.state,
      images: updatedImages,
    };

    // Notify listeners immediately (fast UI update)
    this.notifyListeners();

    // Persist to SQLite in background (async) - use real ID
    this.persistToSQLite(realId, updates);
  }

  /**
   * Persist updates to SQLite (async, fire-and-forget)
   */
  private persistToSQLite(id: string, updates: Partial<LibraryImage>): void {
    // Debounce: Only write if at least 100ms has passed since last write.
    // Bursts are DEFERRED into a merged trailing write, never dropped — a
    // dropped write can permanently lose metadata like queueJobId, which is
    // the link that lets a processing tile ever complete.
    const now = Date.now();
    const lastUpdate = this.pendingUpdates.get(id) || 0;

    if (now - lastUpdate < 100) {
      const existing = this.deferredPersists.get(id);
      const prev = existing?.updates;
      const mergedMetadata = prev?.metadata || updates.metadata
        ? { ...prev?.metadata, ...updates.metadata }
        : undefined;
      const merged: Partial<LibraryImage> = { ...prev, ...updates };
      if (mergedMetadata) merged.metadata = mergedMetadata;
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        this.deferredPersists.delete(id);
        this.persistToSQLite(id, merged);
      }, 150);
      this.deferredPersists.set(id, { updates: merged, timer });
      return;
    }

    this.pendingUpdates.set(id, now);

    // Async update (don't await)
    (async () => {
      try {
        // Fetch existing record to preserve all metadata
        const existingRecord = await imageManager.getImage(id);

        // CRITICAL FIX: If record doesn't exist (e.g., text-to-image job skipped initial save),
        // create it now instead of updating - BUT only if we have the final image
        if (!existingRecord) {
          // Check if this temp ID already has a mapping (another save completed)
          if (this.idMapping.has(id)) {
            console.log(`⏭️ LibraryStateManager: Record already created for ${id}, skipping duplicate`);
            return;
          }

          // Check if a save is already in progress for this ID (race condition prevention)
          if (this.savingInProgress.has(id)) {
            console.log(`⏭️ LibraryStateManager: Save already in progress for ${id}, skipping duplicate`);
            return;
          }

          // Find the in-memory image to get all its data
          const inMemoryImage = this.state.images.find(img => img.id === id);
          if (!inMemoryImage) {
            console.warn(`⚠️ LibraryStateManager: Cannot persist - image ${id} not found in memory`);
            return;
          }

          // Get the final image URL
          const finalImageUrl = updates.transformedImageUrl || inMemoryImage.transformedImageUrl;

          // Only create record if we have an actual image URL (skip for intermediate states like 'downloading')
          if (!finalImageUrl) {
            console.log(`⏭️ LibraryStateManager: Skipping DB create for ${id} - no image URL yet (status: ${updates.status})`);
            return;
          }

          // Mark as in-progress to prevent race condition duplicates
          this.savingInProgress.add(id);

          try {
            // Create new record
            const dbRecord = await imageManager.saveImage({
              localUri: finalImageUrl,
              type: 'library',
              category: inMemoryImage.model,
              metadata: {
                ...inMemoryImage.metadata,
                ...updates.metadata,
                prompt: inMemoryImage.prompt,
                model: inMemoryImage.model,
                status: updates.status || inMemoryImage.status,
                originalImageUri: inMemoryImage.originalImageUri,
                inputImages: inMemoryImage.inputImages,
                queueJobId: inMemoryImage.queueJobId,
                completedAt: updates.completedAt,
                error: updates.error,
              },
              prefetch: false,
            });

            // Update state with actual DB ID
            const updatedImages = this.state.images.map(img =>
              img.id === id ? { ...img, id: dbRecord.id } : img
            );
            this.state = { ...this.state, images: updatedImages };
            this.idMapping.set(id, dbRecord.id);
            this.notifyListeners();

            console.log(`💾 LibraryStateManager: Created new SQLite record for ${id} → ${dbRecord.id}`);
          } finally {
            this.savingInProgress.delete(id);
          }
          return;
        }

        const existingMetadata = existingRecord.metadata || {};

        // Build metadata patch. Only write status/error/completedAt when
        // the caller actually provided them — otherwise we'd nuke the
        // persisted status to undefined for callers that only patch e.g.
        // queueJobId, which makes refresh() roll the tile back to "Queued"
        // on tab focus.
        const metadataPatch: Record<string, any> = {
          ...existingMetadata,
          ...updates.metadata,
          fromCommunityRecipe: existingMetadata.fromCommunityRecipe,
          recipeReferenceImageCount: existingMetadata.recipeReferenceImageCount,
          generationDurationSec: updates.metadata?.generationDurationSec ?? existingMetadata.generationDurationSec,
        };
        if (updates.status !== undefined) metadataPatch.status = updates.status;
        if (updates.error !== undefined) metadataPatch.error = updates.error;
        if (updates.completedAt !== undefined) metadataPatch.completedAt = updates.completedAt;

        const updateData: any = { metadata: metadataPatch };

        // Only update localUri if we have a new transformed image URL
        if (updates.transformedImageUrl) {
          updateData.localUri = updates.transformedImageUrl;
        }

        await imageManager.updateImage(id, updateData);

        console.log(`💾 LibraryStateManager: Persisted update to SQLite for ${id}`);
      } catch (error) {
        console.error('❌ LibraryStateManager: Failed to persist to SQLite:', error);
      } finally {
        // Clean up pending updates
        setTimeout(() => {
          this.pendingUpdates.delete(id);
        }, 200);
      }
    })();
  }

  /**
   * Map ImageRecord to LibraryImage
   */
  private async mapRecordToLibraryImage(record: ImageRecord): Promise<LibraryImage> {
    const libraryImage: LibraryImage = {
      id: record.id,
      originalImageUri: record.metadata?.originalImageUri || record.localUri,
      inputImages: record.metadata?.inputImages,
      transformedImageUrl: record.localUri,
      prompt: record.metadata?.prompt || '',
      model: record.metadata?.model || record.category || '',
      status: this.normalizeStatus(record.metadata?.status),
      createdAt: record.createdAt,
      completedAt: record.metadata?.completedAt,
      metadata: record.metadata,
      error: record.metadata?.error,
      predictionId: record.metadata?.predictionId,
      taskId: record.metadata?.taskId,
      api: record.metadata?.api,
      modelId: record.metadata?.modelId,
      options: record.metadata?.options,
      queueJobId: record.metadata?.queueJobId,
      batchId: record.metadata?.batchId,
      isFavorite: record.is_favorite === 1,
      favoriteSyncStatus: record.favorite_synced_at ? 'synced' : (record.is_favorite === 1 ? 'none' : 'none'),
    };

    // Auto-fail old processing jobs (>24h)
    const now = Date.now();
    if (isProcessingStatus(libraryImage.status) && now - libraryImage.createdAt > ONE_DAY_MS) {
      libraryImage.status = 'failed';
      libraryImage.error = 'Generation expired (>24h). Please retry.';
    }

    return libraryImage;
  }

  /**
   * Normalize status string to LibraryImageStatus
   * @param status - The status from metadata
   */
  private normalizeStatus(status?: string | null): LibraryImageStatus {
    if (!status) {
      // BUG FIX: Don't default to 'completed' when status is missing
      // Missing status = likely still waiting for Replicate result
      // reconcileWithQueue will check QueueManager for the real status
      return 'pending';
    }

    const normalized = status.toLowerCase();

    if (normalized === 'download') {
      return 'downloading';
    }

    if (normalized === 'queued') {
      return 'pending';
    }

    if (PROCESSING_STATUS_SET.has(normalized as LibraryImageStatus)) {
      return normalized as LibraryImageStatus;
    }

    if (normalized === 'paused' || normalized === 'completed' || normalized === 'failed') {
      return normalized as LibraryImageStatus;
    }

    // Fallback
    return 'processing';
  }

  /**
   * Get current state
   */
  getState(): LibraryState {
    return this.state;
  }

  /**
   * Get images array
   */
  getImages(): LibraryImage[] {
    return this.state.images;
  }

  /**
   * Add a new image to library
   */
  async addImage(image: Omit<LibraryImage, 'id' | 'createdAt'>): Promise<string> {
    const tempId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newImage: LibraryImage = {
      ...image,
      id: tempId,
      createdAt: Date.now(),
      isFavorite: image.isFavorite ?? false,
      favoriteSyncStatus: image.favoriteSyncStatus ?? 'none',
    };

    // Add to state immediately
    this.state = {
      ...this.state,
      images: [newImage, ...this.state.images],
      loadedCount: this.state.loadedCount + 1,
    };

    // Notify listeners
    this.notifyListeners();

    // Track queue job if present
    if (newImage.queueJobId) {
      this.activeJobs.set(newImage.queueJobId, tempId);
    }

    // Persist to SQLite in background
    (async () => {
      try {
        // Skip database save for processing jobs without originalImageUri
        if (!newImage.originalImageUri && newImage.status === 'processing') {
          console.log('⏭️ LibraryStateManager: Skipping DB save for processing job without originalImageUri:', tempId);
          return;
        }

        // Save to database
        const dbRecord = await imageManager.saveImage({
          localUri: newImage.originalImageUri,
          type: 'library',
          category: newImage.model,
          metadata: {
            ...newImage.metadata,
            prompt: newImage.prompt,
            model: newImage.model,
            status: newImage.status,
            originalImageUri: newImage.originalImageUri,
            inputImages: newImage.inputImages,
            api: newImage.api,
            modelId: newImage.modelId,
            predictionId: newImage.predictionId,
            taskId: newImage.taskId,
            options: newImage.options,
            queueJobId: newImage.queueJobId,
            batchId: newImage.batchId,
            tempLibraryId: tempId,
          },
          prefetch: false,
        });

        // Update state with actual DB ID
        const updatedImages = this.state.images.map(img =>
          img.id === tempId ? { ...img, id: dbRecord.id } : img
        );

        this.state = {
          ...this.state,
          images: updatedImages,
        };

        // CRITICAL: Track the ID mapping so updates using temp ID can find the real ID
        console.log(`📝 LibraryStateManager: Mapping temp ID ${tempId} → real ID ${dbRecord.id}`);
        this.idMapping.set(tempId, dbRecord.id);

        // Update activeJobs mapping if needed
        if (newImage.queueJobId && this.activeJobs.get(newImage.queueJobId) === tempId) {
          this.activeJobs.set(newImage.queueJobId, dbRecord.id);
        }

        // Notify listeners
        this.notifyListeners();

        console.log('✅ LibraryStateManager: Image saved to SQLite:', dbRecord.id);
      } catch (error) {
        console.error('❌ LibraryStateManager: Failed to save to SQLite:', error);
      }
    })();

    return tempId;
  }

  /**
   * Insert an already-completed image (e.g. the onboarding free generation).
   * Unlike addImage — which persists originalImageUri as the record's file
   * and expects the result to arrive later via updateImage — this saves the
   * RESULT file directly, same as adoptJob's completed branch. `localUri`
   * must be a local file URI (imageManager.saveImage copies it to cache;
   * an https:// URL here is what caused the onboarding SQLite save failure).
   */
  async addCompletedImage(params: {
    localUri: string;
    model: string;
    modelId?: string;
    prompt?: string;
    resultUrl?: string;
    inputImages?: string[];
    metadata?: any;
  }): Promise<string> {
    const completedAt = Date.now();
    const dbRecord = await imageManager.saveImage({
      localUri: params.localUri,
      type: 'library',
      category: params.model,
      metadata: {
        ...params.metadata,
        prompt: params.prompt ?? '',
        model: params.model,
        modelId: params.modelId,
        inputImages: params.inputImages,
        status: 'completed',
        completedAt,
        resultUrl: params.resultUrl,
      },
      prefetch: false,
    });
    const image = await this.mapRecordToLibraryImage(dbRecord);
    this.state = {
      ...this.state,
      images: [image, ...this.state.images],
      loadedCount: this.state.loadedCount + 1,
    };
    this.notifyListeners();
    console.log('✅ LibraryStateManager: Completed image saved to SQLite:', dbRecord.id);
    return dbRecord.id;
  }

  /**
   * Update an image
   */
  updateImage(id: string, updates: Partial<LibraryImage>): void {
    this.updateImageInState(id, updates);
  }

  /**
   * Delete an image
   */
  async deleteImage(id: string): Promise<void> {
    // Tombstone the backing queue job so orphan adoption doesn't resurrect
    // the deleted tile from generation_queue on the next refresh.
    const target = this.state.images.find(img => img.id === id);
    if (target) {
      this.tombstoneQueueJob(target.queueJobId || target.metadata?.queueJobId);
    } else {
      imageManager.getImage(id)
        .then(rec => this.tombstoneQueueJob(rec?.metadata?.queueJobId))
        .catch(() => {});
    }

    // Remove from state
    const filteredImages = this.state.images.filter(img => img.id !== id);

    this.state = {
      ...this.state,
      images: filteredImages,
      loadedCount: this.state.loadedCount - 1,
    };

    // Notify listeners
    this.notifyListeners();

    // Delete from SQLite (async)
    imageManager.deleteImage(id, true).catch(error => {
      console.error('❌ LibraryStateManager: Failed to delete from SQLite:', error);
    });
  }

  /**
   * Clear all library images
   */
  async clearLibrary(): Promise<void> {
    // Clear state
    this.state = {
      images: [],
      isLoaded: true,
      hasMore: false,
      loadedCount: 0,
    };

    // Notify listeners
    this.notifyListeners();

    // Clear from SQLite (async)
    (async () => {
      try {
        const allImages = await imageManager.getImagesByType('library');
        for (const img of allImages) {
          // Tombstone so orphan adoption doesn't resurrect cleared tiles
          this.tombstoneQueueJob(img.metadata?.queueJobId);
          await imageManager.deleteImage(img.id, true);
        }
      } catch (error) {
        console.error('❌ LibraryStateManager: Failed to clear SQLite:', error);
      }
    })();
  }

  /**
   * Refresh library
   * Reloads from SQLite and reconciles with queue
   *
   * @param forceReloadQueue - If true, reloads queue jobs from Supabase (fixes stuck Realtime)
   */
  async refresh(forceReloadQueue: boolean = false): Promise<void> {
    try {
      // Force reload queue jobs from database if Realtime is stuck
      if (forceReloadQueue) {
        await queueManager.forceReloadJobs();
      }

      // Load from SQLite
      const records = await imageManager.getImagesByType('library', {
        limit: PAGE_SIZE,
        offset: 0,
      });

      const libraryImages = await Promise.all(
        records.map(r => this.mapRecordToLibraryImage(r))
      );

      const inMemoryById = new Map(this.state.images.map(img => [img.id, img]));

      // Carry the queue link forward when the disk row lost it (the
      // queueJobId write can race the initial save). Must happen BEFORE
      // reconcileWithQueue, which force-fails unlinked processing rows.
      const linkedImages = libraryImages.map(loaded => {
        const memCopy = inMemoryById.get(loaded.id);
        if (!memCopy) return loaded;
        const memQid = memCopy.queueJobId || memCopy.metadata?.queueJobId;
        const loadedQid = loaded.queueJobId || loaded.metadata?.queueJobId;
        if (!memQid || loadedQid) return loaded;
        // Repair the persisted row too so the link survives the session
        this.persistToSQLite(loaded.id, { metadata: { queueJobId: memQid } });
        return {
          ...loaded,
          queueJobId: memQid,
          metadata: { ...loaded.metadata, queueJobId: memQid },
        };
      });

      // Reconcile with queue state
      const reconciledImages = await this.reconcileWithQueue(linkedImages);

      // Preserve in-memory transient status when SQLite has rolled back.
      // Status progression is monotonic within a session — never let a
      // tile visually regress (e.g. processing → pending) because the
      // SQLite row lagged in-memory state.
      const statusPreserved = reconciledImages.map(loaded => {
        const memCopy = inMemoryById.get(loaded.id);
        if (!memCopy) return loaded;
        // Terminal states from reconcile always win
        if (loaded.status === 'completed' || loaded.status === 'failed') return loaded;
        const memRank = STATUS_RANK[memCopy.status] ?? 0;
        const diskRank = STATUS_RANK[loaded.status] ?? 0;
        if (memRank > diskRank && isProcessingStatus(memCopy.status)) {
          return { ...loaded, status: memCopy.status, error: memCopy.error };
        }
        return loaded;
      });

      // Merge with any in-memory processing jobs that aren't in SQLite yet.
      // A placeholder whose queue job is still live is NEVER dropped — it's
      // the only thing linking that job's eventual result to a tile.
      const now = Date.now();
      const inMemoryProcessing = this.state.images.filter(img => {
        if (!isProcessingStatus(img.status) && img.status !== 'paused') return false;
        if (statusPreserved.some(loaded => loaded.id === img.id)) return false;
        const qid = img.queueJobId || img.metadata?.queueJobId;
        if (qid && queueManager.getJob(qid)) return true;
        return now - img.createdAt <= TEMP_IMAGE_MAX_AGE_MS;
      });

      const merged = [...inMemoryProcessing, ...statusPreserved];

      this.state = {
        ...this.state,
        images: merged,
        isLoaded: true,
        hasMore: libraryImages.length === PAGE_SIZE,
        loadedCount: libraryImages.length,
      };

      this.notifyListeners();

      // Recover queue jobs no library image claims (lost placeholders)
      await this.adoptOrphanedJobs(true);

      // Fire-and-forget: download cloud favorites from other devices
      this.downloadCloudFavorites().catch(error => {
        console.error('❌ LibraryStateManager: Cloud favorites download failed:', error);
      });
    } catch (error) {
      console.error('❌ LibraryStateManager.refresh:', error);
      throw error;
    }
  }

  /**
   * Load more images (pagination)
   */
  async loadMore(): Promise<void> {
    if (!this.state.hasMore) {
      return;
    }

    try {
      const records = await imageManager.getImagesByType('library', {
        limit: PAGE_SIZE,
        offset: this.state.loadedCount,
      });

      const libraryImages = await Promise.all(
        records.map(r => this.mapRecordToLibraryImage(r))
      );

      // Reconcile with queue
      const reconciledImages = await this.reconcileWithQueue(libraryImages);

      // Append to existing
      const existingIds = new Set(this.state.images.map(img => img.id));
      const newImages = reconciledImages.filter(img => !existingIds.has(img.id));

      this.state = {
        ...this.state,
        images: [...this.state.images, ...newImages],
        hasMore: libraryImages.length === PAGE_SIZE,
        loadedCount: this.state.loadedCount + libraryImages.length,
      };

      // Notify listeners
      this.notifyListeners();
    } catch (error) {
      console.error('❌ LibraryStateManager: Load more failed:', error);
      throw error;
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);

    // Immediately notify with current state
    listener(this.state);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('❌ LibraryStateManager: Error in listener:', error);
      }
    });
  }

  /**
   * Toggle favorite status for an image
   */
  async toggleFavorite(id: string): Promise<void> {
    const image = this.state.images.find(img => img.id === id);
    if (!image) return;

    const newFavorite = !image.isFavorite;

    // Update in-memory state immediately
    const updatedImages = this.state.images.map(img => {
      if (img.id !== id) return img;
      return {
        ...img,
        isFavorite: newFavorite,
        favoriteSyncStatus: newFavorite ? 'syncing' as FavoriteSyncStatus : 'none' as FavoriteSyncStatus,
      };
    });

    this.state = { ...this.state, images: updatedImages };
    this.notifyListeners();

    // Persist to SQLite
    await queries.toggleFavorite(id, newFavorite);

    // Cloud sync
    if (newFavorite) {
      this.syncFavoriteToCloud(id).catch(error => {
        console.error('❌ LibraryStateManager: Failed to sync favorite to cloud:', error);
        this.updateFavoriteSyncStatus(id, 'failed');
      });
    } else {
      this.removeFavoriteFromCloud(id).catch(error => {
        console.error('❌ LibraryStateManager: Failed to remove favorite from cloud:', error);
      });
    }
  }

  /**
   * Sync a favorited image to Supabase cloud
   */
  private async syncFavoriteToCloud(id: string): Promise<void> {
    const image = this.state.images.find(img => img.id === id);
    if (!image || !image.isFavorite) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      console.warn('⚠️ LibraryStateManager: No auth session, skipping cloud sync');
      this.updateFavoriteSyncStatus(id, 'failed');
      return;
    }

    const userId = session.user.id;
    const imageUri = image.transformedImageUrl || image.originalImageUri;
    if (!imageUri) {
      this.updateFavoriteSyncStatus(id, 'failed');
      return;
    }

    try {
      // Resolve to absolute path for library images
      const absoluteUri = imageUri.startsWith('/') || imageUri.startsWith('file://')
        ? imageUri
        : toAbsolutePath(imageUri, 'library');

      // Optimize image
      const base64 = await optimizeFavoriteImage(absoluteUri);

      // Upload to storage
      const storagePath = `${userId}/${id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(FAVORITES_BUCKET)
        .upload(storagePath, decode(base64), {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Insert library_favorites record
      const { data: record, error: insertError } = await supabase
        .from('library_favorites')
        .insert({
          user_id: userId,
          storage_path: storagePath,
          original_prompt: image.prompt || null,
          model_name: image.model || null,
          metadata: {
            originalImageUri: image.originalImageUri,
            createdAt: image.createdAt,
            completedAt: image.completedAt,
            modelId: image.modelId,
            options: image.options,
          },
          media_type: image.metadata?.type === 'video' ? 'video' : 'image',
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // Mark synced in SQLite
      await queries.markFavoriteSynced(id, record.id);

      // Update in-memory state
      this.updateFavoriteSyncStatus(id, 'synced');

      console.log(`☁️ LibraryStateManager: Favorite synced to cloud: ${id} → ${record.id}`);
    } catch (error) {
      console.error('❌ LibraryStateManager: Cloud sync failed for favorite:', error);
      this.updateFavoriteSyncStatus(id, 'failed');
    }
  }

  /**
   * Remove a favorite from Supabase cloud
   */
  private async removeFavoriteFromCloud(id: string): Promise<void> {
    // Get the remote ID from SQLite before clearing
    const record = await imageManager.getImage(id);
    const remoteId = record?.favorite_remote_id;

    if (!remoteId) {
      await queries.clearFavoriteSync(id);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Get storage path from remote record
      const { data: remoteRecord } = await supabase
        .from('library_favorites')
        .select('storage_path')
        .eq('id', remoteId)
        .single();

      if (remoteRecord?.storage_path) {
        // Delete from storage
        await supabase.storage
          .from(FAVORITES_BUCKET)
          .remove([remoteRecord.storage_path]);
      }

      // Delete DB record
      await supabase
        .from('library_favorites')
        .delete()
        .eq('id', remoteId);

      // Clear local sync fields
      await queries.clearFavoriteSync(id);

      console.log(`☁️ LibraryStateManager: Favorite removed from cloud: ${id}`);
    } catch (error) {
      console.error('❌ LibraryStateManager: Failed to remove favorite from cloud:', error);
      // Still clear local sync fields
      await queries.clearFavoriteSync(id);
    }
  }

  /**
   * Download cloud favorites that don't exist locally (cross-device sync)
   */
  private async downloadCloudFavorites(): Promise<void> {
    if (this.isDownloadingCloudFavorites) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user || session.user.is_anonymous) {
      console.log('📚 downloadCloudFavorites: Skipping (no session or anonymous user)');
      return;
    }

    this.isDownloadingCloudFavorites = true;
    const userId = session.user.id;

    try {
      // Get local dedup set
      const localRemoteIds = await queries.getAllFavoriteRemoteIds();

      // Fetch all remote favorites
      const { data: remoteFavorites, error } = await supabase
        .from('library_favorites')
        .select('id, storage_path, original_prompt, model_name, metadata, media_type, created_at')
        .eq('user_id', userId);

      if (error) throw error;
      if (!remoteFavorites || remoteFavorites.length === 0) {
        console.log('📚 downloadCloudFavorites: No remote favorites found');
        return;
      }

      // Filter out already-synced favorites
      const missing = remoteFavorites.filter(r => !localRemoteIds.has(r.id));

      if (missing.length === 0) {
        console.log('📚 downloadCloudFavorites: All cloud favorites already synced');
        return;
      }

      console.log(`📚 downloadCloudFavorites: Downloading ${missing.length} missing favorite(s)`);

      let downloaded = 0;

      for (const remote of missing) {
        try {
          // Get public URL for the stored image
          const { data: urlData } = supabase.storage
            .from(FAVORITES_BUCKET)
            .getPublicUrl(remote.storage_path);

          if (!urlData?.publicUrl) {
            console.warn(`⚠️ downloadCloudFavorites: No public URL for ${remote.id}`);
            continue;
          }

          // Download image to local filesystem + SQLite
          const dbRecord = await imageManager.saveImage({
            remoteUri: urlData.publicUrl,
            type: 'library',
            category: remote.model_name || undefined,
            metadata: {
              prompt: remote.original_prompt || '',
              model: remote.model_name || '',
              status: 'completed',
              ...(remote.metadata as Record<string, any> || {}),
              cloudFavoriteId: remote.id,
            },
          });

          // Mark as favorite
          await queries.toggleFavorite(dbRecord.id, true);

          // Mark synced to prevent re-upload
          await queries.markFavoriteSynced(dbRecord.id, remote.id);

          // Add to in-memory state
          const libraryImage = await this.mapRecordToLibraryImage({
            ...dbRecord,
            is_favorite: 1,
            favorite_synced_at: Date.now(),
            favorite_remote_id: remote.id,
          });

          this.state = {
            ...this.state,
            images: [...this.state.images, libraryImage],
            loadedCount: this.state.loadedCount + 1,
          };

          downloaded++;
        } catch (itemError) {
          console.error(`❌ downloadCloudFavorites: Failed to download ${remote.id}:`, itemError);
          // Continue with next item
        }
      }

      if (downloaded > 0) {
        // Re-sort through the canonical comparator and notify once
        this.state = {
          ...this.state,
          images: sortLibraryImages(this.state.images),
        };
        this.notifyListeners();
        console.log(`✅ downloadCloudFavorites: Downloaded ${downloaded} favorite(s)`);
      }
    } catch (error) {
      console.error('❌ downloadCloudFavorites: Failed:', error);
    } finally {
      this.isDownloadingCloudFavorites = false;
    }
  }

  /**
   * Update favorite sync status in memory
   */
  private updateFavoriteSyncStatus(id: string, status: FavoriteSyncStatus): void {
    const updatedImages = this.state.images.map(img => {
      if (img.id !== id) return img;
      return { ...img, favoriteSyncStatus: status };
    });

    this.state = { ...this.state, images: updatedImages };
    this.notifyListeners();
  }

  /**
   * Cleanup and unsubscribe
   */
  async cleanup(): Promise<void> {
    if (this.queueUnsubscribe) {
      this.queueUnsubscribe();
      this.queueUnsubscribe = null;
    }

    this.listeners.clear();
    this.activeJobs.clear();
    this.pendingUpdates.clear();

    this.state = {
      images: [],
      isLoaded: false,
      hasMore: true,
      loadedCount: 0,
    };

    this.isInitialized = false;

    console.log('🧹 LibraryStateManager: Cleaned up');
  }
}

// Export singleton instance
export const libraryStateManager = LibraryStateManager.getInstance();
