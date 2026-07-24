import React, { createContext, useContext, ReactNode } from 'react';
import { useCloudQueueGeneration } from '../app/hooks/useCloudQueueGeneration';
import { useGeneration } from '../app/hooks/useGeneration';

interface CloudQueueContextType {
  // New unified generation function
  generate: ReturnType<typeof useGeneration>['generate'];
  generateBatch: ReturnType<typeof useGeneration>['generateBatch'];

  // Legacy function (kept for backward compatibility, will be removed)
  generateWithQueue: ReturnType<typeof useCloudQueueGeneration>['generateWithQueue'];

  // Server-crop fan-out for Imagine 2x2
  startServerCropJob: ReturnType<typeof useCloudQueueGeneration>['startServerCropJob'];

  // Status helpers used by ImageDetailsModal
  recheckJobStatus: ReturnType<typeof useCloudQueueGeneration>['recheckJobStatus'];
  retryFailedJob: ReturnType<typeof useCloudQueueGeneration>['retryFailedJob'];

  // Active jobs tracking
  activeJobs: ReturnType<typeof useCloudQueueGeneration>['activeJobs'];
}

const CloudQueueContext = createContext<CloudQueueContextType | undefined>(undefined);

export function CloudQueueProvider({ children }: { children: ReactNode }) {
  const cloudQueue = useCloudQueueGeneration();
  const generation = useGeneration();

  const contextValue: CloudQueueContextType = {
    // New unified API
    generate: generation.generate,
    generateBatch: generation.generateBatch,

    // Legacy API (backward compatibility)
    generateWithQueue: cloudQueue.generateWithQueue,

    // Imagine server-crop
    startServerCropJob: cloudQueue.startServerCropJob,

    // Status helpers (must come from the singleton so we don't spin up
    // duplicate queueManager subscriptions per consumer)
    recheckJobStatus: cloudQueue.recheckJobStatus,
    retryFailedJob: cloudQueue.retryFailedJob,

    // Job tracking
    activeJobs: cloudQueue.activeJobs,
  };

  return (
    <CloudQueueContext.Provider value={contextValue}>
      {children}
    </CloudQueueContext.Provider>
  );
}

export function useCloudQueue() {
  const context = useContext(CloudQueueContext);
  if (!context) {
    throw new Error('useCloudQueue must be used within a CloudQueueProvider');
  }
  return context;
}
