/**
 * Recipe Utilities
 */

/**
 * Generate a unique ID for recipes and recipe steps
 */
export function generateId(): string {
  return `recipe_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}
