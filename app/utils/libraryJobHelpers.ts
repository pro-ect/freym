/**
 * Shared utilities for library job creation
 * These helpers provide common functionality used across different tabs and generation hooks
 */

/**
 * Flying image data structure
 */
export interface FlyingImageData {
  id: string;
  imageUri: string;
  startX: number;
  startY: number;
}

/**
 * Creates a background processor wrapper that handles errors consistently
 *
 * @param processFn - The async function to execute
 * @param onSuccess - Callback when processing succeeds
 * @param onError - Callback when processing fails
 */
export function createBackgroundProcessor<T>(
  processFn: () => Promise<T>,
  onSuccess: (result: T) => void | Promise<void>,
  onError: (error: Error) => void | Promise<void>
): void {
  (async () => {
    try {
      const result = await processFn();
      await onSuccess(result);
    } catch (error: any) {
      console.error('Background processing error:', error);
      await onError(error);
    }
  })();
}

/**
 * Batch processing helper for multiple images
 *
 * @param items - Array of items to process
 * @param processFn - Function to process each item
 * @param onProgress - Optional progress callback
 * @returns Array of results
 */
export async function batchProcess<T, R>(
  items: T[],
  processFn: (item: T, index: number) => Promise<R>,
  onProgress?: (current: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = await processFn(items[i], i);
    results.push(result);

    if (onProgress) {
      onProgress(i + 1, items.length);
    }
  }

  return results;
}

/**
 * Creates a placeholder library entry for batch operations
 * Useful for showing immediate feedback while generation is in progress
 *
 * @param imageUri - The image URI to use as placeholder
 * @param prompt - The generation prompt
 * @param metadata - Additional metadata
 * @returns Placeholder configuration
 */
export function createPlaceholder(
  imageUri: string,
  prompt: string,
  metadata: Record<string, any> = {}
) {
  return {
    originalImageUri: imageUri,
    transformedImageUrl: imageUri, // Show original while processing
    prompt,
    status: 'processing' as const,
    metadata: {
      ...metadata,
      isPlaceholder: true,
      createdAt: Date.now(),
    },
  };
}

/**
 * Validates generation inputs
 *
 * @param prompt - The text prompt
 * @param minLength - Minimum prompt length
 * @returns Validation result with error message if invalid
 */
export function validateGenerationInputs(
  prompt: string,
  minLength: number = 1
): { valid: boolean; error?: string } {
  if (!prompt || !prompt.trim()) {
    return { valid: false, error: 'Please enter a text prompt' };
  }

  if (prompt.trim().length < minLength) {
    return { valid: false, error: `Prompt must be at least ${minLength} characters` };
  }

  return { valid: true };
}

/**
 * Formats error messages for user display
 *
 * @param error - The error object
 * @param fallbackMessage - Default message if error has no message
 * @returns Formatted error message
 */
export function formatErrorMessage(error: any, fallbackMessage: string = 'An error occurred'): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error?.message) {
    return error.message;
  }

  if (error?.error) {
    return typeof error.error === 'string' ? error.error : fallbackMessage;
  }

  return fallbackMessage;
}

/**
 * Calculates timeout based on operation type
 *
 * @param operationType - Type of operation (image, video, upscale, etc.)
 * @returns Timeout in seconds
 */
export function getOperationTimeout(operationType: 'image' | 'video' | 'upscale' | 'batch'): number {
  const timeouts = {
    image: 60,      // 1 minute for regular images
    video: 300,     // 5 minutes for videos
    upscale: 180,   // 3 minutes for upscaling
    batch: 120,     // 2 minutes per batch item
  };

  return timeouts[operationType] || 60;
}

/**
 * Delays execution for a specified duration
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff
 *
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts
 * @param initialDelay - Initial delay in milliseconds
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delayMs = initialDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}
