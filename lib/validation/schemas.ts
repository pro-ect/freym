/**
 * Zod Validation Schemas
 *
 * Runtime validation for API requests, edge functions, and user inputs
 */

import { z } from 'zod';

/**
 * Start Prediction Request Schema
 * Validates incoming requests to start-prediction edge function
 */
export const StartPredictionRequestSchema = z.object({
  model: z.string().min(1, 'Model ID is required'),
  prompt: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional().default({}),
  referenceImages: z.array(z.string().url('Invalid image URL')).optional(),
  webhookUrl: z.string().url('Invalid webhook URL').optional(),
});

export type StartPredictionRequest = z.infer<typeof StartPredictionRequestSchema>;

/**
 * Prediction Callback Request Schema
 * Validates webhooks from Replicate/BytePlus
 */
export const PredictionCallbackSchema = z.object({
  id: z.string().min(1, 'Prediction ID is required'),
  status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']),
  output: z.union([
    z.string().url(),
    z.array(z.string().url()),
    z.null(),
  ]).optional(),
  error: z.string().optional(),
  metrics: z.object({
    predict_time: z.number().optional(),
  }).optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});

export type PredictionCallback = z.infer<typeof PredictionCallbackSchema>;

/**
 * Model Pricing Schema
 * Validates model pricing records
 */
export const ModelPricingSchema = z.object({
  model_id: z.string().min(1),
  price_in_cents: z.number().nonnegative('Price must be non-negative'),
  coin_cost: z.number().int().nonnegative('Coin cost must be non-negative integer'),
  is_active: z.boolean().default(true),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

/**
 * Model Config Schema
 * Validates model configuration records
 */
export const ModelConfigSchema = z.object({
  model_id: z.string().min(1),
  replicate_version: z.string().min(1),
  provider: z.enum(['replicate', 'byteplus', 'custom']),
  is_active: z.boolean().default(true),
  requires_reference_images: z.boolean().default(false),
  min_reference_images: z.number().int().positive().optional(),
  max_reference_images: z.number().int().positive().optional(),
  image_parameter_name: z.string().optional(),
  default_parameters: z.record(z.string(), z.any()).default({}),
}).refine(
  (data) => {
    // If requires_reference_images is true, min and max must be defined
    if (data.requires_reference_images) {
      return data.min_reference_images != null && data.max_reference_images != null;
    }
    return true;
  },
  {
    message: 'When requires_reference_images is true, min_reference_images and max_reference_images must be defined',
  }
).refine(
  (data) => {
    // If both are defined, min must be <= max
    if (data.min_reference_images != null && data.max_reference_images != null) {
      return data.min_reference_images <= data.max_reference_images;
    }
    return true;
  },
  {
    message: 'min_reference_images must be less than or equal to max_reference_images',
  }
);

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * Coin Transaction Schema
 * Validates coin transaction records
 */
export const CoinTransactionSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  amount: z.number().int('Amount must be an integer'),
  transaction_type: z.enum([
    'reserve',
    'deduct',
    'release',
    'refund',
    'purchase',
    'bonus',
    'admin_adjust',
  ]),
  description: z.string().min(1, 'Description is required'),
  generation_queue_id: z.string().uuid('Invalid generation queue ID').optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CoinTransaction = z.infer<typeof CoinTransactionSchema>;

/**
 * Recipe Step Schema
 * Validates recipe step structure
 */
export const RecipeStepSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
  useOutputAsInput: z.boolean().optional(),
  description: z.string().optional(),
});

export type RecipeStep = z.infer<typeof RecipeStepSchema>;

/**
 * Recipe Schema
 * Validates recipe structure
 */
export const RecipeSchema = z.object({
  name: z.string().min(1, 'Recipe name is required').max(100, 'Recipe name too long'),
  inputType: z.enum(['images', 'prompt']),
  inputDescription: z.string().optional(),
  steps: z.array(RecipeStepSchema).min(1, 'Recipe must have at least one step'),
});

export type Recipe = z.infer<typeof RecipeSchema>;

/**
 * Image Metadata Schema
 * Validates image metadata structure
 */
export const ImageMetadataSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
  aspectRatio: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.string().optional(),
  generatedAt: z.string().datetime().optional(),
});

export type ImageMetadata = z.infer<typeof ImageMetadataSchema>;

/**
 * User Profile Update Schema
 * Validates profile updates
 */
export const ProfileUpdateSchema = z.object({
  email: z.string().email('Invalid email').optional(),
  replicate_api_key_encrypted: z.string().optional(),
  has_custom_key: z.boolean().optional(),
});

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/**
 * Custom Model Schema
 * Validates custom model configuration
 */
export const CustomModelSchema = z.object({
  replicate_model: z.string().min(1, 'Replicate model is required'),
  version_hash: z.string().optional(),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  schema: z.record(z.string(), z.any()),
  field_mapping: z.record(z.string(), z.string()),
  optimization_settings: z.object({
    maxSizeKB: z.number().positive().optional(),
    maxWidth: z.number().int().positive().optional(),
    format: z.enum(['jpg', 'png', 'webp']).optional(),
  }).optional(),
  pricing: z.object({
    coinsPerGeneration: z.number().int().positive(),
    fetchedFromApi: z.boolean().optional(),
  }).optional(),
});

export type CustomModel = z.infer<typeof CustomModelSchema>;

/**
 * Pagination Schema
 * Validates pagination parameters
 */
export const PaginationSchema = z.object({
  limit: z.number().int().positive().max(100, 'Limit cannot exceed 100').default(20),
  offset: z.number().int().nonnegative().default(0),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * Helper function to validate and parse data with Zod
 * Throws AppError on validation failure
 */
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const firstError = result.error.errors[0];
    throw new Error(
      `Validation failed${context ? ` for ${context}` : ''}: ${firstError.path.join('.')}: ${firstError.message}`
    );
  }

  return result.data;
}

/**
 * Helper function to get validation errors as an array
 */
export function getValidationErrors(
  schema: z.ZodSchema,
  data: unknown
): string[] {
  const result = schema.safeParse(data);

  if (result.success) {
    return [];
  }

  return result.error.errors.map(
    (err) => `${err.path.join('.')}: ${err.message}`
  );
}

/**
 * Helper to check if data is valid according to schema
 */
export function isValid(schema: z.ZodSchema, data: unknown): boolean {
  return schema.safeParse(data).success;
}
