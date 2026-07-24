/**
 * Inspire grid-crop helper.
 *
 * Shared between the manual admin button in ImageDetailsModal and the
 * automatic post-download trigger inside useCloudQueueGeneration when the
 * Inspire preset has `grid_size === 2`.
 *
 * Behavior:
 *   - Downloads the source to a cache file if it's a remote URL.
 *   - Slices into n×n tiles via `runGridCrop` (3% safe-area inset).
 *   - Inserts each tile as a new library row (metadata.localTool =
 *     'inspire-grid-crop' so the recipe/library filters can pick them out).
 *   - Marks the parent image with `autoCroppedAt` so re-invocation no-ops.
 *
 * Idempotency: the helper sets the parent's metadata flag BEFORE doing the
 * actual work, so duplicate job-update events don't re-fire mid-crop. If
 * the work then fails partway, the flag stays set — the manual admin
 * button can be used to retry by clearing `autoCroppedAt` first if needed.
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { runGridCrop } from '../devTools/gridCrop';
import { imageManager } from '../imageManager';
import type { LibraryImage } from '../library/libraryStateManager';

type AddImageFn = (
  image: Omit<LibraryImage, 'id' | 'createdAt'>,
) => Promise<string>;

interface Args {
  /** The parent library row that should be cropped. Its `transformedImageUrl`
   *  is the source — may be local (`file://`) or remote (`https://`). */
  sourceImage: LibraryImage;
  /** Grid dimension (2 for 2×2, 3 for 3×3). */
  n: 2 | 3;
  addImage: AddImageFn;
}

export interface GridCropResult {
  /** Number of tile rows inserted into the library. */
  created: number;
  /** True if the parent was already auto-cropped (no-op). */
  alreadyCropped: boolean;
}

// Synchronous in-process guard: prevents two concurrent gridCropInspireImage
// runs for the same parent. The DB-backed `autoCroppedAt` flag can't catch
// concurrent callers because both might read the same stale in-memory copy
// before either has flushed the flag. This set closes that race.
const cropInProgress = new Set<string>();

export async function gridCropInspireImage(args: Args): Promise<GridCropResult> {
  const { sourceImage, n, addImage } = args;

  if (cropInProgress.has(sourceImage.id)) {
    return { created: 0, alreadyCropped: true };
  }
  if (sourceImage.metadata?.autoCroppedAt) {
    return { created: 0, alreadyCropped: true };
  }

  const sourceUri = sourceImage.transformedImageUrl;
  if (!sourceUri) {
    throw new Error('No source URL on library item.');
  }

  cropInProgress.add(sourceImage.id);
  try {
    // Mark first so a re-entry from the next job-update tick bails out even
    // if it slips past the in-memory guard (e.g., after the guard releases).
    await imageManager.updateImage(sourceImage.id, {
      metadata: {
        ...sourceImage.metadata,
        autoCroppedAt: Date.now(),
        autoCroppedN: n,
      },
    });

    let localUri = sourceUri;
    if (sourceUri.startsWith('http://') || sourceUri.startsWith('https://')) {
      const fileName = `inspire_crop_src_${Date.now()}.jpg`;
      const localPath = `${FileSystemLegacy.cacheDirectory}${fileName}`;
      const dl = await FileSystemLegacy.downloadAsync(sourceUri, localPath);
      if (dl.status !== 200) throw new Error(`Download failed: ${dl.status}`);
      localUri = dl.uri;
    }

    const pieces = await runGridCrop(localUri, n, 0.03);
    const batchId = `inspire_crop_${n}x${n}_${Date.now()}`;
    let created = 0;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      await addImage({
        originalImageUri: piece.uri,
        inputImages: sourceImage.inputImages,
        transformedImageUrl: piece.uri,
        prompt: sourceImage.prompt || '',
        model: sourceImage.model || '',
        status: 'completed',
        modelId: sourceImage.modelId,
        completedAt: Date.now(),
        isFavorite: false,
        favoriteSyncStatus: 'none',
        metadata: {
          localTool: 'inspire-grid-crop',
          sourceLibraryId: sourceImage.id,
          gridSize: n,
          gridIndex: i,
          batchId,
          // Inherit hidden-source flags so ImageDetailsModal's revealSensitive
          // gate keeps the prompt/model hidden on cropped tiles too.
          fromImagine: sourceImage.metadata?.fromImagine ?? sourceImage.metadata?.fromInspire,
          fromCommunityRecipe: sourceImage.metadata?.fromCommunityRecipe,
          // Pre-computed dimensions let MasonryGrid lay out the tile on the
          // first paint instead of waiting for <Image> onLoad, which removes
          // the visible reflow as the 4–8 tiles stream into the library.
          tileDimensions: {
            width: piece.width,
            height: piece.height,
            // Guard the division so a degenerate piece can never persist
            // Infinity/NaN into metadata (which would later crash layout).
            aspectRatio: piece.height > 0 ? piece.width / piece.height : 1,
          },
        },
      });
      created++;
    }

    return { created, alreadyCropped: false };
  } finally {
    cropInProgress.delete(sourceImage.id);
  }
}
