/**
 * Replicate Schema Fetching Service
 *
 * Fetches and parses model schemas from Replicate API
 */

import axios from 'axios';
import type {
  ReplicateModel,
  ReplicateModelVersion,
  ReplicateSchema,
  ReplicateParameter,
  ClassifiedParameter,
  ParameterType,
} from '../customModels/types';

const REPLICATE_API_KEY = process.env.EXPO_PUBLIC_REPLICATE_API_TOKEN;
const REPLICATE_API_URL = 'https://api.replicate.com/v1';

/**
 * Parse Replicate model URL or identifier
 * Supports:
 * - Full URLs: https://replicate.com/owner/name
 * - Model paths: owner/name
 * - Version hashes: abc123...
 */
export function parseReplicateInput(input: string): {
  type: 'model' | 'version';
  value: string;
} {
  // Check if it's a version hash (64 hex characters)
  const versionHashRegex = /^[a-f0-9]{64}$/i;
  if (versionHashRegex.test(input)) {
    return { type: 'version', value: input };
  }

  // Extract owner/name from URL or path
  let modelPath = input;

  // Handle full URLs
  if (input.startsWith('http')) {
    const urlMatch = input.match(/replicate\.com\/([^\/]+\/[^\/\?]+)/);
    if (urlMatch) {
      modelPath = urlMatch[1];
    }
  }

  // Validate owner/name format
  const modelPathRegex = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
  if (!modelPathRegex.test(modelPath)) {
    throw new Error('Invalid Replicate model format. Expected: owner/name or version hash');
  }

  return { type: 'model', value: modelPath };
}

/**
 * Fetch model information from Replicate API
 */
