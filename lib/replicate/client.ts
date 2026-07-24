/**
 * Replicate API Client for Seedream-4 (ByteDance)
 *
 * Official Documentation: https://replicate.com/bytedance/seedream-4
 * API Reference: https://replicate.com/docs/reference/http
 *
 * MODEL PARAMETERS (Seedream-4):
 *
 * Required Parameters:
 * - image: string - Base64-encoded image for transformation
 * - prompt: string - Text description of desired changes
 *
 * Image Constraints:
 * - Maximum base64 size: ~700 KB (to avoid 502 errors)
 * - Recommended dimensions: 768-896px width
 * - Format: JPEG (automatically converted)
 * - Compression: Adaptive (80% for first attempt, 75% if needed)
 *
 * Optimization Strategy:
 * - Step 1: Resize to 896px @ 80% quality
 * - Step 2: If > 800KB, resize to 768px @ 75% quality
 * - Target: ≤ 700 KB base64 size
 *
 * API Workflow:
 * 1. Create prediction with image + prompt
 * 2. Poll prediction status (1s intervals)
 * 3. Retrieve output image URL when complete
 * 4. Maximum wait time: 60 seconds
 *
 * Features:
 * - Image-to-image transformation
 * - High-quality output
 * - Async prediction-based API
 * - Automatic status polling
 */

import axios from 'axios';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { downloadAsync } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

const REPLICATE_API_KEY = process.env.EXPO_PUBLIC_REPLICATE_API_TOKEN;
const REPLICATE_API_URL = 'https://api.replicate.com/v1';

// Model configurations
interface ModelConfig {
  version: string;
  name: string;
  prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => Record<string, any>;
}

interface NanoBananaOptions {
  aspect_ratio?: string;
  num_images?: number;
  output_format?: 'jpg' | 'png';
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'seedream': {
    version: 'e6cff243d7a5e551e1ca2b4bf291413d649c9f1417f9a52c1c0a4fbc36027b83',
    name: 'Seedream-4 (ByteDance)',
    prepareInput: (image: string | string[], prompt: string) => ({
      image_input: Array.isArray(image) ? image : [image], // Seedream 4 uses image_input array (1-10 images for reference)
      prompt: prompt, // Note: Seedream-4 generates NEW images based on references, doesn't edit
    }),
  },
  'seededit-3': {
    version: '736877ab1959c13ed48802383eeaf4b36d218be8af72fb2152594026a7f7a2df',
    name: 'SeedEdit 3.0 (ByteDance)',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      // SeedEdit only supports single image, take first if array
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        image: singleImage, // SeedEdit uses single 'image' parameter
        prompt: prompt, // Edit instruction (2-500 characters)
      };

      // Add optional parameters if provided
      if (options?.guidance_scale !== undefined) {
        input.guidance_scale = options.guidance_scale; // 1-10, default 5.5
      }
      if (options?.seed !== undefined) {
        input.seed = options.seed; // For reproducibility
      }
      if (options?.enable_base64_output !== undefined) {
        input.enable_base64_output = options.enable_base64_output;
      }

