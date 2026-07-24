/**
 * Video Tab Model Configuration
 *
 * Models available in the Video tab for text-to-video and image-to-video generation.
 * Includes tag-based filtering for different model capabilities.
 */

export const VIDEO_MODELS = [
  'kling-v2.5-turbo-pro',
  'veo-3.1-fast',
  'seedance-1-pro-fast',
  'pixverse-v5',
] as const;

export type VideoModelId = typeof VIDEO_MODELS[number];

// Tag types for filtering models
export type VideoModelTag = 'all' | 'text to video' | 'image to video' | 'fast' | 'high quality';

// Model to tags mapping
export const VIDEO_MODEL_TAGS: Record<VideoModelId, VideoModelTag[]> = {
  'kling-v2.5-turbo-pro': ['text to video', 'image to video', 'high quality'],
  'veo-3.1-fast': ['text to video', 'image to video', 'fast', 'high quality'],
  'seedance-1-pro-fast': ['text to video', 'image to video', 'fast'],
  'pixverse-v5': ['text to video', 'image to video', 'fast'],
};

export const ALL_VIDEO_TAGS: VideoModelTag[] = ['all', 'text to video', 'image to video', 'fast', 'high quality'];

// Model configuration
export interface VideoModelConfig {
  id: VideoModelId;
  name: string;
  description: string;
  durations: number[];
  defaultDuration: number;
  aspectRatios: string[];
  defaultAspectRatio: string;
  resolutions?: string[];
  defaultResolution?: string;
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  requiresImage: boolean;
  supportsAudio?: boolean;
  defaultAudio?: boolean;
}

export const VIDEO_MODEL_CONFIGS: Record<VideoModelId, VideoModelConfig> = {
  'kling-v2.5-turbo-pro': {
    id: 'kling-v2.5-turbo-pro',
    name: 'Kling 2.5 Turbo Pro',
    description: 'Kuaishou AI - High quality motion & detail',
    durations: [5, 10],
    defaultDuration: 5,
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    supportsFirstFrame: true,
    supportsLastFrame: false,
    requiresImage: false,
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    name: 'Veo 3.1 Fast',
    description: 'Google - Fast with audio generation',
    durations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    supportsFirstFrame: true,
    supportsLastFrame: true,
    requiresImage: false,
    supportsAudio: true,
    defaultAudio: true,
  },
  'seedance-1-pro-fast': {
    id: 'seedance-1-pro-fast',
    name: 'Seedance 1 Pro Fast',
    description: 'ByteDance - Wide aspect ratio support',
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    defaultDuration: 5,
    aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', '9:21'],
    defaultAspectRatio: '16:9',
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '1080p',
    supportsFirstFrame: true,
    supportsLastFrame: false,
    requiresImage: false,
  },
  'pixverse-v5': {
    id: 'pixverse-v5',
    name: 'PixVerse v5',
    description: 'Anime & character optimized with effects',
    durations: [5, 8],
    defaultDuration: 5,
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    resolutions: ['360p', '540p', '720p', '1080p'],
    defaultResolution: '720p',
    supportsFirstFrame: true,
    supportsLastFrame: true,
    requiresImage: false,
  },
};

/**
 * Get models filtered by tags
 */
export function getVideoModelsForTags(tags: VideoModelTag[]): VideoModelId[] {
  // If 'all' is selected or no tags, return all models
  if (tags.length === 0 || tags.includes('all')) {
    return [...VIDEO_MODELS];
  }

  return VIDEO_MODELS.filter(model => {
    const modelTags = VIDEO_MODEL_TAGS[model];
    return tags.some(tag => modelTags.includes(tag));
  });
}

/**
 * Get display name for model
 */
export function getVideoModelDisplayName(modelId: VideoModelId): string {
  return VIDEO_MODEL_CONFIGS[modelId]?.name || modelId;
}

/**
 * Get description for model
 */
export function getVideoModelDescription(modelId: VideoModelId): string {
  return VIDEO_MODEL_CONFIGS[modelId]?.description || '';
}

/**
 * Get model config
 */
export function getVideoModelConfig(modelId: VideoModelId): VideoModelConfig | undefined {
  return VIDEO_MODEL_CONFIGS[modelId];
}
