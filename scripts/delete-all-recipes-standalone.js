/**
 * Standalone script to delete all published community recipes from Supabase
 *
 * Usage: node scripts/delete-all-recipes-standalone.js
 */

const { createClient } = require('@supabase/supabase-js');

// Load Supabase credentials from environment or hardcode them
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
  console.log('\nPlease set them in your environment or .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function deleteAllPublicRecipes() {
  try {
    console.log('Deleting all public recipes...');

    // First, get count of recipes to delete
    const { count, error: countError } = await supabase
      .from('public_recipes')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting recipes:', countError);
      throw countError;
    }

    console.log(`Found ${count || 0} recipes to delete`);

    if (count === 0) {
      console.log('No recipes to delete');
      return 0;
    }

    // Delete all recipes (using a condition that matches all rows)
    const { error } = await supabase
      .from('public_recipes')
      .delete()
      .not('id', 'is', null);

    if (error) {
      console.error('Error deleting all recipes:', error);
      throw error;
    }

    console.log(`Successfully deleted ${count} public recipes`);
    return count || 0;
  } catch (error) {
    console.error('Error in deleteAllPublicRecipes:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('⚠️  WARNING: This will delete ALL published community recipes!');
    console.log('Starting deletion in 3 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    const deletedCount = await deleteAllPublicRecipes();

    console.log('\n✅ Success!');
    console.log(`Deleted ${deletedCount} recipe(s) from Supabase`);
  } catch (error) {
    console.error('\n❌ Error:', error.message || error);
    process.exit(1);
  }
}

main();