      return input;
    },
  },
  'nano-banana': {
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0',
    name: 'Nano Banana (Google)',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        image_input: Array.isArray(image) ? image : [image], // Nano Banana expects an array of images
        prompt: `Edit the provided image: ${prompt}`, // Explicitly tell model to edit
        output_format: options?.output_format || 'jpg',
      };

      // Add optional parameters if provided
      if (options?.aspect_ratio) {
        input.aspect_ratio = options.aspect_ratio;
      }
      if (options?.num_images) {
        input.num_images = options.num_images;
      }

      return input;
    },
  },
  'background-remover': {
    version: 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
    name: 'Background Remover (851 Labs)',
    prepareInput: (image: string | string[]) => {
      // Background remover only supports single image, take first if array
      const singleImage = Array.isArray(image) ? image[0] : image;
      return {
        image: singleImage, // Background remover only needs the image, no prompt required
      };
    },
  },
  'flux-kontext-multi-2': {
    version: 'flux-kontext-apps/multi-image-kontext-pro', // Using model identifier directly
    name: 'FLUX.1 Kontext Pro (2 Images)',
    prepareInput: (image: string | string[], prompt: string) => {
      // FLUX Kontext Multi Pro supports exactly 2 images
      const images = Array.isArray(image) ? image : [image];
      if (images.length !== 2) {
        throw new Error('FLUX Kontext Pro requires exactly 2 images');
      }
      return {
        input_image_1: images[0], // First reference image
        input_image_2: images[1], // Second reference image
        prompt: prompt, // Text instruction for combining/editing images
      };
    },
  },
  'flux-kontext-multi-4': {
    version: 'flux-kontext-apps/multi-image-list', // Using model identifier directly
    name: 'FLUX.1 Kontext Max (Up to 4 Images)',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      // FLUX Kontext List supports 1-4 images
      const images = Array.isArray(image) ? image : [image];
      if (images.length < 1 || images.length > 4) {
        throw new Error('FLUX Kontext List requires 1-4 images');
      }

      // multi-image-list expects input_images as an array
      const input: Record<string, any> = {
        prompt,
        input_images: images, // Pass as array
      };

      // Add optional parameters if provided
      if (options?.output_format) {
        input.output_format = options.output_format;
      }
      if (options?.aspect_ratio) {
        input.aspect_ratio = options.aspect_ratio;
      }
      if (options?.seed !== undefined) {
        input.seed = options.seed;
      }
      if (options?.safety_tolerance !== undefined) {
        input.safety_tolerance = options.safety_tolerance;
      }

      return input;
    },
  },
  'flux-kontext-pro': {
    version: 'black-forest-labs/flux-kontext-pro',
    name: 'FLUX Kontext Pro (Black Forest Labs)',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        prompt,
        input_image: singleImage, // Single image for editing
      };

      // Add optional parameters
      if (options?.seed !== undefined) {
        input.seed = options.seed;
      }
      if (options?.aspect_ratio !== undefined) {
        input.aspect_ratio = options.aspect_ratio; // default: "match_input_image"
      }
      if (options?.output_format !== undefined) {
        input.output_format = options.output_format; // default: "png"
      }
      if (options?.safety_tolerance !== undefined) {
        input.safety_tolerance = options.safety_tolerance; // 0-6, default: 2, max 2 with input images
      }
      if (options?.prompt_upsampling !== undefined) {
        input.prompt_upsampling = options.prompt_upsampling; // default: false
      }

      return input;
    },
  },
  'codeplugtech-faceswap': {
    version: 'codeplugtech/face-swap',
    name: 'CodePlugTech Face Swap',
    prepareInput: (image: string | string[]) => {
      // Face swap requires exactly 2 images: source face and target image
      const images = Array.isArray(image) ? image : [image];
      if (images.length !== 2) {
        throw new Error('Face swap requires exactly 2 images: source face and target image');
      }
      return {
        input_image: images[0], // Face to extract
        swap_image: images[1], // Face to replace
      };
    },
  },
  'cdingram-faceswap': {
    version: 'cdingram/face-swap',
    name: 'cdingram Face Swap',
    prepareInput: (image: string | string[]) => {
      // Face swap requires exactly 2 images: source face and target image
      const images = Array.isArray(image) ? image : [image];
      if (images.length !== 2) {
        throw new Error('Face swap requires exactly 2 images: source face and target image');
      }
      // cdingram/face-swap uses 'input_image' and 'swap_image' parameters
      return {
        input_image: images[0], // Face to extract (source face)
        swap_image: images[1], // Face to replace (target image)
      };
    },
  },
  // Upscaling models
  'real-esrgan': {
    version: 'nightmareai/real-esrgan',
    name: 'Real-ESRGAN',
    prepareInput: (image: string | string[], _prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      return {
        image: singleImage,
        scale: options?.scale || 4, // 2x or 4x
        face_enhance: options?.face_enhance !== false, // Default true
      };
    },
  },
  'recraft-crisp-upscale': {
    version: 'recraft-ai/recraft-crisp-upscale',
    name: 'Recraft Crisp Upscale',
    prepareInput: (image: string | string[], _prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      return {
        image: singleImage,
        scale: options?.scale || 4, // 2x or 4x
      };
    },
  },
  'high-resolution-controlnet': {
    version: 'batouresearch/high-resolution-controlnet-tile',
    name: 'High Resolution ControlNet Tile',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        image: singleImage,
        prompt: prompt || 'high quality, 4K, detailed',
      };

      // Add optional parameters if provided
      if (options?.resolution !== undefined) input.resolution = options.resolution;
      if (options?.resemblance !== undefined) input.resemblance = options.resemblance;
      if (options?.creativity !== undefined) input.creativity = options.creativity;
      if (options?.steps !== undefined) input.steps = options.steps;

      return input;
    },
  },
  'topaz-image-upscale': {
    version: 'topazlabs/image-upscale',
    name: 'Topaz Image Upscale',
    prepareInput: (image: string | string[], _prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        image: singleImage,
      };

      // upscale_factor must be a string like "2x", "4x", "6x"
      if (options?.upscale_factor) {
        const factor = options.upscale_factor;
        input.upscale_factor = typeof factor === 'string' ? factor : `${factor}x`;
      } else {
        input.upscale_factor = '2x';
      }

      // Add optional parameters if provided
      if (options?.enhance_model) input.enhance_model = options.enhance_model;
      if (options?.output_format) input.output_format = options.output_format;
      if (options?.subject_detection) input.subject_detection = options.subject_detection;
      if (options?.face_enhancement !== undefined) input.face_enhancement = options.face_enhancement;
      if (options?.face_enhancement_creativity !== undefined) input.face_enhancement_creativity = options.face_enhancement_creativity;
      if (options?.face_enhancement_strength !== undefined) input.face_enhancement_strength = options.face_enhancement_strength;

      return input;
    },
  },
  'crystal-upscaler': {
    version: 'philz1337x/crystal-upscaler',
    name: 'Crystal Upscaler',
    prepareInput: (image: string | string[], _prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      return {
        image: singleImage,
        scale_factor: options?.scale_factor || 2, // Upscale factor
      };
    },
  },
  'ultimate-sd-upscale': {
    version: 'fewjative/ultimate-sd-upscale',
    name: 'Ultimate SD Upscale',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        image: singleImage,
        positive_prompt: prompt || 'high quality, detailed',
      };

      // Add optional parameters if provided
      if (options?.upscale_by !== undefined) input.upscale_by = options.upscale_by;
      if (options?.upscaler) input.upscaler = options.upscaler;
      if (options?.use_controlnet_tile !== undefined) input.use_controlnet_tile = options.use_controlnet_tile;
      if (options?.controlnet_strength !== undefined) input.controlnet_strength = options.controlnet_strength;
      if (options?.steps !== undefined) input.steps = options.steps;
      if (options?.cfg !== undefined) input.cfg = options.cfg;
      if (options?.denoise !== undefined) input.denoise = options.denoise;
      if (options?.sampler_name) input.sampler_name = options.sampler_name;
      if (options?.scheduler) input.scheduler = options.scheduler;

      return input;
    },
  },

  // Runway Gen-4 Image
  'gen4-image': {
    version: 'runwayml/gen4-image',
    name: 'Runway Gen-4 Image',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        prompt,
      };

      // Add reference images if provided (up to 3)
      if (image) {
        const images = Array.isArray(image) ? image : [image];
        if (images.length > 0) {
          if (images.length > 3) {
            throw new Error('Gen-4 Image supports up to 3 reference images');
          }
          input.reference_images = images;
        }
      }

      // Add optional parameters
      if (options?.resolution) input.resolution = options.resolution;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.seed !== undefined) input.seed = options.seed;
      if (options?.reference_tags) input.reference_tags = options.reference_tags;

      return input;
    },
  },

  // Ideogram models
  'ideogram-v3-balanced': {
    version: 'ideogram-ai/ideogram-v3-balanced',
    name: 'Ideogram v3 Balanced',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        prompt,
      };

      // Add optional parameters
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.resolution) input.resolution = options.resolution;
      if (options?.style_type) input.style_type = options.style_type;
      if (options?.style_preset) input.style_preset = options.style_preset;
      if (options?.magic_prompt_option !== undefined) input.magic_prompt_option = options.magic_prompt_option;
      if (options?.seed !== undefined) input.seed = options.seed;

      // Add style reference images if provided
      if (image) {
        const images = Array.isArray(image) ? image : [image];
        if (images.length > 0) {
          input.style_reference_images = images;
        }
      }

      // Inpainting support
      if (options?.inpainting_image) input.inpainting_image = options.inpainting_image;
      if (options?.inpainting_mask) input.inpainting_mask = options.inpainting_mask;

      return input;
    },
  },
  'ideogram-character': {
    version: 'ideogram-ai/ideogram-character',
    name: 'Ideogram Character',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      // Character model requires exactly one character reference image
      const singleImage = Array.isArray(image) ? image[0] : image;
      if (!singleImage) {
        throw new Error('Ideogram Character requires at least one character reference image');
      }

      const input: Record<string, any> = {
        prompt,
        character_reference_image: singleImage,
      };

      // Add optional parameters
      if (options?.style_type) input.style_type = options.style_type;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.resolution) input.resolution = options.resolution;
      if (options?.rendering_speed) input.rendering_speed = options.rendering_speed;
      if (options?.magic_prompt_option !== undefined) input.magic_prompt_option = options.magic_prompt_option;
      if (options?.seed !== undefined) input.seed = options.seed;

      // Inpainting support
      if (options?.inpainting_image) input.inpainting_image = options.inpainting_image;
      if (options?.inpainting_mask) input.inpainting_mask = options.inpainting_mask;

      return input;
    },
  },

  // Video generation models
  'kling-v2.0': {
    version: 'kwaivgi/kling-v2.0',
    name: 'Kling v2.0',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        prompt,
      };

      // Add optional parameters
      if (options?.duration !== undefined) input.duration = options.duration;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.cfg_scale !== undefined) input.cfg_scale = options.cfg_scale;
      if (options?.negative_prompt) input.negative_prompt = options.negative_prompt;

      // Add start image if provided
      if (image && !Array.isArray(image)) {
        input.start_image = image;
      }

      return input;
    },
  },
  'veo-3-fast': {
    version: 'google/veo-3-fast',
    name: 'Veo 3 Fast',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        prompt,
      };

      // Add optional parameters
      if (options?.duration !== undefined) input.duration = options.duration;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.resolution) input.resolution = options.resolution;
      if (options?.generate_audio !== undefined) input.generate_audio = options.generate_audio;
      if (options?.negative_prompt) input.negative_prompt = options.negative_prompt;
      if (options?.seed !== undefined) input.seed = options.seed;

      // Add image if provided
      if (image && !Array.isArray(image)) {
        input.image = image;
      }

      return input;
    },
  },
  'gen4-turbo': {
    version: 'runwayml/gen4-turbo',
    name: 'Runway Gen-4 Turbo',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        prompt,
        image: singleImage, // Required for Gen-4 Turbo
      };

      // Add optional parameters
      if (options?.duration !== undefined) input.duration = options.duration;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.seed !== undefined) input.seed = options.seed;

      return input;
    },
  },
  'omni-human': {
    version: 'bytedance/omni-human',
    name: 'Omni-Human',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      if (!singleImage) {
        throw new Error('Omni-Human requires an image containing a human subject');
      }
      if (!options?.audio) {
        throw new Error('Omni-Human requires an audio file');
      }

      const input: Record<string, any> = {
        image: singleImage, // Required: image with human subject
        audio: options.audio, // Required: audio file URI
      };

      // Prompt is optional for Omni-Human
      if (prompt && prompt !== 'Generate video from image and audio') {
        input.prompt = prompt;
      }

      return input;
    },
  },
  'reve-create': {
    version: 'reve/create',
    name: 'Reve Create',
    prepareInput: (_image: string | string[], prompt: string, options?: Record<string, any>) => {
      const input: Record<string, any> = {
        prompt,
      };

      // Add optional parameters
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.seed !== undefined) input.seed = options.seed;
      if (options?.version) input.version = options.version;

      return input;
    },
  },
  'reve-edit': {
    version: 'reve/edit',
    name: 'Reve Edit',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      const singleImage = Array.isArray(image) ? image[0] : image;
      const input: Record<string, any> = {
        image: singleImage,
        prompt,
      };

      // Add optional parameters
      if (options?.version) input.version = options.version;

      return input;
    },
  },
  'reve-remix': {
    version: 'reve/remix',
    name: 'Reve Remix',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      // Reve Remix accepts 1-4 reference images
      const images = Array.isArray(image) ? image : [image];
      if (images.length < 1 || images.length > 4) {
        throw new Error('Reve Remix requires 1-4 reference images');
      }

      const input: Record<string, any> = {
        prompt,
        reference_images: images,
      };

      // Add optional parameters
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.version) input.version = options.version;

      return input;
    },
  },
  'qwen-image-edit-plus': {
    version: '7677b9cc9967f7725fcf5e814a5a3446bf1d4b6ab0f9c15534dbbc54c7a088f2',
    name: 'Qwen Image Edit Plus',
    prepareInput: (image: string | string[], prompt: string, options?: Record<string, any>) => {
      // Qwen Image Edit Plus accepts 1 or more images
      const images = Array.isArray(image) ? image : [image];

      const input: Record<string, any> = {
        prompt,
        image: images, // Qwen accepts array of images
      };

      // Add optional parameters
      if (options?.go_fast !== undefined) input.go_fast = options.go_fast;
      if (options?.aspect_ratio) input.aspect_ratio = options.aspect_ratio;
      if (options?.output_format) input.output_format = options.output_format;
      if (options?.output_quality !== undefined) input.output_quality = options.output_quality;
      if (options?.disable_safety_checker !== undefined) input.disable_safety_checker = options.disable_safety_checker;
      if (options?.seed !== undefined) input.seed = options.seed;

      return input;
    },
  },
};

