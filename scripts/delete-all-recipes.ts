/**
 * Script to delete all published community recipes from Supabase
 *
 * Usage: npx tsx scripts/delete-all-recipes.ts
 */

import { deleteAllPublicRecipes } from '../lib/recipes/supabaseRecipes';

async function main() {
  try {
    console.log('⚠️  WARNING: This will delete ALL published community recipes!');
    console.log('Starting deletion in 3 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    const deletedCount = await deleteAllPublicRecipes();

    console.log('\n✅ Success!');
    console.log(`Deleted ${deletedCount} recipe(s) from Supabase`);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
