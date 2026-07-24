/**
 * Custom Models CRUD Operations
 *
 * Local SQLite storage for user-defined Replicate models
 */

import { db } from '../database/db';
import type {
  CustomModel,
  CreateCustomModelInput,
  UpdateCustomModelInput,
} from './types';

/**
 * Generate a unique ID for custom models
 */
function generateId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Get all custom models
 */
export async function getCustomModels(): Promise<CustomModel[]> {
  console.log('📚 Fetching all custom models from database...');
  await db.initialize();
  const database = db.getDatabase();

  const results = await database.getAllAsync<{
    id: string;
    replicate_model: string;
    version_hash: string | null;
    name: string;
    description: string | null;
    schema: string;
    field_mapping: string;
    optimization_settings: string | null;
    pricing: string | null;
    created_at: number;
    updated_at: number;
    last_used_at: number | null;
    usage_count: number;
  }>(`
    SELECT * FROM custom_models
    ORDER BY created_at DESC
  `);

  console.log(`✅ Found ${results.length} custom model(s)`);
  return results.map(row => ({
    id: row.id,
    replicate_model: row.replicate_model,
    version_hash: row.version_hash || undefined,
    name: row.name,
    description: row.description || undefined,
    schema: JSON.parse(row.schema),
    field_mapping: JSON.parse(row.field_mapping),
    optimization_settings: row.optimization_settings ? JSON.parse(row.optimization_settings) : undefined,
    pricing: row.pricing ? JSON.parse(row.pricing) : undefined,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
    usage_count: row.usage_count,
  }));
}

/**
 * Get a single custom model by ID
 */
export async function getCustomModel(id: string): Promise<CustomModel | null> {
  await db.initialize();
  const database = db.getDatabase();

  const row = await database.getFirstAsync<{
    id: string;
    replicate_model: string;
    version_hash: string | null;
    name: string;
    description: string | null;
    schema: string;
    field_mapping: string;
    optimization_settings: string | null;
    pricing: string | null;
    created_at: number;
    updated_at: number;
    last_used_at: number | null;
    usage_count: number;
  }>(`
    SELECT * FROM custom_models
    WHERE id = ?
  `, [id]);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    replicate_model: row.replicate_model,
    version_hash: row.version_hash || undefined,
    name: row.name,
    description: row.description || undefined,
    schema: JSON.parse(row.schema),
    field_mapping: JSON.parse(row.field_mapping),
    optimization_settings: row.optimization_settings ? JSON.parse(row.optimization_settings) : undefined,
    pricing: row.pricing ? JSON.parse(row.pricing) : undefined,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
    usage_count: row.usage_count,
  };
}

/**
 * Create a new custom model
 */
export async function createCustomModel(
  input: CreateCustomModelInput
): Promise<CustomModel> {
  console.log('🗄️ Creating custom model in database...');
  await db.initialize();
  const database = db.getDatabase();

  const id = generateId();
  const now = Date.now();
  console.log('📝 Generated ID:', id);

  const optimizationSettings = input.optimization_settings || {
    maxSizeKB: 700,
    maxWidth: 2048,
    format: 'jpg',
  };

  const pricing = input.pricing || {
    coinsPerGeneration: 100,
    fetchedFromApi: false,
  };

  console.log('💾 Inserting model record:', {
    id,
    replicate_model: input.replicate_model,
    name: input.name,
  });

  await database.runAsync(
    `INSERT INTO custom_models (
      id, replicate_model, version_hash, name, description,
      schema, field_mapping, optimization_settings, pricing,
      created_at, updated_at, usage_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.replicate_model,
      input.version_hash || null,
      input.name,
      input.description || null,
      JSON.stringify(input.schema),
      JSON.stringify(input.field_mapping),
      JSON.stringify(optimizationSettings),
      JSON.stringify(pricing),
      now,
      now,
      0,
    ]
  );

  console.log('✅ Model inserted, fetching back from database...');
  const model = await getCustomModel(id);
  if (!model) {
    console.error('❌ Failed to retrieve created model');
    throw new Error('Failed to create custom model');
  }

  console.log('✅ Custom model created successfully:', model.id);
  return model;
}

/**
 * Update an existing custom model
 */
export async function updateCustomModel(
  id: string,
  input: UpdateCustomModelInput
): Promise<CustomModel> {
  await db.initialize();
  const database = db.getDatabase();

  const now = Date.now();

  await database.runAsync(
    `UPDATE custom_models
    SET name = ?,
        description = ?,
        field_mapping = ?,
        optimization_settings = ?,
        pricing = ?,
        updated_at = ?
    WHERE id = ?`,
    [
      input.name || null,
      input.description || null,
      input.field_mapping ? JSON.stringify(input.field_mapping) : null,
      input.optimization_settings ? JSON.stringify(input.optimization_settings) : null,
      input.pricing ? JSON.stringify(input.pricing) : null,
      now,
      id,
    ]
  );

  const model = await getCustomModel(id);
  if (!model) {
    throw new Error('Failed to update custom model');
  }

  return model;
}

/**
 * Delete a custom model
 */
export async function deleteCustomModel(id: string): Promise<void> {
  await db.initialize();
  const database = db.getDatabase();

  await database.runAsync(
    'DELETE FROM custom_models WHERE id = ?',
    [id]
  );
}

/**
 * Increment usage count for a model
 */
export async function incrementModelUsage(id: string): Promise<void> {
  await db.initialize();
  const database = db.getDatabase();

  const now = Date.now();

  await database.runAsync(
    `UPDATE custom_models
    SET usage_count = usage_count + 1,
        last_used_at = ?
    WHERE id = ?`,
    [now, id]
  );
}

/**
 * Check if a model with the same replicate_model already exists
 */
export async function checkModelExists(replicateModel: string): Promise<boolean> {
  console.log('🔍 Checking if model exists:', replicateModel);
  await db.initialize();
  const database = db.getDatabase();

  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM custom_models WHERE replicate_model = ?',
    [replicateModel]
  );

  const exists = (result?.count || 0) > 0;
  console.log(`${exists ? '⚠️' : '✅'} Model ${exists ? 'already exists' : 'is new'}`);
  return exists;
}
