/**
 * Cloud Queue Types
 *
 * Type definitions for the cloud-based generation queue system
 */

export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationQueueEntry {
  id: string;
  user_id: string;
  image_id: string | null;
  replicate_id: string | null;
  status: GenerationStatus;
  model: string;
  parameters: GenerationParameters;
  result_url: string | null;
  result_urls?: string[] | null;
  local_uri: string | null;
  error_message: string | null;
  coins_cost: number;
  coins_refunded: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface GenerationParameters {
  prompt: string;
  [key: string]: any; // Model-specific parameters
}

export interface GeneratedImageMetadata {
  id: string;
  user_id: string;
  prompt: string;
  model: string;
  parameters: Record<string, any>;
  local_uri: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueJob {
  id: string;
  replicateId: string | null;
  status: GenerationStatus;
  model: string;
  prompt: string;
  parameters: Record<string, any>;
  resultUrl: string | null;
  /** Optional multi-result array (e.g., 4 server-cropped quadrants).
   *  When set, resultUrl is the first element for legacy single-URL
   *  consumers. Server-crop flow populates this via fal-prediction-callback. */
  resultUrls?: string[] | null;
  errorMessage: string | null;
  coinsCost: number;
  coinsRefunded: boolean;
  localUri: string | null; // Local cache path after download
  isDownloading?: boolean; // Client-side flag: true while downloading result
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface StartPredictionRequest {
  model: string;
  prompt: string;
  parameters?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface StartPredictionResponse {
  job_id: string;
  replicate_id: string;
  status: GenerationStatus;
  coins_deducted: number;
  remaining_balance: number;
}

export interface QueueManagerOptions {
  autoDownload?: boolean; // Auto-download completed images
  syncInterval?: number; // Realtime sync interval (ms)
  maxRetries?: number; // Max retry attempts for failed downloads
  maxParallelDownloads?: number; // Max concurrent downloads for completed jobs
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

// Types for manual job status checking
export interface CheckStatusResult {
  success: boolean;
  status: GenerationStatus;
  resultUrl?: string;
  errorMessage?: string;
  alreadyTerminal?: boolean; // true if job was already completed/failed
}

export interface RecheckResult {
  success: boolean;
  status: GenerationStatus | 'not_found';
  resultUrl?: string;
  errorMessage?: string;
  downloaded?: boolean; // true if download was triggered
}
