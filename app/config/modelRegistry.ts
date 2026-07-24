/**
 * ⚠️  FALLBACK ONLY - DO NOT ADD NEW MODELS HERE  ⚠️
 *
 * SINGLE SOURCE OF TRUTH: Supabase `models` table
 * See: docs/.adding-new-model.md
 *
 * This file is ONLY used as a fallback when:
 * - Supabase is unreachable
 * - Network is offline
 * - Database fetch fails
 *
 * All new models should be added to Supabase tables:
 * - `models` - UI configuration
 * - `model_configs` - API configuration
 * - `model_pricing` - Pricing
 *
 * This registry is used by legacy recipe/editor code that
 * still relies on getReplicateModelConfig(). Those components
 * will eventually be migrated to use Supabase directly.
 */

export interface ReplicateModelConfig {
  id: string;
  name: string;
  description: string;
  category?: string;

  // Validation
  requiresReferenceImages?: boolean;
  minReferenceImages?: number;
  maxReferenceImages?: number;

  // Parameter definitions
  defaultParameters?: Record<string, any>;

  // Image parameter mapping - how to pass images to this model's API
  imageParameterName?: 'image_input' | 'reference_images' | 'image';

  // Metadata extraction function - extracts top-level metadata from options
  extractMetadata?: (options: any, referenceImages?: string[]) => Record<string, any>;
}