export async function fetchModelInfo(modelPath: string): Promise<ReplicateModel> {
  try {
    const response = await axios.get(
      `${REPLICATE_API_URL}/models/${modelPath}`,
      {
        headers: {
          Authorization: `Token ${REPLICATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Model not found: ${modelPath}`);
    }
    if (error.response?.status === 401) {
      throw new Error('Invalid Replicate API key');
    }
    throw new Error(`Failed to fetch model: ${error.message}`);
  }
}

/**
 * Fetch specific version information
 */
export async function fetchVersionInfo(versionHash: string): Promise<ReplicateModelVersion> {
  try {
    const response = await axios.get(
      `${REPLICATE_API_URL}/versions/${versionHash}`,
      {
        headers: {
          Authorization: `Token ${REPLICATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Version not found: ${versionHash}`);
    }
    if (error.response?.status === 401) {
      throw new Error('Invalid Replicate API key');
    }
    throw new Error(`Failed to fetch version: ${error.message}`);
  }
}

/**
 * Fetch model schema from Replicate
 */
export async function fetchModelSchema(input: string): Promise<{
  schema: ReplicateSchema;
  modelInfo: {
    name: string;
    description: string;
    owner: string;
    versionHash: string;
  };
}> {
  console.log('🔍 Parsing Replicate input:', input);
  const parsed = parseReplicateInput(input);
  console.log('✅ Parsed as:', parsed);

  if (parsed.type === 'version') {
    // Fetch version directly
    console.log('📡 Fetching version info from Replicate API...');
    const version = await fetchVersionInfo(parsed.value);
    console.log('✅ Version info retrieved');
    return {
      schema: version.openapi_schema,
      modelInfo: {
        name: 'Custom Model', // Version API doesn't return model name
        description: '',
        owner: '',
        versionHash: version.id,
      },
    };
  } else {
    // Fetch model info (includes latest version)
    console.log('📡 Fetching model info from Replicate API:', parsed.value);
    const model = await fetchModelInfo(parsed.value);
    console.log('✅ Model info retrieved:', model.name);
    const latestVersion = model.latest_version;

    if (!latestVersion) {
      console.error('❌ Model has no published versions');
      throw new Error('Model has no published versions');
    }

    console.log('✅ Latest version:', latestVersion.id);
    console.log('📋 Schema structure:', JSON.stringify(latestVersion.openapi_schema, null, 2));
    return {
      schema: latestVersion.openapi_schema,
      modelInfo: {
        name: model.name,
        description: model.description || '',
        owner: model.owner,
        versionHash: latestVersion.id,
      },
    };
  }
}

/**
 * Classify parameter type based on schema
 */
export function classifyParameter(
  name: string,
  param: ReplicateParameter
): ParameterType {
  const lowerName = name.toLowerCase();

  // Check for prompt/text inputs
  if (
    lowerName.includes('prompt') ||
    lowerName.includes('text') ||
    lowerName.includes('description') ||
    lowerName.includes('caption')
  ) {
    return 'prompt';
  }

  // Check for image inputs (URI format or name hints)
  if (
    param.format === 'uri' ||
    lowerName.includes('image') ||
    lowerName.includes('photo') ||
    lowerName.includes('picture')
  ) {
    return 'image';
  }

  // Check primitive types
  if (param.type === 'integer' || param.type === 'number') {
    return 'number';
  }

  if (param.type === 'boolean') {
    return 'boolean';
  }

  if (param.enum && param.enum.length > 0) {
    return 'enum';
  }

  return 'other';
}

/**
 * Get all parameters from schema, classified and sorted
 */
export function getClassifiedParameters(schema: ReplicateSchema): ClassifiedParameter[] {
  console.log('🏷️ Classifying parameters from schema...');
  const parameters: ClassifiedParameter[] = [];

  // Schema has input.properties structure
  const inputProperties = schema.input?.properties || {};
  console.log('📋 Found properties:', Object.keys(inputProperties));

  for (const [name, param] of Object.entries(inputProperties)) {
    const parameterType = classifyParameter(name, param);
    const isRequired = !('default' in param); // If no default, it's likely required

    parameters.push({
      ...param,
      name,
      parameterType,
      isRequired,
      isImageInput: parameterType === 'image',
    });
  }

  // Sort: required first, then by parameter type importance
  const typeOrder: Record<ParameterType, number> = {
    image: 1,
    prompt: 2,
    enum: 3,
    number: 4,
    boolean: 5,
    other: 6,
  };

  return parameters.sort((a, b) => {
    // Required parameters first
    if (a.isRequired !== b.isRequired) {
      return a.isRequired ? -1 : 1;
    }
    // Then by type importance
    return typeOrder[a.parameterType] - typeOrder[b.parameterType];
  });
}

/**
 * Auto-detect field mapping from schema
 * Returns best-guess mapping for common fields
 */
export function autoDetectFieldMapping(schema: ReplicateSchema): {
  promptField?: string;
  imageField1?: string;
  imageField2?: string;
} {
  console.log('🗺️ Auto-detecting field mapping...');
  const classified = getClassifiedParameters(schema);

  const promptFields = classified.filter(p => p.parameterType === 'prompt');
  const imageFields = classified.filter(p => p.parameterType === 'image');

  console.log(`📝 Found ${promptFields.length} prompt field(s), ${imageFields.length} image field(s)`);

  const mapping: any = {};

  // Auto-detect prompt field (prefer required, then first found)
  if (promptFields.length > 0) {
    const requiredPrompt = promptFields.find(p => p.isRequired);
    mapping.promptField = requiredPrompt?.name || promptFields[0].name;
    console.log('✅ Prompt field:', mapping.promptField);
  }

  // Auto-detect image fields
  if (imageFields.length > 0) {
    mapping.imageField1 = imageFields[0].name;
    console.log('✅ Image field 1:', mapping.imageField1);
  }
  if (imageFields.length > 1) {
    mapping.imageField2 = imageFields[1].name;
    console.log('✅ Image field 2:', mapping.imageField2);
  }

  return mapping;
}

/**
 * Estimate pricing based on Replicate model tier
 * (Actual pricing would need to be fetched from Replicate's pricing API if available)
 */
export function estimatePricing(model: ReplicateModel): number {
  // Default cost: 100 coins
  // In a full implementation, this would fetch from Replicate's pricing API
  // or use a heuristic based on model type/size

  return 100;
}