export interface ReplicateImageInput {
  image: string; // Base64 or URL
  prompt: string;
  model?: string;
}

export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
  logs?: string;
}

/**
 * Smart image optimization for Replicate
 * Target: ≤ 700 KB to avoid 502 errors (base64 < ~1 MB)
 * Uses adaptive compression based on actual file size
 */
export async function convertImageToBase64(uri: string): Promise<string> {
  try {
    console.log('\n=== REPLICATE IMAGE OPTIMIZATION ===');
    console.log('Original URI:', uri);

    // Check if the URI is a remote URL (starts with http/https)
    let localUri = uri;
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      console.log('Remote image detected, downloading first...');

      // Download the remote image to local storage
      const filename = `replicate_temp_${Date.now()}.png`;
      const downloadPath = `${FileSystem.cacheDirectory}${filename}`;

      console.log('Downloading from:', uri);
      console.log('Downloading to:', downloadPath);

      const downloadResult = await downloadAsync(uri, downloadPath);
      localUri = downloadResult.uri;

      console.log('Download successful, local URI:', localUri);
    }

    // Get original file size (without loading image into memory)
    console.log(`\n--- ORIGINAL IMAGE ---`);
    let needsPreCompression = false;
    try {
      const originalFile = new File(localUri);
      const originalSizeKB = Math.round(originalFile.size / 1024);
      const originalSizeMB = (originalFile.size / (1024 * 1024)).toFixed(2);
      console.log(`File size: ${originalSizeKB} KB (${originalSizeMB} MB)`);

      // If file is over 50MB, pre-compress it first to avoid memory issues
      if (originalFile.size > 50 * 1024 * 1024) {
        needsPreCompression = true;
        console.warn(`⚠️ Large image detected (${originalSizeMB} MB). Will pre-compress to reduce memory usage.`);
      }
    } catch {
      console.log('File size: Unable to determine');
    }

    console.log(`\n--- OPTIMIZATION STRATEGY ---`);
    console.log('Target: ≤ 700 KB (to avoid 502 errors)');
    console.log('Strategy: Adaptive compression');

    // Step 1: Pre-compress very large files to avoid memory crashes
    let workingUri = localUri;
    if (needsPreCompression) {
      console.log('\nStep 0 (Pre-compression): Reducing large file to manageable size...');
      const preCompressed = await ImageManipulator.manipulateAsync(
        localUri,
        [{ resize: { width: 2048 } }], // Pre-compress to 2K max
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      workingUri = preCompressed.uri;

      const preFile = new File(workingUri);
      const preSizeKB = Math.round(preFile.size / 1024);
      const preSizeMB = (preFile.size / (1024 * 1024)).toFixed(2);
      console.log(`Pre-compressed: ${preCompressed.width}x${preCompressed.height} pixels, ${preSizeKB} KB (${preSizeMB} MB)`);
    }

    // Step 2: Try 896px with light compression (best quality)
    console.log(`\n${needsPreCompression ? 'Step 1' : 'Step 1'}: Trying 896px @ 80% compression...`);
    let result = await ImageManipulator.manipulateAsync(
      workingUri,
      [{ resize: { width: 896 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Check file size
    let file = new File(result.uri);
    let fileSize = file.size;
    let fileSizeKB = Math.round(fileSize / 1024);
    let fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    console.log(`Result: ${result.width}x${result.height} pixels, ${fileSizeKB} KB (${fileSizeMB} MB)`);

    // Step 3: If > 800 KB, compress more aggressively
    if (fileSize > 800 * 1024) {
      console.log(`\n${needsPreCompression ? 'Step 2' : 'Step 2'}: File too large, trying 768px @ 75% compression...`);
      result = await ImageManipulator.manipulateAsync(
        workingUri,
        [{ resize: { width: 768 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );

      file = new File(result.uri);
      fileSize = file.size;
      fileSizeKB = Math.round(fileSize / 1024);
      fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log(`Result: ${result.width}x${result.height} pixels, ${fileSizeKB} KB (${fileSizeMB} MB)`);
    }

    console.log(`\n--- OPTIMIZED IMAGE ---`);
    console.log(`Final dimensions: ${result.width}x${result.height} pixels`);
    console.log(`Final file size: ${fileSizeKB} KB (${fileSizeMB} MB)`);
    console.log(`Format: JPEG`);

    // Convert to base64
    const base64 = await file.base64();
    const base64SizeKB = Math.round(base64.length / 1024);
    const base64SizeMB = (base64.length / (1024 * 1024)).toFixed(2);
    console.log(`Base64 size: ${base64SizeKB} KB (${base64SizeMB} MB)`);

    // Calculate base64 overhead
    const base64Overhead = ((base64.length / fileSize - 1) * 100).toFixed(1);
    console.log(`Base64 overhead: +${base64Overhead}%`);

    console.log(`\n--- SIZE VALIDATION ---`);
    if (base64SizeKB > 700) {
      console.warn(`⚠️ WARNING: Base64 size (${base64SizeKB} KB) exceeds 700 KB target`);
      console.warn(`This may cause 502 errors with Replicate API`);
    } else {
      console.log(`✅ Base64 size OK (${base64SizeKB} KB ≤ 700 KB)`);
    }

    console.log('\n=== OPTIMIZATION COMPLETE ===\n');

    return `data:image/jpeg;base64,${base64}`;
  } catch (error: any) {
    console.error('Error optimizing image:', error);
    throw new Error(`Failed to optimize image: ${error.message}`);
  }
}

/**
 * Get the latest version hash for a model
 */
async function getLatestModelVersion(modelPath: string): Promise<string> {
  try {
    console.log(`Fetching latest version for model: ${modelPath}`);
    const response = await axios.get(
      `${REPLICATE_API_URL}/models/${modelPath}`,
      {
        headers: {
          Authorization: `Token ${REPLICATE_API_KEY}`,
        },
      }
    );

    const latestVersion = response.data.latest_version?.id;
    if (!latestVersion) {
      throw new Error(`No version found for model: ${modelPath}`);
    }

    console.log(`Latest version: ${latestVersion}`);
    return latestVersion;
  } catch (error: any) {
    console.error(`Error fetching model version: ${error.message}`);
    throw error;
  }
}

/**
 * Create a prediction with Replicate
 * @param model - Either a version hash (64-char hex) or model path (owner/model-name)
 */
export async function createPrediction(
  model: string,
  input: Record<string, any>
): Promise<ReplicatePrediction> {
  try {
    console.log('Creating prediction...');
    console.log('Model identifier:', model);
    console.log('Input parameters:');

    // Log each input parameter (excluding large base64 data)
    Object.entries(input).forEach(([key, value]) => {
      if (key === 'image') {
        // Handle single base64 image
        if (typeof value === 'string' && value.startsWith('data:image')) {
          const base64Data = value.split(',')[1] || value;
          const sizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
          console.log(`  - ${key}: [base64 image, ${sizeKB} KB]`);
        }
        // Handle array of base64 images
        else if (Array.isArray(value)) {
          const imageInfo = value.map((img, idx) => {
            if (typeof img === 'string' && img.startsWith('data:image')) {
              const base64Data = img.split(',')[1] || img;
              const sizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
              return `[base64 image ${idx + 1}, ${sizeKB} KB]`;
            }
            return `[image ${idx + 1}: ${typeof img}]`;
          });
          console.log(`  - ${key}: [${imageInfo.join(', ')}]`);
        }
        // Other image formats
        else {
          console.log(`  - ${key}:`, typeof value);
        }
      } else {
        console.log(`  - ${key}:`, value);
      }
    });

    // Determine if model is a version hash or model path
    // Version hash: 64-character hexadecimal string
    // Model path: owner/model-name format (contains '/')
    const isVersionHash = /^[a-f0-9]{64}$/.test(model);
    let versionHash: string;

    if (isVersionHash) {
      versionHash = model;
      console.log('Using provided version hash');
    } else {
      // Fetch the latest version for this model path
      console.log('Model path detected, fetching latest version...');
      versionHash = await getLatestModelVersion(model);
    }

    const requestBody = {
      version: versionHash,
      input,
    };

    const response = await axios.post(
      `${REPLICATE_API_URL}/predictions`,
      requestBody,
      {
        headers: {
          Authorization: `Token ${REPLICATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Prediction created successfully');
    console.log('Prediction ID:', response.data.id);
    return response.data;
  } catch (error: any) {
    console.error('❌ Error creating prediction');
    console.error('Error message:', error.response?.data || error.message);

    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }

    if (error.response?.data) {
      throw new Error(`Replicate API Error: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Get prediction status
 */
export async function getPrediction(
  predictionId: string
): Promise<ReplicatePrediction> {
  try {
    const response = await axios.get(
      `${REPLICATE_API_URL}/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Token ${REPLICATE_API_KEY}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error getting prediction:', error);
    throw error;
  }
}

/**
 * Wait for prediction to complete
 */
export async function waitForPrediction(
  predictionId: string,
  maxAttempts: number = 60
): Promise<ReplicatePrediction> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const prediction = await getPrediction(predictionId);

    if (prediction.status === 'succeeded') {
      return prediction;
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(
        `Prediction ${prediction.status}: ${prediction.error || 'Unknown error'}`
      );
    }

    // Wait 1 second before next check
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error('Prediction timed out');
}

/**
 * Convert audio file to data URI for Replicate
 */
async function convertAudioToDataUri(uri: string): Promise<string> {
  try {
    console.log('Converting audio to data URI:', uri);

    // Read the audio file as base64
    const base64Audio = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine MIME type based on file extension
    let mimeType = 'audio/mpeg'; // default
    if (uri.endsWith('.wav')) {
      mimeType = 'audio/wav';
    } else if (uri.endsWith('.m4a')) {
      mimeType = 'audio/mp4';
    } else if (uri.endsWith('.mp3')) {
      mimeType = 'audio/mpeg';
    }

    const dataUri = `data:${mimeType};base64,${base64Audio}`;
    const sizeKB = Math.round(base64Audio.length / 1024);
    console.log(`Audio converted: ${sizeKB} KB (${mimeType})`);

    return dataUri;
  } catch (error: any) {
    console.error('Error converting audio:', error);
    throw new Error(`Failed to convert audio: ${error.message}`);
  }
}

/**
 * Start a transformation and return the prediction ID immediately
 * This allows saving the prediction ID before waiting for completion
 */
export async function startTransformation(
  imageUri: string | string[],
  prompt: string,
  modelId: string = 'seedream-replicate',
  options?: Record<string, any>
): Promise<{ predictionId: string; modelName: string }> {
  try {
    // Get model configuration
    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}. Available models: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
    }

    console.log('\n=== STARTING TRANSFORMATION (REPLICATE) ===');
    console.log('Model:', modelConfig.name);
    console.log('Prompt:', prompt);

    // Handle audio conversion if needed
    if (options?.audio) {
      console.log('Converting audio file...');
      options.audio = await convertAudioToDataUri(options.audio);
    }

    // Handle image processing - skip for models that don't need images
    let imageInput: string | string[] | undefined;

    if (imageUri && (Array.isArray(imageUri) ? imageUri.length > 0 && imageUri[0] : true)) {
      // Handle multiple images
      const imageUris = Array.isArray(imageUri) ? imageUri : [imageUri];
      console.log(`Processing ${imageUris.length} image(s)`);

      // Convert all images to base64
      const base64Images = await Promise.all(
        imageUris.map(uri => convertImageToBase64(uri))
      );

      imageInput = base64Images.length === 1 ? base64Images[0] : base64Images;
    } else {
      console.log('No images to process (text-only generation)');
      imageInput = '';
    }

    // Prepare input using model-specific configuration
    const modelInput = modelConfig.prepareInput(imageInput as any, prompt, options);

    // Create prediction
    const prediction = await createPrediction(
      modelConfig.version,
      modelInput
    );

    console.log('✅ Prediction created successfully');
    console.log('Prediction ID:', prediction.id);

    return {
      predictionId: prediction.id,
      modelName: modelConfig.name
    };
  } catch (error: any) {
    console.error('❌ Error starting transformation');
    console.error('Error message:', error.message);
    throw new Error(error.response?.data?.detail || error.message);
  }
}

/**
 * Resume a prediction that was started earlier
 * Useful for resuming after app was backgrounded
 */
export async function resumeTransformation(
  predictionId: string,
  modelConfig?: { name: string },
  maxAttempts?: number
): Promise<string> {
  const startTime = Date.now();

  try {
    console.log('\n=== RESUMING TRANSFORMATION (REPLICATE) ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Prediction ID:', predictionId);

    console.log('\n--- RESUMING POLLING ---');
    const waitStart = Date.now();

    const result = await waitForPrediction(predictionId, maxAttempts);

    const waitTime = ((Date.now() - waitStart) / 1000).toFixed(2);
    console.log(`Prediction completed in ${waitTime}s`);

    console.log('\n=== PREDICTION COMPLETED ===');
    console.log('Final status:', result.status);

    // Check if output is null or undefined
    if (!result.output) {
      console.error('❌ Model returned null output');
      console.error('Logs:', result.logs);

      let errorMessage = 'Model failed to generate output';
      if (result.logs) {
        if (result.logs.includes('No face found')) {
          errorMessage = 'No face detected in the images. Please use clear, front-facing photos with visible faces.';
        } else if (result.logs.includes('error')) {
          errorMessage = `Model error: ${result.logs}`;
        }
      }

      throw new Error(errorMessage);
    }

    // Extract output URL
    let outputUrl: string;
    if (Array.isArray(result.output)) {
      outputUrl = result.output[0];
      console.log(`Output: Array with ${result.output.length} image(s)`);
    } else if (typeof result.output === 'string') {
      outputUrl = result.output;
      console.log('Output: Single image URL');
    } else if (result.output && typeof result.output === 'object') {
      console.log('Output is an object:', JSON.stringify(result.output));
      outputUrl = (result.output as any).image || (result.output as any).output || (result.output as any).url;

      if (!outputUrl) {
        throw new Error('Could not extract image URL from model output');
      }
    } else {
      console.error('Unexpected output format:', typeof result.output, result.output);
      throw new Error('Unexpected output format from model');
    }

    console.log('Generated image URL:', outputUrl);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n--- RESUME SUMMARY ---');
    console.log(`✅ Successfully resumed and completed in ${totalTime}s`);
    if (modelConfig?.name) {
      console.log(`🎨 Model: ${modelConfig.name}`);
    }
    console.log('=== END REPLICATE RESUME ===\n');

    return outputUrl;
  } catch (error: any) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error('\n=== ERROR IN RESUME ===');
    console.error('Error type:', error.constructor?.name || 'Unknown');
    console.error('Error message:', error.message);
    console.error('Time before error:', `${totalTime}s`);

    if (error.response?.data) {
      console.error('API Error details:', error.response.data);
    }

    console.error('=== END ERROR ===\n');

    throw new Error(error.response?.data?.detail || error.message);
  }
}

/**
 * Transform image with prompt using Replicate models
 * Returns an object with the output URL and prediction ID for resumability
 */
export async function transformImage(
  imageUri: string | string[],
  prompt: string,
  modelId: string = 'seedream-replicate',
  options?: Record<string, any>
): Promise<string> {
  const startTime = Date.now();

  try {
    // Get model configuration
    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}. Available models: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
    }

    console.log('\n=== STARTING IMAGE TRANSFORMATION (REPLICATE) ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Model:', modelConfig.name);
    console.log('Model ID:', modelId);
    console.log('Prompt:', prompt);

    // Handle multiple images
    const imageUris = Array.isArray(imageUri) ? imageUri : [imageUri];
    console.log(`Processing ${imageUris.length} image(s)`);

    // Convert all images to base64
    const optimizationStart = Date.now();
    const base64Images = await Promise.all(
      imageUris.map(uri => convertImageToBase64(uri))
    );
    const optimizationTime = ((Date.now() - optimizationStart) / 1000).toFixed(2);
    console.log(`Image optimization completed in ${optimizationTime}s`);

    // Calculate input image size (first image)
    const base64Data = base64Images[0].split(',')[1] || base64Images[0];
    const inputImageSizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
    const inputImageSizeMB = (inputImageSizeKB / 1024).toFixed(2);

    // Prepare input using model-specific configuration
    // Pass array for models that support it, single for those that don't
    const imageInput = base64Images.length === 1 ? base64Images[0] : base64Images;
    const modelInput = modelConfig.prepareInput(imageInput, prompt, options);

    console.log('\n--- REQUEST PARAMETERS ---');
    console.log('Model version:', modelConfig.version);
    console.log('API Endpoint: https://api.replicate.com/v1/predictions');
    console.log('Input image size:', `${inputImageSizeKB} KB (${inputImageSizeMB} MB)`);
    console.log('Input image format:', base64Images[0].startsWith('data:image/') ? base64Images[0].split(';')[0].replace('data:image/', '') : 'base64');
    console.log('Prompt:', prompt);
    console.log('Input parameters:', Object.keys(modelInput).join(', '));
    console.log('Image parameter: ✅ INCLUDED');

    console.log('\n--- CREATING PREDICTION ---');
    const predictionStart = Date.now();

    const prediction = await createPrediction(
      modelConfig.version,
      modelInput
    );

    const predictionCreateTime = ((Date.now() - predictionStart) / 1000).toFixed(2);
    console.log(`Prediction created in ${predictionCreateTime}s`);
    console.log('Prediction ID:', prediction.id);
    console.log('Initial status:', prediction.status);

    console.log('\n--- WAITING FOR COMPLETION ---');
    const waitStart = Date.now();

    const result = await waitForPrediction(prediction.id);

    const waitTime = ((Date.now() - waitStart) / 1000).toFixed(2);
    console.log(`Prediction completed in ${waitTime}s`);

    console.log('\n=== PREDICTION COMPLETED ===');
    console.log('Final status:', result.status);
    console.log('Full prediction result:', JSON.stringify(result, null, 2));

    // Check if output is null or undefined
    if (!result.output) {
      console.error('❌ Model returned null output');
      console.error('Logs:', result.logs);

      // Parse error from logs
      let errorMessage = 'Model failed to generate output';
      if (result.logs) {
        if (result.logs.includes('No face found')) {
          errorMessage = 'No face detected in the images. Please use clear, front-facing photos with visible faces.';
        } else if (result.logs.includes('error')) {
          errorMessage = `Model error: ${result.logs}`;
        }
      }

      throw new Error(errorMessage);
    }

    // Extract output URL
    let outputUrl: string;
    if (Array.isArray(result.output)) {
      outputUrl = result.output[0];
      console.log(`Output: Array with ${result.output.length} image(s)`);
    } else if (typeof result.output === 'string') {
      outputUrl = result.output;
      console.log('Output: Single image URL');
    } else if (result.output && typeof result.output === 'object') {
      // Some models return objects with image URLs
      console.log('Output is an object:', JSON.stringify(result.output));
      // Try common keys
      outputUrl = (result.output as any).image || (result.output as any).output || (result.output as any).url;

      if (!outputUrl) {
        throw new Error('Could not extract image URL from model output');
      }
    } else {
      console.error('Unexpected output format:', typeof result.output, result.output);
      throw new Error('Unexpected output format from model');
    }

    console.log('Generated image URL:', outputUrl);

    // Try to get output image size
    console.log('\n--- OUTPUT IMAGE DETAILS ---');
    try {
      const imageResponse = await axios.get(outputUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const imageSizeBytes = imageResponse.data.byteLength;
      const imageSizeKB = Math.round(imageSizeBytes / 1024);
      const imageSizeMB = (imageSizeBytes / (1024 * 1024)).toFixed(2);

      console.log(`Output image size: ${imageSizeKB} KB (${imageSizeMB} MB)`);
      console.log(`Content-Type: ${imageResponse.headers['content-type'] || 'unknown'}`);
    } catch (fetchError) {
      console.log('Note: Could not fetch image to determine exact size');
    }

    // Calculate total time
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n--- TRANSFORMATION SUMMARY ---');
    console.log(`✅ Successfully transformed image in ${totalTime}s`);
    console.log(`📤 Input: ${inputImageSizeKB} KB`);
    console.log(`🎨 Model: ${modelConfig.name}`);
    console.log(`⏱️  Optimization: ${optimizationTime}s | API: ${waitTime}s | Total: ${totalTime}s`);
    console.log('=== END REPLICATE TRANSFORMATION ===\n');

    return outputUrl;
  } catch (error: any) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error('\n=== ERROR IN TRANSFORMATION ===');
    console.error('Error type:', error.constructor?.name || 'Unknown');
    console.error('Error message:', error.message);
    console.error('Time before error:', `${totalTime}s`);

    if (error.response?.data) {
      console.error('API Error details:', error.response.data);
    }

    console.error('=== END ERROR ===\n');

    throw new Error(error.response?.data?.detail || error.message);
  }
}
