/**
 * Custom Models Types
 *
 * Type definitions for user-defined Replicate models
 */

// Replicate API Schema Types
export interface ReplicateParameter {
  type: string; // 'string', 'integer', 'number', 'boolean', 'array', etc.
  description?: string;
  default?: any;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  format?: string; // 'uri' for images/videos
  items?: ReplicateParameter; // For arrays
  'x-order'?: number; // Replicate uses this for UI ordering
}

export interface ReplicateSchema {
  input: Record<string, ReplicateParameter>;
  output?: any;
}

export interface ReplicateModelVersion {
  id: string;
  created_at: string;
  cog_version: string;
  openapi_schema: ReplicateSchema;
}

export interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description: string;
  visibility: string;
  github_url?: string;
  paper_url?: string;
  license_url?: string;
  latest_version: ReplicateModelVersion;
}

// Field Mapping Types
export interface FieldMapping {
  promptField?: string; // Which schema field is the prompt
  imageField1?: string; // Primary image input field
  imageField2?: string; // Secondary image input field (for multi-image models)
  imageField3?: string; // Tertiary image input field
  imageField4?: string; // Quaternary image input field
  // Additional fields can be mapped dynamically
  [key: string]: string | undefined;
}

// Optimization Settings
export interface OptimizationSettings {
  maxSizeKB: number; // Max file size in KB
  maxWidth: number; // Max width in pixels
  maxHeight?: number; // Max height in pixels
  format: 'jpg' | 'png'; // Preferred format
}

// Pricing Information
export interface PricingInfo {
  coinsPerGeneration: number;
  fetchedFromApi: boolean;
  replicateCostPerRun?: number; // Cost in USD from Replicate
  lastUpdated?: string;
}

// Custom Model Database Record
export interface CustomModel {
  id: string;
  user_id: string;

  // Model identification
  replicate_model: string; // e.g., "stability-ai/sdxl"
  version_hash?: string; // Optional specific version

  // Display info
  name: string;
  description?: string;

  // Schema & configuration
  schema: ReplicateSchema;
  field_mapping: FieldMapping;
  optimization_settings?: OptimizationSettings;
  pricing?: PricingInfo;

  // Metadata
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  usage_count: number;
}

// Create/Update Input Types
export interface CreateCustomModelInput {
  replicate_model: string;
  version_hash?: string;
  name: string;
  description?: string;
  schema: ReplicateSchema;
  field_mapping: FieldMapping;
  optimization_settings?: OptimizationSettings;
  pricing?: PricingInfo;
}

export interface UpdateCustomModelInput {
  name?: string;
  description?: string;
  field_mapping?: FieldMapping;
  optimization_settings?: OptimizationSettings;
  pricing?: PricingInfo;
}

// Parameter Classification
export type ParameterType = 'prompt' | 'image' | 'number' | 'boolean' | 'enum' | 'other';

export interface ClassifiedParameter extends ReplicateParameter {
  name: string;
  parameterType: ParameterType;
  isRequired: boolean;
  isImageInput: boolean;
}

// Model Preparation Result
export interface PreparedModelInput {
  [key: string]: any; // Dynamic based on model schema
}
