import { RecipeStep, Recipe } from './types';

export const RECIPE_FLAT_COST_COINS = 50;

export function calculateRecipeCost(_steps: RecipeStep[]): number {
  return RECIPE_FLAT_COST_COINS;
}

export function calculateStepCost(_step: RecipeStep): number {
  return RECIPE_FLAT_COST_COINS;
}

export function formatRecipeCost(_steps: RecipeStep[]): string {
  return `${RECIPE_FLAT_COST_COINS} 🪙`;
}

export function formatRecipeCostFromRecipe(_recipe: Recipe): string {
  return `${RECIPE_FLAT_COST_COINS} 🪙`;
}

export function getRecipeCostBreakdown(steps: RecipeStep[]): Array<{
  stepId: string;
  stepOrder: number;
  cost: number;
  promptCount: number;
}> {
  return steps.map(step => ({
    stepId: step.id,
    stepOrder: step.order,
    cost: RECIPE_FLAT_COST_COINS,
    promptCount: step.prompts.length,
  }));
}

export function canAffordRecipe(userBalance: number, _steps: RecipeStep[]): boolean {
  return userBalance >= RECIPE_FLAT_COST_COINS;
}