export const REPLICATE_MODEL_REGISTRY: Record<string, ReplicateModelConfig> = {

  // Nano Banana - Google's fast text-to-image
  'nano-banana': {
    id: 'nano-banana',
    name: 'Nano Banana (Google)',
    description: 'Fast text-to-image generation',
    category: 'image',
    requiresReferenceImages: false,
    maxReferenceImages: 10,
    imageParameterName: 'image_input',
    defaultParameters: {
      aspect_ratio: '9:16',
      output_format: 'jpg',
    },
    extractMetadata: (options: any) => ({
      aspectRatio: options.aspect_ratio,
      numImages: options.num_images,
      outputFormat: options.output_format,
    }),
  },

  // Nano Banana Pro 2K - Google's advanced model with text rendering
  'nano-banana-pro-2k': {
    id: 'nano-banana-pro-2k',
    name: 'Nano Banana Pro 2K',
    description: 'Studio-quality text-to-image with legible text • Multi-language support • 2K resolution',
    category: 'image',
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    imageParameterName: 'image_input',
    defaultParameters: {
      resolution: '2K',
      aspect_ratio: '9:16',
      output_format: 'png',
      safety_filter: 'block_medium_and_above',
    },
    extractMetadata: (options: any) => ({
      resolution: options.resolution || '2K',
      aspectRatio: options.aspect_ratio,
      outputFormat: options.output_format,
      safetyFilter: options.safety_filter,
    }),
  },

  // Nano Banana Pro 4K - Google's advanced model with 4K output
  'nano-banana-pro-4k': {
    id: 'nano-banana-pro-4k',
    name: 'Nano Banana Pro 4K',
    description: 'Studio-quality text-to-image with legible text • Multi-language support • 4K resolution',
    category: 'image',
    requiresReferenceImages: false,
    maxReferenceImages: 14,
    imageParameterName: 'image_input',
    defaultParameters: {
      resolution: '4K',
      aspect_ratio: '9:16',
      output_format: 'png',
      safety_filter: 'block_medium_and_above',
    },
    extractMetadata: (options: any) => ({
      resolution: options.resolution || '4K',
      aspectRatio: options.aspect_ratio,
      outputFormat: options.output_format,
      safetyFilter: options.safety_filter,
    }),
  },

  // Ideogram v3 Balanced
  'ideogram-v3-balanced': {
    id: 'ideogram-v3-balanced',
    name: 'Ideogram v3 Balanced',
    description: 'Stunning realism with style presets and optional reference images',
    category: 'image',
    maxReferenceImages: 10,
    imageParameterName: 'reference_images',
    defaultParameters: {
      aspect_ratio: 'match_input_image',
      style_type: 'Auto',
      magic_prompt_option: 'Auto',
    },
    extractMetadata: (options: any) => ({
      aspectRatio: options.aspect_ratio,
      resolution: options.resolution,
      styleType: options.style_type,
      stylePreset: options.style_preset,
      magicPrompt: options.magic_prompt_option,
      seed: options.seed,
    }),
  },

  // Ideogram Character
  'ideogram-character': {
    id: 'ideogram-character',
    name: 'Ideogram Character',
    description: 'Generate consistent characters from a single reference image',
    category: 'image',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 1,
    imageParameterName: 'reference_images',
    defaultParameters: {
      style_type: 'Auto',
      aspect_ratio: 'match_input_image',
      rendering_speed: 'Default',
      magic_prompt_option: 'Auto',
    },
    extractMetadata: (options: any) => ({
      styleType: options.style_type,
      aspectRatio: options.aspect_ratio,
      resolution: options.resolution,
      renderingSpeed: options.rendering_speed,
      magicPrompt: options.magic_prompt_option,
      seed: options.seed,
    }),
  },

  // Runway Gen-4 Image
  'gen4-image': {
    id: 'gen4-image',
    name: 'Runway Gen-4 Image',
    description: 'Reference-based image generation with up to 3 images for character consistency',
    category: 'image',
    maxReferenceImages: 3,
    imageParameterName: 'reference_images',
    defaultParameters: {
      resolution: '720p',
      aspect_ratio: 'match_input_image',
    },
    extractMetadata: (options: any) => ({
      resolution: options.resolution,
      aspectRatio: options.aspect_ratio,
      seed: options.seed,
      referenceTags: options.reference_tags,
    }),
  },

  // Google Imagen 4 - Text-to-image with superior clarity
  'imagen-4': {
    id: 'imagen-4',
    name: 'Google Imagen 4',
    description: 'Superior clarity with enhanced text rendering • 2K resolution',
    category: 'image',
    requiresReferenceImages: false,
    defaultParameters: {
      aspect_ratio: '1:1',
      output_format: 'jpg',
      safety_filter_level: 'block_only_high',
    },
    extractMetadata: (options: any) => ({
      aspectRatio: options.aspect_ratio,
      outputFormat: options.output_format,
      safetyFilterLevel: options.safety_filter_level,
    }),
  },

  // Reve Create - Text-to-image
  'reve-create': {
    id: 'reve-create',
    name: 'Reve Create',
    description: 'Fast text-to-image generation',
    category: 'image',
    imageParameterName: 'image_input',
    defaultParameters: {
      aspect_ratio: '1:1',
    },
    extractMetadata: (options: any) => ({
      aspectRatio: options.aspect_ratio || '1:1',
    }),
  },

  // Reve Remix - Image blending
  'reve-remix': {
    id: 'reve-remix',
    name: 'Reve Remix',
    description: 'Intelligently blend 1-4 reference images',
    category: 'image',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 4,
    imageParameterName: 'reference_images',
    defaultParameters: {
      aspect_ratio: 'match_input_image',
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      referenceImageCount: referenceImages?.length || 0,
      aspectRatio: options.aspect_ratio || '3:2',
    }),
  },

  // Reve Edit - Natural language editing
  'reve-edit': {
    id: 'reve-edit',
    name: 'Reve Edit',
    description: 'Natural language editing for precise modifications • 4K quality',
    category: 'image',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 1,
    imageParameterName: 'image_input',
    defaultParameters: {
      aspect_ratio: 'match_input_image',
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      referenceImageCount: referenceImages?.length || 0,
      aspectRatio: options.aspect_ratio || 'match_input_image',
    }),
  },

  // Seedream 4.0 - Fast generation (via Replicate)
  'seedream': {
    id: 'seedream',
    name: 'Seedream 4.0',
    description: 'Fast 4K image generation with reference image support (1-10 images)',
    category: 'image',
    maxReferenceImages: 10,
    imageParameterName: 'image_input',
    defaultParameters: {
      aspect_ratio: 'match_input_image',
      num_images: 1,
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      referenceImageCount: referenceImages?.length || 0,
      aspectRatio: options.aspect_ratio || '1:1',
      numImages: options.num_images || 1,
    }),
  },

  // Qwen Image Edit Plus - Multi-image editing
  'qwen-image-edit-plus': {
    id: 'qwen-image-edit-plus',
    name: 'Qwen Image Edit Plus',
    description: 'Precise control over text, people, and products with multi-image editing',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 10,
    imageParameterName: 'image_input',
    defaultParameters: {
      go_fast: true,
      aspect_ratio: 'match_input_image',
      output_format: 'webp',
      output_quality: 95,
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      referenceImageCount: referenceImages?.length || 0,
      aspectRatio: options.aspect_ratio || 'match_input_image',
      outputFormat: options.output_format || 'webp',
      outputQuality: options.output_quality || 95,
      goFast: options.go_fast !== false,
    }),
  },

  // Background Remover
  'background-remover': {
    id: 'background-remover',
    name: 'Background Remover',
    description: 'Remove backgrounds from images',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 10,
    defaultParameters: {},
    extractMetadata: () => ({}),
  },

  // Real-ESRGAN - Fast upscaling
  'real-esrgan': {
    id: 'real-esrgan',
    name: 'Real-ESRGAN',
    description: 'Fast 2x-4x image upscaling',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 10,
    defaultParameters: {
      scale: 4,
      face_enhance: false,
    },
    extractMetadata: (options: any) => ({
      scale: options.scale || 4,
      faceEnhance: options.face_enhance || false,
    }),
  },

  // Recraft Crisp Upscale - Quality upscaling
  'recraft-crisp-upscale': {
    id: 'recraft-crisp-upscale',
    name: 'Recraft Crisp Upscale',
    description: 'High-quality upscaling up to 4K',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 1,
    defaultParameters: {},
    extractMetadata: () => ({}),
  },

  // High-Resolution ControlNet - 4K upscaling
  'high-resolution-controlnet': {
    id: 'high-resolution-controlnet',
    name: 'ControlNet Tile',
    description: '4K upscaling with ControlNet',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 1,
    defaultParameters: {
      resolution: 2560,
      resemblance: 0.85,
      creativity: 0.35,
      steps: 8,
    },
    extractMetadata: (options: any) => ({
      resolution: options.resolution || 2560,
      resemblance: options.resemblance || 0.85,
      creativity: options.creativity || 0.35,
      steps: options.steps || 8,
    }),
  },

  // Topaz Image Upscale - Professional upscaling
  'topaz-image-upscale': {
    id: 'topaz-image-upscale',
    name: 'Topaz Upscale',
    description: 'Professional upscaling up to 22K',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 10,
    defaultParameters: {
      enhance_model: 'Standard V2',
      upscale_factor: '2x',
      face_enhancement: false,
    },
    extractMetadata: (options: any) => ({
      enhanceModel: options.enhance_model || 'Standard V2',
      upscaleFactor: options.upscale_factor || '2x',
      faceEnhancement: options.face_enhancement || false,
    }),
  },

  // Crystal Upscaler - Sharp upscaling
  'crystal-upscaler': {
    id: 'crystal-upscaler',
    name: 'Crystal Upscaler',
    description: 'Sharp image upscaling',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 10,
    defaultParameters: {
      scale_factor: 2,
    },
    extractMetadata: (options: any) => ({
      scaleFactor: options.scale_factor || 2,
    }),
  },

  // Ultimate SD Upscale - Detailed upscaling
  'ultimate-sd-upscale': {
    id: 'ultimate-sd-upscale',
    name: 'Ultimate SD Upscale',
    description: 'Detailed upscaling with Stable Diffusion',
    requiresReferenceImages: true,
    minReferenceImages: 1,
    maxReferenceImages: 1,
    defaultParameters: {
      upscale_by: 2,
      upscaler: '4x-UltraSharp',
      denoise: 0.2,
      steps: 20,
    },
    extractMetadata: (options: any) => ({
      upscaleBy: options.upscale_by || 2,
      upscaler: options.upscaler || '4x-UltraSharp',
      denoise: options.denoise || 0.2,
      steps: options.steps || 20,
    }),
  },

  // ===== VIDEO MODELS =====

  // Kling 2.5 Turbo Pro - High quality video generation
  'kling-v2.5-turbo-pro': {
    id: 'kling-v2.5-turbo-pro',
    name: 'Kling 2.5 Turbo Pro',
    description: 'High quality motion & detail video generation',
    category: 'video',
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    imageParameterName: 'image',
    defaultParameters: {
      duration: 5,
      aspect_ratio: '16:9',
      guidance_scale: 0.5,
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      type: 'video',
      duration: options.duration || 5,
      aspectRatio: options.aspect_ratio || '16:9',
      guidanceScale: options.guidance_scale || 0.5,
      hasFirstFrame: (referenceImages?.length || 0) > 0,
    }),
  },

  // Veo 3.1 Fast - Google's fast video generation with audio
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    name: 'Veo 3.1 Fast',
    description: 'Google - Fast video with optional audio generation',
    category: 'video',
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    imageParameterName: 'image',
    defaultParameters: {
      duration: 8,
      aspect_ratio: '16:9',
      resolution: '1080p',
      generate_audio: true,
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      type: 'video',
      duration: options.duration || 8,
      aspectRatio: options.aspect_ratio || '16:9',
      resolution: options.resolution || '1080p',
      generateAudio: options.generate_audio !== false,
      hasFirstFrame: (referenceImages?.length || 0) > 0,
      hasLastFrame: !!options.last_frame,
    }),
  },

  // Seedance 1 Pro Fast - ByteDance video generation
  'seedance-1-pro-fast': {
    id: 'seedance-1-pro-fast',
    name: 'Seedance 1 Pro Fast',
    description: 'ByteDance - Wide aspect ratio support',
    category: 'video',
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    imageParameterName: 'image',
    defaultParameters: {
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '1080p',
      camera_fixed: false,
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      type: 'video',
      duration: options.duration || 5,
      aspectRatio: options.aspect_ratio || '16:9',
      resolution: options.resolution || '1080p',
      cameraFixed: options.camera_fixed || false,
      hasFirstFrame: (referenceImages?.length || 0) > 0,
    }),
  },

  // PixVerse v5 - Anime & character optimized
  'pixverse-v5': {
    id: 'pixverse-v5',
    name: 'PixVerse v5',
    description: 'Anime & character optimized with effects',
    category: 'video',
    requiresReferenceImages: false,
    maxReferenceImages: 1,
    imageParameterName: 'image',
    defaultParameters: {
      duration: 5,
      aspect_ratio: '16:9',
      quality: '720p',
    },
    extractMetadata: (options: any, referenceImages?: string[]) => ({
      type: 'video',
      duration: options.duration || 5,
      aspectRatio: options.aspect_ratio || '16:9',
      quality: options.quality || '720p',
      effect: options.effect,
      hasFirstFrame: (referenceImages?.length || 0) > 0,
      hasLastFrame: !!options.last_frame_image,
    }),
  },

};

