/**
 * useCloudQueue Hook
 *
 * React hook for cloud-based generation queue
 * - Auto-syncs with Supabase Realtime
 * - Provides queue state and operations
 * - Handles background downloads
 */

import { useEffect, useState, useCallback } from 'react';
import { queueManager } from '@/lib/queue/queueManager';
import type { QueueJob, QueueStats, StartPredictionRequest } from '@/lib/queue/types';

export interface UseCloudQueueReturn {
  jobs: QueueJob[];
  stats: QueueStats;
  isLoading: boolean;
  error: string | null;
  startPrediction: (request: StartPredictionRequest) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  downloadResult: (jobId: string) => Promise<string | null>;
  getJob: (jobId: string) => QueueJob | null;
  getJobsByStatus: (status: QueueJob['status']) => QueueJob[];
}

export function useCloudQueue(): UseCloudQueueReturn {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Queue manager is initialized globally at app startup
  // Just set loading to false
  useEffect(() => {
    setIsLoading(false);
  }, []);

  // Subscribe to queue changes
  useEffect(() => {
    const unsubscribe = queueManager.subscribe((updatedJobs) => {
      setJobs(updatedJobs);
    });

    return unsubscribe;
  }, []);

  // Calculate stats from jobs
  const stats: QueueStats = {
    pending: jobs.filter(j => j.status === 'pending').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    total: jobs.length,
  };

  // Start a new prediction
  const startPrediction = useCallback(async (request: StartPredictionRequest) => {
    try {
      setError(null);
      await queueManager.startPrediction(request);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start prediction';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  // Retry a failed job
  const retryJob = useCallback(async (jobId: string) => {
    try {
      setError(null);
      await queueManager.retryJob(jobId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to retry job';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  // Download a job result
  const downloadResult = useCallback(async (jobId: string) => {
    try {
      setError(null);
      return await queueManager.downloadJobResult(jobId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to download result';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  // Get a specific job
  const getJob = useCallback((jobId: string) => {
    return queueManager.getJob(jobId);
  }, [jobs]); // Depend on jobs to trigger re-render when jobs change

  // Get jobs by status
  const getJobsByStatus = useCallback((status: QueueJob['status']) => {
    return queueManager.getJobsByStatus(status);
  }, [jobs]); // Depend on jobs to trigger re-render when jobs change

  return {
    jobs,
    stats,
    isLoading,
    error,
    startPrediction,
    retryJob,
    downloadResult,
    getJob,
    getJobsByStatus,
  };
}

/**
 * Hook to watch a specific job
 */
export function useQueueJob(jobId: string | null): {
  job: QueueJob | null;
  isLoading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  download: () => Promise<string | null>;
} {
  const [job, setJob] = useState<QueueJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setIsLoading(false);
      return;
    }

    // Subscribe to queue changes and filter for this job
    const unsubscribe = queueManager.subscribe((jobs) => {
      const foundJob = jobs.find(j => j.id === jobId);
      setJob(foundJob || null);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [jobId]);

  const retry = useCallback(async () => {
    if (!jobId) {
      throw new Error('No job ID');
    }

    try {
      setError(null);
      await queueManager.retryJob(jobId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to retry job';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [jobId]);

  const download = useCallback(async () => {
    if (!jobId) {
      throw new Error('No job ID');
    }

    try {
      setError(null);
      return await queueManager.downloadJobResult(jobId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to download result';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [jobId]);

  return {
    job,
    isLoading,
    error,
    retry,
    download,
  };
}
