/**
 * Recipe Database Queries
 *
 * CRUD operations for recipes in SQLite
 */

import { db } from '../database/db';
import type { Recipe, RecipeExecution } from './types';

/**
 * Insert a new recipe into the database
 */
export async function insertRecipe(recipe: Recipe): Promise<void> {
  const database = db.getDatabase();

  await database.runAsync(
    `INSERT INTO recipes (
      id, name, input_type, input_description, instructions, photo_input_label, is_public, steps,
      example_input_uri, example_result_uri, created_at, updated_at, is_favorite, supabase_recipe_id, is_hidden, reference_image_uris
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recipe.id,
      recipe.name,
      recipe.inputType,
      recipe.inputDescription || null,
      recipe.instructions || null,
      recipe.photoInputLabel || null,
      recipe.isPublic ? 1 : 0,
      JSON.stringify(recipe.steps),
      recipe.exampleInputUri || null,
      recipe.exampleResultUri || null,
      recipe.createdAt,
      recipe.updatedAt,
      recipe.isFavorite ? 1 : 0,
      recipe.supabaseRecipeId || null,
      recipe.isHidden ? 1 : 0,
      recipe.referenceImageUris?.length ? JSON.stringify(recipe.referenceImageUris) : null,
    ]
  );
}

/**
 * Get all recipes ordered by creation date
 */
export async function getRecipes(limit: number = 100, offset: number = 0): Promise<Recipe[]> {
  const database = db.getDatabase();

  const rows = await database.getAllAsync<any>(
    `SELECT * FROM recipes ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return rows.map(rowToRecipe);
}

/**
 * Get a single recipe by ID
 */
export async function getRecipe(id: string): Promise<Recipe | null> {
  console.log('🔍 getRecipe called with ID:', id);
  console.log('🔍 ID type:', typeof id);
  console.log('🔍 ID length:', id?.length);

  const database = db.getDatabase();

  const row = await database.getFirstAsync<any>(
    `SELECT * FROM recipes WHERE id = ?`,
    [id]
  );

  console.log('🔍 Database query result:', row ? 'FOUND' : 'NOT FOUND');
  if (row) {
    console.log('🔍 Found recipe:', row.name);
  }

  return row ? rowToRecipe(row) : null;
}

/**
 * Update an existing recipe
 */
export async function updateRecipe(id: string, updates: Partial<Recipe>): Promise<void> {
  const database = db.getDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.inputType !== undefined) {
    fields.push('input_type = ?');
    values.push(updates.inputType);
  }
  if (updates.inputDescription !== undefined) {
    fields.push('input_description = ?');
    values.push(updates.inputDescription);
  }
  if (updates.instructions !== undefined) {
    fields.push('instructions = ?');
    values.push(updates.instructions || null);
  }
  if (updates.photoInputLabel !== undefined) {
    fields.push('photo_input_label = ?');
    values.push(updates.photoInputLabel || null);
  }
  if (updates.isPublic !== undefined) {
    fields.push('is_public = ?');
    values.push(updates.isPublic ? 1 : 0);
  }
  if (updates.steps !== undefined) {
    fields.push('steps = ?');
    values.push(JSON.stringify(updates.steps));
  }
  if (updates.exampleInputUri !== undefined) {
    fields.push('example_input_uri = ?');
    values.push(updates.exampleInputUri);
  }
  if (updates.exampleResultUri !== undefined) {
    fields.push('example_result_uri = ?');
    values.push(updates.exampleResultUri);
  }
  if (updates.isFavorite !== undefined) {
    fields.push('is_favorite = ?');
    values.push(updates.isFavorite ? 1 : 0);
  }
  if (updates.supabaseRecipeId !== undefined) {
    fields.push('supabase_recipe_id = ?');
    values.push(updates.supabaseRecipeId);
  }
  if (updates.isHidden !== undefined) {
    fields.push('is_hidden = ?');
    values.push(updates.isHidden ? 1 : 0);
  }
  if (updates.referenceImageUris !== undefined) {
    fields.push('reference_image_uris = ?');
    values.push(updates.referenceImageUris?.length ? JSON.stringify(updates.referenceImageUris) : null);
  }

  // Always update the updated_at timestamp
  fields.push('updated_at = ?');
  values.push(Date.now());

  values.push(id);

  if (fields.length > 0) {
    await database.runAsync(
      `UPDATE recipes SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }
}

/**
 * Delete a recipe
 */
export async function deleteRecipe(id: string): Promise<void> {
  const database = db.getDatabase();
  await database.runAsync(`DELETE FROM recipes WHERE id = ?`, [id]);
}

/**
 * Get favorite recipes
 */
export async function getFavoriteRecipes(): Promise<Recipe[]> {
  const database = db.getDatabase();

  const rows = await database.getAllAsync<any>(
    `SELECT * FROM recipes WHERE is_favorite = 1 ORDER BY created_at DESC`
  );

  return rows.map(rowToRecipe);
}

/**
 * Insert a recipe execution
 */
export async function insertRecipeExecution(execution: RecipeExecution): Promise<void> {
  const database = db.getDatabase();

  await database.runAsync(
    `INSERT INTO recipe_executions (
      id, recipe_id, status, current_step_index, started_at, completed_at, error, step_results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      execution.id,
      execution.recipeId,
      execution.status,
      execution.currentStepIndex,
      execution.startedAt,
      execution.completedAt || null,
      execution.error || null,
      JSON.stringify(execution.stepResults),
    ]
  );
}

/**
 * Update a recipe execution
 */
export async function updateRecipeExecution(
  id: string,
  updates: Partial<RecipeExecution>
): Promise<void> {
  const database = db.getDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.currentStepIndex !== undefined) {
    fields.push('current_step_index = ?');
    values.push(updates.currentStepIndex);
  }
  if (updates.completedAt !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completedAt);
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    values.push(updates.error);
  }
  if (updates.stepResults !== undefined) {
    fields.push('step_results = ?');
    values.push(JSON.stringify(updates.stepResults));
  }

  values.push(id);

  if (fields.length > 0) {
    await database.runAsync(
      `UPDATE recipe_executions SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }
}

/**
 * Remove duplicate recipes (keeps the oldest one for each supabaseRecipeId)
 * Returns count of deleted duplicates
 */
export async function removeDuplicateRecipes(): Promise<{ deleted: number; kept: number }> {
  const database = db.getDatabase();

  // Get all recipes
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM recipes ORDER BY created_at ASC`
  );

  const recipes = rows.map(rowToRecipe);

  // Group by supabaseRecipeId (only for imported recipes)
  const bySupabaseId = new Map<string, Recipe[]>();
  const localOnlyRecipes: Recipe[] = [];

  for (const recipe of recipes) {
    if (recipe.supabaseRecipeId) {
      const existing = bySupabaseId.get(recipe.supabaseRecipeId) || [];
      existing.push(recipe);
      bySupabaseId.set(recipe.supabaseRecipeId, existing);
    } else {
      localOnlyRecipes.push(recipe);
    }
  }

  // Also group by name (for local recipes that might be duplicates)
  const byName = new Map<string, Recipe[]>();
  for (const recipe of localOnlyRecipes) {
    const existing = byName.get(recipe.name) || [];
    existing.push(recipe);
    byName.set(recipe.name, existing);
  }

  let deleted = 0;
  const toDelete: string[] = [];

  // Find duplicates by supabaseRecipeId (keep first/oldest)
  for (const [supabaseId, duplicates] of bySupabaseId) {
    if (duplicates.length > 1) {
      console.log(`Found ${duplicates.length} duplicates for supabase ID ${supabaseId}`);
      // Keep the first one (oldest), delete the rest
      for (let i = 1; i < duplicates.length; i++) {
        toDelete.push(duplicates[i].id);
      }
    }
  }

  // Find duplicates by name (for local recipes, keep first/oldest)
  for (const [name, duplicates] of byName) {
    if (duplicates.length > 1) {
      console.log(`Found ${duplicates.length} local duplicates named "${name}"`);
      // Keep the first one (oldest), delete the rest
      for (let i = 1; i < duplicates.length; i++) {
        toDelete.push(duplicates[i].id);
      }
    }
  }

  // Delete duplicates
  for (const id of toDelete) {
    await database.runAsync(`DELETE FROM recipes WHERE id = ?`, [id]);
    deleted++;
  }

  const kept = recipes.length - deleted;
  console.log(`Removed ${deleted} duplicate recipes, kept ${kept}`);

  return { deleted, kept };
}

/**
 * Helper function to convert database row to Recipe object
 */
function rowToRecipe(row: any): Recipe {
  return {
    id: row.id,
    name: row.name,
    inputType: row.input_type,
    inputDescription: row.input_description,
    instructions: row.instructions ?? undefined,
    photoInputLabel: row.photo_input_label ?? undefined,
    isPublic: Boolean(row.is_public),
    supabaseRecipeId: row.supabase_recipe_id,
    steps: JSON.parse(row.steps),
    referenceImageUris: row.reference_image_uris ? JSON.parse(row.reference_image_uris) : undefined,
    exampleResultUri: row.example_result_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isFavorite: Boolean(row.is_favorite),
    isHidden: Boolean(row.is_hidden),
  };
}
