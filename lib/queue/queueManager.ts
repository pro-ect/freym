/**
 * Cloud Queue Manager
 *
 * Manages the cloud-based generation queue:
 * - Subscribes to Realtime changes on generation_queue
 * - Downloads completed images automatically
 * - Syncs queue status with local state
 * - Handles retry logic for failed downloads
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { supabase } from '../supabase';
import { imageManager } from '../imageManager';
import type {
  GenerationQueueEntry,
  QueueJob,
  QueueManagerOptions,
  QueueStats,
  StartPredictionRequest,
  StartPredictionResponse,
  CheckStatusResult,
} from './types';

export class QueueManager {
  private static instance: QueueManager;
  private subscription: any = null;
  private jobs: Map<string, QueueJob> = new Map();
  private listeners: Set<(jobs: QueueJob[]) => void> = new Set();
  private options: Required<QueueManagerOptions>;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private activeDownloads = 0;
  private pendingDownloads: Array<{
    jobId: string;
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  }> = [];
  private downloadPromises: Map<string, Promise<string | null>> = new Map();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: number = 0;
  private appStateSubscription: NativeEventSubscription | null = null;
  private lastAppState: AppStateStatus = AppState.currentState;
  private isReconciling: boolean = false;
  private realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // External signal (library layer) that generations are in flight even when
  // this.jobs has no active entries — e.g. a job whose Realtime INSERT event
  // was missed. Lets polling discover jobs it never learned about.
  private activityProbe: (() => boolean) | null = null;

  private constructor(options?: QueueManagerOptions) {
    this.options = {
      autoDownload: options?.autoDownload ?? true,
      syncInterval: options?.syncInterval ?? 1000,
      maxRetries: options?.maxRetries ?? 3,
      maxParallelDownloads: options?.maxParallelDownloads ?? 2,
    };
  }

  static getInstance(options?: QueueManagerOptions): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager(options);
    }
    return QueueManager.instance;
  }

  /**
   * Ensure queue manager is initialized (lazy init)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return;
    }

    await this.initialize();
  }

  /**
   * Initialize the queue manager and start Realtime sync
   * OPTIMIZATION: Starts Realtime immediately, loads jobs in background
   */
  async initialize(): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.isInitialized) {
      console.log('⚡ QueueManager already initialized, skipping...');
      return;
    }

    if (this.isInitializing) {
      console.log('⏳ QueueManager is already initializing, skipping...');
      return;
    }

    this.isInitializing = true;
    const startTime = Date.now();
    console.log('🔧 QueueManager: Starting initialization...');

    try {
      // Start Realtime subscription (needs user auth)
      const realtimeStart = Date.now();
      await this.startRealtimeSync();
      const realtimeDuration = Date.now() - realtimeStart;
      console.log(`✅ QueueManager: Realtime sync started in ${realtimeDuration}ms`);

      // Listen for app foreground transitions so we can reconcile any jobs
      // whose Realtime completion events were missed while backgrounded.
      this.setupAppStateListener();

      // Mark as initialized immediately - Realtime is ready
      this.isInitialized = true;
      const totalDuration = Date.now() - startTime;
      console.log(`🎉 QueueManager initialized in ${totalDuration}ms`);

      // OPTIMIZATION: Load existing jobs in background (slow, but doesn't block)
      setTimeout(async () => {
        try {
          const loadJobsStart = Date.now();
          console.log('📚 QueueManager: Loading jobs in background...');
          await this.loadJobs();
          const loadJobsDuration = Date.now() - loadJobsStart;
          console.log(`✅ QueueManager: Jobs loaded in ${loadJobsDuration}ms (background)`);
        } catch (error) {
          console.error('❌ QueueManager: Background job loading failed:', error);
        }
      }, 100); // Start loading after 100ms delay (non-blocking)

      // Start polling as a fallback for unreliable Realtime
      this.startPolling();
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Start polling for job updates as a fallback when Realtime is unreliable
   * Polls every 10 seconds for processing jobs
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    const POLL_INTERVAL = 10000; // 10 seconds
    console.log('🔄 QueueManager: Starting polling fallback (every 10s)');

    this.pollingInterval = setInterval(async () => {
      try {
        // Only poll if we have processing jobs — or the library layer says
        // generations are in flight (covers jobs whose INSERT event was
        // missed, which would otherwise never be discovered).
        const processingJobs = this.getJobsByStatus('processing');
        const pendingJobs = this.getJobsByStatus('pending');
        const externalActivity = this.activityProbe?.() ?? false;

        if (processingJobs.length === 0 && pendingJobs.length === 0 && !externalActivity) {
          return; // No active jobs, skip polling
        }

        // Throttle: Don't poll more than once per 8 seconds
        const now = Date.now();
        if (now - this.lastPollTime < 8000) {
          return;
        }
        this.lastPollTime = now;

        console.log(`🔄 QueueManager: Polling for ${processingJobs.length} processing + ${pendingJobs.length} pending jobs...`);
        await this.pollForUpdates();
      } catch (error) {
        console.error('❌ QueueManager: Polling error:', error);
      }
    }, POLL_INTERVAL);
  }

  /**
   * Poll Supabase for job updates
   * This is a fallback when Realtime events are missed
   */
  private async pollForUpdates(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Jobs we already know as active — poll them for status changes
      const activeJobIds = [...this.jobs.entries()]
        .filter(([_, job]) => job.status === 'processing' || job.status === 'pending')
        .map(([id]) => id);

      // Also fetch the user's active jobs we DON'T know about (Realtime
      // INSERT missed while the socket was dead) so polling can adopt them.
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const orFilters = ['status.in.(pending,processing)'];
      if (activeJobIds.length > 0) {
        orFilters.push(`id.in.(${activeJobIds.join(',')})`);
      }

      const { data, error } = await supabase
        .from('generation_queue')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', oneDayAgo)
        .or(orFilters.join(','));

      if (error) {
        console.error('❌ QueueManager: Poll query failed:', error);
        return;
      }

      if (!data) return;

      // Check for status changes
      let hasChanges = false;
      for (const entry of data) {
        const existingJob = this.jobs.get(entry.id);
        if (!existingJob) {
          // Unknown active job — learn it so future polls track it to completion
          const discovered = this.transformToQueueJob(entry);
          this.jobs.set(entry.id, discovered);
          console.log(`🔄 Poll: Discovered untracked job ${entry.id.substring(0, 8)} (${discovered.status})`);
          hasChanges = true;
          continue;
        }

        // Check if status changed
        if (existingJob.status !== entry.status ||
            (entry.status === 'completed' && entry.result_url && !existingJob.resultUrl)) {
          console.log(`🔄 Poll: Job ${entry.id.substring(0, 8)} changed: ${existingJob.status} → ${entry.status}`);
          hasChanges = true;

          // Update job and trigger download if completed
          const updatedJob = this.transformToQueueJob(entry);
          this.jobs.set(entry.id, updatedJob);

          if (updatedJob.status === 'completed' && updatedJob.resultUrl && !updatedJob.localUri && this.options.autoDownload) {
            console.log(`🔄 Poll: Triggering download for job ${entry.id.substring(0, 8)}`);
            updatedJob.isDownloading = true;
            this.jobs.set(entry.id, updatedJob);
            this.downloadJobResult(entry.id).catch(err => {
              console.error(`❌ Poll download failed for ${entry.id}:`, err);
            });
          }
        }
      }

      if (hasChanges) {
        this.notifyListeners();
      }
    } catch (error) {
      console.error('❌ QueueManager: pollForUpdates error:', error);
    }
  }

  /**
   * Load existing queue jobs from Supabase
   */
  private async loadJobs(): Promise<void> {
    try {
      // Get current user - only load their jobs
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('📚 QueueManager: No user logged in, skipping job load');
        return;
      }

      // Only load recent jobs to avoid timeout (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      console.log(`📚 QueueManager: Loading jobs for user ${user.id}`);

      const { data, error } = await supabase
        .from('generation_queue')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Failed to load queue jobs:', error);
        return;
      }

      if (data) {
        this.jobs.clear();
        const completedJobsNeedingDownload: string[] = [];

        for (const entry of data) {
          const job = this.transformToQueueJob(entry);
          this.jobs.set(job.id, job);

          // Any completed job in our 24h window that still lacks a localUri
          // needs to be downloaded — without this, a job whose Realtime
          // completion event was missed while the app was backgrounded stays
          // invisible until the user manually triggers cleanup.
          if (job.status === 'completed' && job.resultUrl && !job.localUri && this.options.autoDownload) {
            completedJobsNeedingDownload.push(job.id);
          }
        }

        console.log(`⏰ [${new Date().toISOString()}] 📚 Loaded ${this.jobs.size} recent queue jobs (last 24h)`);

        // Auto-download any completed jobs that don't have localUri yet
        if (completedJobsNeedingDownload.length > 0) {
          console.log(`⏰ [${new Date().toISOString()}] 🔄 Found ${completedJobsNeedingDownload.length} completed jobs without localUri - queuing downloads...`);

          // Set isDownloading flag for jobs being downloaded
          for (const jobId of completedJobsNeedingDownload) {
            const job = this.jobs.get(jobId);
            if (job) {
              job.isDownloading = true;
              this.jobs.set(jobId, job);
            }
          }

          // Notify listeners FIRST with isDownloading=true
          this.notifyListeners();

          // Then queue downloads (will notify again when each completes)
          for (const jobId of completedJobsNeedingDownload) {
            this.downloadJobResult(jobId).catch((error) => {
              console.error(`⏰ [${new Date().toISOString()}] ❌ Auto-download failed for old job ${jobId}:`, error);
              // Clear downloading flag on error
              const job = this.jobs.get(jobId);
              if (job) {
                job.isDownloading = false;
                this.jobs.set(jobId, job);
                this.notifyListeners();
              }
            });
          }
        } else {
          // No downloads needed, just notify
          this.notifyListeners();
        }
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
    }
  }

  /**
   * Force reload jobs from Supabase (useful when Realtime is stuck)
   */
  async forceReloadJobs(): Promise<void> {
    console.log('🔄 QueueManager: Force reloading jobs from database...');
    await this.loadJobs();
    console.log('✅ QueueManager: Force reload complete');
  }

  /**
   * Start Realtime subscription for queue changes
   */
  private async startRealtimeSync(): Promise<void> {
    if (this.subscription) {
      console.log('Realtime sync already active');
      return;
    }

    // Get current user - only subscribe to their jobs
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('📚 QueueManager: No user for Realtime, skipping');
      return;
    }

    console.log('🔌 Starting Realtime sync for user:', user.id);

    // Create unique channel name to avoid conflicts
    const channelName = `generation_queue_${user.id}_${Date.now()}`;
    console.log('🔌 Creating channel:', channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generation_queue',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔔 Realtime event received:', payload.eventType);
          this.handleRealtimeEvent(payload);
        }
      );

    this.subscription = channel;

    channel.subscribe((status, err) => {
      console.log('🔌 Realtime subscription status:', status);
      if (err) {
        console.error('❌ Realtime subscription error:', err);
      }
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime subscription active - listening for generation_queue changes');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Ignore status callbacks from a channel we already tore down
        // (deliberate teardown emits CLOSED) — only self-heal the live one.
        if (this.subscription !== channel) return;
        this.scheduleRealtimeReconnect(status);
      }
    });
  }

  /**
   * Rebuild the Realtime channel after it errored, timed out, or closed.
   * iOS/network transitions kill the socket silently; without this, completion
   * events stop arriving until the next app-foreground rebuild.
   */
  private scheduleRealtimeReconnect(reason: string): void {
    if (this.realtimeReconnectTimer) return;
    console.warn(`⚠️ Realtime channel ${reason} — reconnecting in 5s`);
    this.realtimeReconnectTimer = setTimeout(async () => {
      this.realtimeReconnectTimer = null;
      const stale = this.subscription;
      this.subscription = null;
      try {
        if (stale) await stale.unsubscribe();
      } catch {
        // best-effort teardown
      }
      try {
        await this.startRealtimeSync();
        // Catch up on anything missed while the channel was dead
        await this.loadJobs();
      } catch (err) {
        console.error('❌ Realtime reconnect failed:', err);
      }
    }, 5000);
  }

  /**
   * Register an external "generations in flight" probe (library layer).
   * Polling uses it to keep running even when this.jobs has no active
   * entries — e.g. a job whose Realtime INSERT event was missed.
   */
  setActivityProbe(probe: (() => boolean) | null): void {
    this.activityProbe = probe;
  }

  /**
   * Handle Realtime events from Supabase
   */
  private async handleRealtimeEvent(payload: any): Promise<void> {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    console.log('🔔 Realtime: Raw event:', {
      eventType,
      new_id: newRecord?.id,
      new_status: newRecord?.status,
      new_result_url: newRecord?.result_url?.substring(0, 50),
      old_status: oldRecord?.status
    });

    switch (eventType) {
      case 'INSERT':
        if (newRecord) {
          const job = this.transformToQueueJob(newRecord);
          this.jobs.set(job.id, job);
          console.log('📥 Realtime: New job added:', {
            job_id: job.id,
            model: job.model,
            status: job.status
          });
          this.notifyListeners();
        }
        break;

      case 'UPDATE':
        if (newRecord) {
          try {
            const newJob = this.transformToQueueJob(newRecord);
            const oldJob = this.jobs.get(newJob.id);

            // Merge with existing job to preserve fields not included in the update
            const job: QueueJob = oldJob ? {
              ...oldJob,
              ...newJob,
              // Preserve old values if new values are empty/missing
              parameters: newJob.parameters && Object.keys(newJob.parameters).length > 0 ? newJob.parameters : oldJob.parameters,
              prompt: newJob.prompt || oldJob.prompt,
            } : newJob;

            this.jobs.set(job.id, job);

            const updateTimestamp = new Date().toISOString();
            console.log(`⏰ [${updateTimestamp}] 🔄 Realtime: Job updated:`, {
              job_id: job.id,
              old_status: oldJob?.status,
              new_status: job.status,
              has_result: !!job.resultUrl,
              has_local: !!job.localUri,
              result_url_preview: job.resultUrl ? job.resultUrl.substring(0, 60) + '...' : null,
              local_uri_preview: job.localUri ? job.localUri.substring(0, 60) + '...' : null
            });

            // Auto-download completed jobs
            if (job.status === 'completed' && job.resultUrl && !job.localUri && this.options.autoDownload) {
              console.log(`⏰ [${new Date().toISOString()}] ⬇️ Auto-downloading result for job ${job.id}...`);
              console.log(`⏰ [${new Date().toISOString()}] 🎯 FIX: Setting isDownloading=true and starting download`);

              // Set downloading flag BEFORE notifying
              job.isDownloading = true;
              this.jobs.set(job.id, job);

              console.log(`⏰ [${new Date().toISOString()}] 📢 Notifying listeners with isDownloading=true (UI should show 'downloading' status)`);
              this.notifyListeners();

              // Start download (will notify again when complete)
              this.downloadJobResult(job.id).catch((error) => {
                console.error(`⏰ [${new Date().toISOString()}] ❌ Auto-download failed:`, error);
                // Clear downloading flag on error
                job.isDownloading = false;
                this.jobs.set(job.id, job);
                this.notifyListeners();
              });
            } else {
              // Job update but not triggering download - notify immediately
              console.log(`⏰ [${new Date().toISOString()}] 📢 Notifying listeners about job update`);
              console.log(`⏰ [${new Date().toISOString()}] 📊 Job state: { id: ${job.id}, status: ${job.status}, localUri: ${job.localUri ? 'EXISTS ✅' : 'NULL ⚠️'}, resultUrl: ${job.resultUrl ? 'EXISTS' : 'NULL'} }`);
              this.notifyListeners();
            }
          } catch (error) {
            console.error('❌ Error handling UPDATE event:', error);
            // Still notify listeners with whatever we have
            this.notifyListeners();
          }
        }
        break;

      case 'DELETE':
        if (oldRecord) {
          this.jobs.delete(oldRecord.id);
          console.log('🗑️ Realtime: Job deleted:', oldRecord.id);
          this.notifyListeners();
        }
        break;
    }
  }

  /**
   * Transform Supabase queue entry to QueueJob
   */
  private transformToQueueJob(entry: GenerationQueueEntry): QueueJob {
    return {
      id: entry.id,
      replicateId: entry.replicate_id ?? null,
      status: entry.status,
      model: entry.model,
      prompt: entry.parameters?.prompt ?? '',
      parameters: entry.parameters ?? {},
      resultUrl: entry.result_url ?? null,
      resultUrls: entry.result_urls ?? null,
      errorMessage: entry.error_message ?? null,
      coinsCost: entry.coins_cost ?? 0,
      coinsRefunded: entry.coins_refunded ?? false,
      localUri: entry.local_uri ?? null, // Read from database if available
      createdAt: new Date(entry.created_at),
      updatedAt: new Date(entry.updated_at),
      completedAt: entry.completed_at ? new Date(entry.completed_at) : undefined,
    };
  }

  /**
   * Check if a model should use the Fal.ai endpoint
   */
  private isFalModel(modelId: string): boolean {
    // Models ending with -fal or -phota use Fal.ai
    return modelId.endsWith('-fal') || modelId.endsWith('-phota');
  }

  private isCloudflareModel(modelId: string): boolean {
    return modelId.endsWith('-cf');
  }

  /**
   * Start a new prediction job
   */
  async startPrediction(request: StartPredictionRequest): Promise<StartPredictionResponse> {
    await this.ensureInitialized();

    try {
      console.log('📤 Starting prediction:', request.model);

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No active session. Please sign in first.');
      }

      // Determine which edge function to call based on the model
      const isFal = this.isFalModel(request.model);
      const isCloudflare = this.isCloudflareModel(request.model);
      // Imagine generate-from-ref jobs (server-crop 2x2 fan-out) route to the
      // Copy Shot fork `start-prediction-fal-copyshot`, which owns Imagine's
      // flat 50-coin/job pricing + gpt-image-2 clamp WITHOUT touching the
      // shared `start-prediction-fal` that all other Aya generations use.
      // Signalled by parameters._serverCrop or metadata.fromImagine.
      // metadata.onboardingFlow (hard-paywall onboarding's free single-image
      // generation) also routes here — it deliberately sets neither
      // _serverCrop (no 2x2 crop) nor fromImagine (no clamp/flat pricing),
      // pairing with copyshotV2 to reach start-prediction-fal-copyshot-v2.
      const isImagineJob =
        (request.parameters as any)?._serverCrop === true ||
        (request as any)?.metadata?.fromImagine === true ||
        (request as any)?.metadata?.onboardingFlow === true ||
        // "1 photo" Copy Shot mode — single un-cropped image, flat 100 coins.
        (request as any)?.metadata?.copyshotSingle === true;
      // Admin-only OpenAI-direct toggle (Copy Shot tab). When set, an Imagine
      // job bypasses Fal and hits OpenAI's Images API directly with
      // moderation:"low" via start-prediction-openai-direct. Regular users
      // never set this flag, so they keep using start-prediction-fal-copyshot.
      const wantsOpenAiDirect = (request as any)?.metadata?.openaiDirect === true;
      // Copy Shot V2 pipeline (inspire_presets.pipeline_version = 2): single
      // job, flat 250 coins, gpt-image HIGH clamp. Routes to the v2 fork so
      // the v1 function (still serving prod 1.0.x) stays untouched.
      const wantsCopyshotV2 = (request as any)?.metadata?.copyshotV2 === true;
      const edgeFunctionName = isCloudflare
        ? 'start-prediction-cloudflare'
        : isFal
          ? (isImagineJob
              ? (wantsOpenAiDirect
                  ? 'start-prediction-openai-direct'
                  : wantsCopyshotV2
                    ? 'start-prediction-fal-copyshot-v2'
                    : 'start-prediction-fal-copyshot')
              : 'start-prediction-fal')
          : 'start-prediction';
      const providerLabel = isCloudflare ? 'cloudflare' : isFal ? 'fal' : 'replicate';

      console.log(`🔐 Calling edge function: ${edgeFunctionName} (provider: ${providerLabel})`);
      console.log('📦 Request parameters keys:', Object.keys(request.parameters || {}));
      console.log('📦 Has image?', 'image' in (request.parameters || {}));
      console.log('📦 Has images?', 'images' in (request.parameters || {}));

      const response = await fetch(
        `${supabase.supabaseUrl}/functions/v1/${edgeFunctionName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Edge function error:', errorData);

        // Create enhanced error with all details
        // Handle both string and object error formats
        const errorMessage = typeof errorData.error === 'string'
          ? errorData.error
          : errorData.error?.message || 'Failed to start prediction';

        const error: any = new Error(errorMessage);
        error.details = errorData.error?.details || errorData.details;
        error.code = errorData.error?.code;
        // Check both locations for user_key_error (top-level and in metadata)
        error.isUserKeyError = errorData.user_key_error || errorData.error?.metadata?.user_key_error || false;
        error.statusCode = response.status;
        // Preserve provider info for better error messages
        error.isFalError = isFal;

        throw error;
      }

      const responseData = await response.json();

      // Extract data from wrapped response
      if (!responseData.success || !responseData.data) {
        throw new Error(`Invalid response format from ${edgeFunctionName}`);
      }

      const data: StartPredictionResponse = {
        job_id: responseData.data.job_id,
        // Handle both Replicate and Fal response formats
        replicate_id: responseData.data.replicate_id || responseData.data.fal_request_id,
        status: responseData.data.status,
        coins_deducted: responseData.data.coins_reserved || 0,
        remaining_balance: responseData.data.remaining_balance || 0,
      };

      console.log('✅ Prediction started:', {
        job_id: data.job_id,
        replicate_id: data.replicate_id,
        status: data.status,
        coins_deducted: data.coins_deducted,
        remaining_balance: data.remaining_balance
      });

      // The job will be added via Realtime event
      return data;
    } catch (error) {
      console.error('❌ Failed to start prediction:', error);
      throw error;
    }
  }

  /**
   * Download the result of a completed job
   */
  async downloadJobResult(jobId: string): Promise<string | null> {
    await this.ensureInitialized();

    const job = this.jobs.get(jobId);

    if (!job) {
      console.error('❌ Job not found:', jobId);
      return null;
    }

    if (job.status !== 'completed' || !job.resultUrl) {
      console.error('❌ Job not ready for download:', {
        job_id: jobId,
        status: job.status,
        has_result: !!job.resultUrl
      });
      return null;
    }

    if (job.localUri) {
      console.log('✅ Job already downloaded:', jobId);
      return job.localUri;
    }

    if (this.downloadPromises.has(jobId)) {
      return this.downloadPromises.get(jobId)!;
    }

    // Mark downloading here so EVERY caller (incl. reconcileWithQueue, which did
    // not set it) reflects an in-flight download. Without this, a reconcile pass
    // during a slow download sees isDownloading=false and would re-trigger /
    // over-count the download watchdog. performDownload clears it on done/fail.
    job.isDownloading = true;
    this.jobs.set(jobId, job);

    const downloadPromise = new Promise<string | null>((resolve, reject) => {
      this.pendingDownloads.push({ jobId, resolve, reject });
      this.processDownloadQueue();
    });

    this.downloadPromises.set(jobId, downloadPromise);
    return downloadPromise;
  }

  private processDownloadQueue(): void {
    if (this.activeDownloads >= this.options.maxParallelDownloads) {
      return;
    }

    const next = this.pendingDownloads.shift();
    if (!next) {
      return;
    }

    this.activeDownloads += 1;

    this.performDownload(next.jobId)
      .then((result) => next.resolve(result))
      .catch((error) => next.reject(error))
      .finally(() => {
        this.activeDownloads = Math.max(0, this.activeDownloads - 1);
        this.downloadPromises.delete(next.jobId);
        this.processDownloadQueue();
      });
  }

  private async performDownload(jobId: string): Promise<string | null> {
    const job = this.jobs.get(jobId);

    if (!job) {
      // Job was likely removed (e.g., orphaned job cleanup) - this is expected
      console.log(`ℹ️ Job ${jobId.substring(0, 8)} not found (likely removed from queue)`);
      return null;
    }

    if (job.status !== 'completed' || !job.resultUrl) {
      console.error('❌ Job not ready for download:', {
        job_id: jobId,
        status: job.status,
        has_result: !!job.resultUrl
      });
      return null;
    }

    if (job.localUri) {
      console.log(`⏰ [${new Date().toISOString()}] ✅ Job already downloaded:`, jobId);
      return job.localUri;
    }

    try {
      const downloadStartTime = Date.now();
      console.log(`⏰ [${new Date().toISOString()}] ⬇️ Downloading result from:`, job.resultUrl);
      console.log(`⏰ [${new Date().toISOString()}] 📥 Download START for job ${jobId}`);

      // Use generic media downloader that handles both images and videos
      const { downloadMediaToCache } = await import('../utils/imageDownloader');
      const localUri = await downloadMediaToCache(job.resultUrl);
      const downloadEndTime = Date.now();

      console.log(`⏰ [${new Date().toISOString()}] ✅ Download COMPLETE for job ${jobId} (took ${downloadEndTime - downloadStartTime}ms)`);
      console.log(`⏰ [${new Date().toISOString()}] 💾 Setting job.localUri, clearing isDownloading flag, and updating job map...`);

      job.localUri = localUri;
      job.isDownloading = false; // Clear downloading flag
      this.jobs.set(jobId, job);

      // CRITICAL: Persist localUri to database so it's not re-downloaded on app restart
      console.log(`⏰ [${new Date().toISOString()}] 💾 Persisting localUri to database...`);
      const { error: updateError } = await supabase
        .from('generation_queue')
        .update({ local_uri: localUri })
        .eq('id', jobId);

      if (updateError) {
        console.error(`⏰ [${new Date().toISOString()}] ❌ Failed to persist localUri to database:`, updateError);
      } else {
        console.log(`⏰ [${new Date().toISOString()}] ✅ localUri persisted to database`);
      }

      console.log(`⏰ [${new Date().toISOString()}] 📢 Notifying listeners after download complete (isDownloading=false, localUri=EXISTS)`);
      console.log(`⏰ [${new Date().toISOString()}] 📊 Job state NOW: { id: ${jobId}, status: ${job.status}, localUri: EXISTS ✅, isDownloading: false, path: ${localUri.substring(0, 60)}... }`);
      console.log(`⏰ [${new Date().toISOString()}] 🎯 THIS notification should trigger LibraryContext update with 'completed' status and new image`);
      this.notifyListeners();

      console.log(`⏰ [${new Date().toISOString()}] ✅ Downloaded to cache:`, {
        job_id: jobId,
        local_uri: localUri,
        total_time_ms: downloadEndTime - downloadStartTime
      });
      return localUri;
    } catch (error) {
      console.error(`⏰ [${new Date().toISOString()}] ❌ Download failed:`, error);
      // Always clear the downloading flag on failure. The re-download branches
      // in reconcileWithQueue / useCloudQueueGeneration are gated on
      // !isDownloading, so leaving it set here would permanently wedge the job
      // on "Saving to library". Reset it and notify so a retry can run.
      job.isDownloading = false;
      this.jobs.set(jobId, job);
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Get all jobs
   */
  getAllJobs(): QueueJob[] {
    // Note: Returns empty array if not initialized - subscribe() will trigger init
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: QueueJob['status']): QueueJob[] {
    return this.getAllJobs().filter(job => job.status === status);
  }

  /**
   * Get a specific job
   */
  getJob(jobId: string): QueueJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Remove a job from the queue
   * Used to clean up orphaned jobs that have no library entry
   */
  removeJob(jobId: string): boolean {
    const existed = this.jobs.has(jobId);
    if (existed) {
      this.jobs.delete(jobId);

      // Cancel any pending downloads for this job
      this.pendingDownloads = this.pendingDownloads.filter(pending => {
        if (pending.jobId === jobId) {
          pending.reject(new Error('Job removed from queue'));
          return false;
        }
        return true;
      });

      // Remove from download promises
      this.downloadPromises.delete(jobId);

      console.log(`🗑️ QueueManager: Removed job ${jobId.substring(0, 8)} from queue`);
      this.notifyListeners();
    }
    return existed;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const jobs = this.getAllJobs();
    return {
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      total: jobs.length,
    };
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<StartPredictionResponse> {
    await this.ensureInitialized();

    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status !== 'failed') {
      throw new Error('Only failed jobs can be retried');
    }

    // Start a new prediction with the same parameters
    return this.startPrediction({
      model: job.model,
      prompt: job.prompt,
      parameters: job.parameters,
    });
  }

  /**
   * Check prediction status on Replicate for a job
   * Useful for rechecking failed jobs that may have actually completed
   */
  async checkPredictionStatus(jobId: string): Promise<CheckStatusResult> {
    await this.ensureInitialized();

    try {
      console.log(`🔍 Checking prediction status for job ${jobId}...`);

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        return {
          success: false,
          status: 'failed',
          errorMessage: 'No active session',
        };
      }

      const response = await fetch(
        `${supabase.supabaseUrl}/functions/v1/check-prediction-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ jobId }),
        }
      );

      const responseData = await response.json();

      if (!response.ok || !responseData.success) {
        console.error('❌ Check status failed:', responseData);
        return {
          success: false,
          status: 'failed',
          errorMessage: responseData.error?.message || 'Failed to check status',
        };
      }

      const data = responseData.data;
      console.log(`✅ Status check result:`, data);

      // If status was updated to completed, the Realtime subscription
      // will automatically trigger a download
      return {
        success: true,
        status: data.status,
        resultUrl: data.result_url,
        errorMessage: data.error_message,
        alreadyTerminal: data.already_terminal,
      };
    } catch (error) {
      console.error('❌ Error checking prediction status:', error);
      return {
        success: false,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download all completed jobs that don't have localUri yet
   * Useful for cleaning up stuck jobs after app updates or crashes
   *
   * @returns Promise with stats: { total: number, queued: number, alreadyDownloaded: number }
   */
  async downloadAllCompletedJobs(): Promise<{ total: number; queued: number; alreadyDownloaded: number }> {
    await this.ensureInitialized();

    const completedJobs = this.getJobsByStatus('completed');
    const stats = {
      total: completedJobs.length,
      queued: 0,
      alreadyDownloaded: 0,
    };

    console.log(`⏰ [${new Date().toISOString()}] 🧹 Starting cleanup: Found ${completedJobs.length} completed jobs`);

    for (const job of completedJobs) {
      if (job.localUri) {
        stats.alreadyDownloaded++;
        continue;
      }

      if (!job.resultUrl) {
        console.warn(`⏰ [${new Date().toISOString()}] ⚠️ Job ${job.id} is completed but has no resultUrl - skipping`);
        continue;
      }

      stats.queued++;
      console.log(`⏰ [${new Date().toISOString()}] 📥 Queuing download for job ${job.id.substring(0, 8)}`);

      // Queue the download (will be processed by download queue with max parallelism)
      this.downloadJobResult(job.id).catch((error) => {
        console.error(`⏰ [${new Date().toISOString()}] ❌ Cleanup download failed for ${job.id}:`, error);
      });
    }

    console.log(`⏰ [${new Date().toISOString()}] 🧹 Cleanup complete: { total: ${stats.total}, queued: ${stats.queued}, alreadyDownloaded: ${stats.alreadyDownloaded} }`);

    return stats;
  }

  /**
   * Subscribe to job changes
   */
  subscribe(listener: (jobs: QueueJob[]) => void): () => void {
    this.listeners.add(listener);

    // Immediately call with current jobs (may be empty if not initialized)
    listener(this.getAllJobs());

    // Lazy init in background (don't block subscription)
    this.ensureInitialized().then(() => {
      // Notify with loaded jobs after init
      if (this.listeners.has(listener)) {
        listener(this.getAllJobs());
      }
    }).catch(err => {
      console.error('Failed to initialize queue manager:', err);
    });

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of job changes
   */
  private notifyListeners(): void {
    const jobs = this.getAllJobs();
    this.listeners.forEach(listener => {
      try {
        listener(jobs);
      } catch (error) {
        console.error('Error in queue listener:', error);
      }
    });
  }

  /**
   * Listen for app foreground transitions and reconcile queue state.
   *
   * iOS will frequently sever the Supabase Realtime WebSocket while the app
   * is backgrounded. Without this listener, completion events fired during
   * the background period are dropped — the job stays "processing" in
   * memory forever (polling only runs while we still believe a job is
   * active), and any completed-without-localUri job never gets downloaded.
   */
  private setupAppStateListener(): void {
    if (this.appStateSubscription) return;
    this.appStateSubscription = AppState.addEventListener('change', (next) => {
      this.handleAppStateChange(next).catch((err) => {
        console.error('❌ QueueManager: AppState handler failed:', err);
      });
    });
  }

  private async handleAppStateChange(next: AppStateStatus): Promise<void> {
    const prev = this.lastAppState;
    this.lastAppState = next;

    const wasBackgrounded = prev === 'background' || prev === 'inactive';
    if (next !== 'active' || !wasBackgrounded) return;
    if (this.isReconciling) return;

    this.isReconciling = true;
    try {
      console.log('☀️ QueueManager: App foregrounded — reconciling queue state');

      // Tear down and rebuild the Realtime channel. iOS often leaves the
      // socket in a "looks-connected but dead" state after backgrounding;
      // a fresh subscription is the safest way to start receiving events.
      try {
        if (this.subscription) {
          await this.subscription.unsubscribe();
          this.subscription = null;
        }
        await this.startRealtimeSync();
      } catch (err) {
        console.error('❌ QueueManager: Failed to restart Realtime on foreground:', err);
      }

      // loadJobs() refetches the last 24h of jobs from Supabase and
      // auto-downloads anything completed-without-localUri, which is
      // exactly the reconciliation we need.
      await this.loadJobs();
    } finally {
      this.isReconciling = false;
    }
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('🔄 QueueManager: Polling stopped');
    }
  }

  /**
   * Stop Realtime sync
   */
  async stopSync(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
      console.log('Realtime sync stopped');
    }
    this.stopPolling();
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    await this.stopSync();
    this.stopPolling();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.jobs.clear();
    this.listeners.clear();
    console.log('QueueManager cleaned up');
  }
}

// Export singleton instance
export const queueManager = QueueManager.getInstance();