/**
 * Get Replicate model configuration by ID
 */
export function getReplicateModelConfig(modelId: string): ReplicateModelConfig | undefined {
  return REPLICATE_MODEL_REGISTRY[modelId];
}

/**
 * Validate reference images for a Replicate model
 */
export function validateReferenceImages(
  modelId: string,
  referenceImages: string[]
): { valid: boolean; error?: string } {
  const config = getReplicateModelConfig(modelId);

  if (!config) {
    return { valid: false, error: `Unknown model: ${modelId}` };
  }

  if (config.requiresReferenceImages && referenceImages.length === 0) {
    return {
      valid: false,
      error: `${config.name} requires at least ${config.minReferenceImages || 1} reference image(s)`
    };
  }

  if (config.minReferenceImages && referenceImages.length < config.minReferenceImages) {
    return {
      valid: false,
      error: `${config.name} requires at least ${config.minReferenceImages} reference image(s)`
    };
  }

  if (config.maxReferenceImages && referenceImages.length > config.maxReferenceImages) {
    return {
      valid: false,
      error: `${config.name} supports up to ${config.maxReferenceImages} reference image(s)`
    };
  }

  return { valid: true };
}

/**
 * Get all Replicate model IDs
 */
export function getAllReplicateModelIds(): string[] {
  return Object.keys(REPLICATE_MODEL_REGISTRY);
}
