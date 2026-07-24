/**
 * Recipe System - Type Definitions
 *
 * Simplified recipe/workflow system for chaining image generation models
 */

/**
 * Input type for a recipe - what the user starts with
 * - 'images': User must upload images to start
 * - 'prompt': User can edit/customize the prompt with placeholders (city, date, etc.)
 * - 'none': Just copy prompt and go to create - no input needed
 */
export type RecipeInputType = 'images' | 'prompt' | 'none';

/**
 * Step in a recipe workflow
 */
export interface RecipeStep {
  id: string;                      // Unique step ID
  order: number;                   // Step order (1, 2, 3...)
  modelIds: string[];              // Model IDs from modelRegistry (supports multiple models)
  numImages: number;               // Number of images to generate (1-4)
  prompts: string[];               // Multiple prompts for this step
  useAllPreviousResults: boolean;  // Use all results from previous step
  aspectRatio?: string;            // Aspect ratio (e.g., '9:16', '1:1', '16:9'). Default '9:16'
  soulId?: string;                 // Optional soul ID for reference images

  // Deprecated - for backward compatibility
  modelId?: string;                // Legacy single model support
}

/**
 * A Recipe is a reusable workflow template
 */
export interface Recipe {
  id: string;                      // Unique recipe ID
  name: string;                    // Recipe name
  inputType: RecipeInputType;      // What user starts with
  inputDescription?: string;       // Description of what images user needs (e.g., "Upload a portrait photo")
  instructions?: string;           // Instructions for using this recipe (shown to users)
  // Non-empty value flips this recipe to "any photo" mode: the run screen shows a
  // "Choose <photoInputLabel>" button (gallery + camera) instead of the soul selector.
  // Example value: "full body selfie".
  photoInputLabel?: string;
  isPublic: boolean;               // Public recipe flag
  isOnboarding?: boolean;          // Show in onboarding flow
  supabaseRecipeId?: string;       // Supabase public_recipes ID (if published)

  steps: RecipeStep[];             // Ordered workflow steps

  referenceImageUris?: string[];   // Admin-only reference images baked into recipe (up to 4)

  /** @deprecated migrated into referenceImageUris — read-only legacy field on old SQLite rows */
  exampleInputUri?: string;
  exampleResultUri?: string;       // Deprecated single example result (kept for back-compat — first entry of exampleResultUris when set)
  exampleResultUris?: string[];    // Multiple example result images for auto-cycling cards on the home screen
  featuredImageUri?: string;       // Optional hero-only override image. When set, hero shows only this (no cycling for this recipe).

  createdAt: number;               // Timestamp
  updatedAt: number;               // Timestamp
  isFavorite: boolean;             // Favorite flag
  isHidden: boolean;               // Hidden from "My Recipes" (temporary import for execution)

  // Admin fields for the new home screen — not persisted locally, only round-tripped
  // through Supabase. Hydrated when editing a published recipe so admins can change them.
  categoryTags?: string[];
  isFeatured?: boolean;
  featuredOrder?: number | null;
}

/**
 * Recipe execution/run instance
 */
export interface RecipeExecution {
  id: string;                      // Execution ID
  recipeId: string;                // Reference to recipe
  status: 'running' | 'completed' | 'failed';
  currentStepIndex: number;        // Current step being executed
  startedAt: number;               // Timestamp
  completedAt?: number;            // Timestamp
  error?: string;                  // Error message if failed

  // Results for each step (stepId -> array of library image IDs)
  stepResults: Record<string, string[]>;
}
