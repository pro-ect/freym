/**
 * Shared Generation Utilities
 *
 * Common functions for image generation across Edit and Create tabs.
 * Eliminates code duplication and provides consistent behavior.
 */

import { getModelCoinCost, getModelPriceInCents } from '../pricing';
import { getReplicateModelConfig } from '../../app/config/modelRegistry';

/**
 * Calculate total generation cost
 * Returns both coins and USD formatted strings
 */
export interface GenerationCost {
  totalCoins: number;
  totalCents: number;
  formattedCoins: string;
  formattedUSD: string;
}

export function calculateGenerationCost(
  modelIds: string[],
  imagesPerModel: number
): GenerationCost {
  const totalCoins = modelIds.reduce((total, modelId) => {
    return total + (getModelCoinCost(modelId) * imagesPerModel);
  }, 0);

  const totalCents = modelIds.reduce((total, modelId) => {
    return total + (getModelPriceInCents(modelId) * imagesPerModel);
  }, 0);

  return {
    totalCoins,
    totalCents,
    formattedCoins: `${totalCoins}`,
    formattedUSD: `$${(totalCents / 100).toFixed(2)}`,
  };
}

/**
 * Get display cost string based on BYOK status
 */
export function getDisplayCost(
  modelIds: string[],
  imagesPerModel: number,
  hasCustomApiKey: boolean
): string {
  const cost = calculateGenerationCost(modelIds, imagesPerModel);
  return hasCustomApiKey ? cost.formattedUSD : cost.formattedCoins;
}

/**
 * Validate model input requirements
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateGenerationInputs(
  modelIds: string[],
  prompt: string,
  referenceImages: string[]
): ValidationResult {
  if (modelIds.length === 0) {
    return { valid: false, error: 'Please select at least one model' };
  }

  if (!prompt.trim()) {
    return { valid: false, error: 'Please enter a prompt' };
  }

  // Check each model's reference image requirements
  for (const modelId of modelIds) {
    const config = getReplicateModelConfig(modelId);

    if (config?.requiresReferenceImages && referenceImages.length === 0) {
      return {
        valid: false,
        error: `${config.name} requires at least ${config.minReferenceImages || 1} reference image(s)`
      };
    }

    if (config?.minReferenceImages && referenceImages.length < config.minReferenceImages) {
      return {
        valid: false,
        error: `${config.name} requires at least ${config.minReferenceImages} reference image(s)`
      };
    }

    if (config?.maxReferenceImages && referenceImages.length > config.maxReferenceImages) {
      return {
        valid: false,
        error: `${config.name} supports up to ${config.maxReferenceImages} reference image(s)`
      };
    }
  }

  return { valid: true };
}

/**
 * Format model-specific parameters based on model ID
 * Centralizes parameter logic that was scattered across components
 */
export function formatModelParameters(
  modelId: string,
  baseOptions: Record<string, any>,
  referenceImages?: string[]
): Record<string, any> {
  const config = getReplicateModelConfig(modelId);

  // Merge with default parameters from registry
  const parameters = {
    ...(config?.defaultParameters || {}),
    ...baseOptions,
  };

  // Model-specific parameter formatting
  switch (modelId) {
    case 'seedream':
      return {
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        num_images: parameters.num_images || 1,
        size: parameters.size || '4K',
        ...parameters,
      };

    case 'nano-banana':
      return {
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        num_images: parameters.num_images || 1,
        output_format: parameters.output_format || 'jpg',
        ...parameters,
      };

    case 'nano-banana-pro-2k':
      return {
        resolution: '2K',
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        output_format: parameters.output_format || 'png',
        safety_filter: parameters.safety_filter || 'block_medium_and_above',
        ...parameters,
      };

    case 'nano-banana-pro-4k':
      return {
        resolution: '4K',
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        output_format: parameters.output_format || 'png',
        safety_filter: parameters.safety_filter || 'block_medium_and_above',
        ...parameters,
      };

    case 'ideogram-character':
      return {
        style_type: parameters.style_type || 'Auto',
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        rendering_speed: parameters.rendering_speed || 'Default',
        magic_prompt_option: parameters.magic_prompt_option || 'Auto',
        num_images: parameters.num_images || 1,
        ...parameters,
      };

    case 'gen4-image':
      return {
        resolution: parameters.resolution || '1080p',
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        num_images: parameters.num_images || 1,
        ...parameters,
      };

    case 'reve-create':
    case 'reve-remix':
    case 'reve-edit':
      return {
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        num_images: parameters.num_images || 1,
        ...parameters,
      };

    case 'qwen-image-edit-plus':
      return {
        go_fast: parameters.go_fast !== false,
        aspect_ratio: parameters.aspect_ratio || 'match_input_image',
        output_format: parameters.output_format || 'webp',
        output_quality: parameters.output_quality || 95,
        num_images: parameters.num_images || 1,
        ...parameters,
      };

    default:
      return parameters;
  }
}

/**
 * Model mapping from Replicate to Fal equivalents
 * Used when apiProvider === 'fal' to swap models in recipes
 */
const REPLICATE_TO_FAL_MAP: Record<string, string> = {
  'nano-banana': 'nano-banana-fal',
  'nano-banana-pro-2k': 'nano-banana-pro-2k-fal',
  'nano-banana-pro-4k': 'nano-banana-pro-4k-fal',
  'seedream': 'seedream-4.5-fal',
  'flux-2-pro': 'flux-2-pro-fal',
  'topaz-image-upscale': 'topaz-upscale-fal',
  'seedance-1-pro-fast': 'seedance-fast-fal',
  // Reve models map to reve-fal
  'reve-create': 'reve-fal',
  'reve-remix': 'reve-fal',
  'reve-edit': 'reve-fal',
};

/**
 * Get the Fal equivalent of a Replicate model slug
 * Returns the original slug if no Fal equivalent exists
 */
export function getFalEquivalent(modelSlug: string): string {
  return REPLICATE_TO_FAL_MAP[modelSlug] || modelSlug;
}

/**
 * Check if a model has a Fal equivalent
 */
export function hasFalEquivalent(modelSlug: string): boolean {
  return modelSlug in REPLICATE_TO_FAL_MAP;
}

/**
 * Map model IDs to their provider-specific equivalents
 * When apiProvider === 'fal', swaps replicate models for fal versions
 */
export function mapModelsForProvider(
  modelIds: string[],
  apiProvider: 'replicate' | 'fal'
): string[] {
  if (apiProvider === 'replicate') {
    return modelIds;
  }

  // For fal mode, map each model to its fal equivalent
  return modelIds.map(modelId => getFalEquivalent(modelId));
}

/**
 * Get parameter mapping for passing images to specific models
 * Some models use 'image_input', others use 'reference_images', etc.
 */
export function getImageParameterName(modelId: string): string {
  switch (modelId) {
    case 'seedream':
    case 'nano-banana':
    case 'nano-banana-pro-2k':
    case 'nano-banana-pro-4k':
    case 'qwen-image-edit-plus':
    case 'reve-edit':
      return 'image_input';

    case 'reve-remix':
    case 'gen4-image':
    case 'ideogram-character':
    case 'ideogram-v3-balanced':
      return 'reference_images';

    default:
      return 'image_input';
  }
}
