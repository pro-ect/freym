/**
 * Supabase Recipe Integration
 *
 * Functions for publishing, importing, and browsing public recipes
 */

import { supabase } from '../supabase';
import { compressImageForRecipe, downloadImageToLocal } from './imageCompression';
import { calculateRecipeCost } from './pricing';
import { generateId } from './utils';
import { insertRecipe, updateRecipe } from './recipeQueries';
import type { Recipe } from './types';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';

export interface PublicRecipe {
  id: string;
  user_id: string;
  recipe_data: {
    name: string;
    inputType: 'images' | 'prompt';
    inputDescription?: string;
    instructions?: string;
    photoInputLabel?: string;
    steps: any[];
    referenceImageUrls?: string[];
  };
  /** @deprecated migrated into recipe_data.referenceImageUrls — column kept nullable for back-compat */
  example_input_url?: string;
  example_result_url?: string;
  view_count: number;
  like_count: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  category: string;
  estimated_cost: number;
  step_count: number;
  is_public: boolean;
  is_onboarding: boolean;
  min_app_version?: string;
  // Home-screen additive fields (SDK 55+ home redesign):
  category_tags?: string[];
  example_result_urls?: string[];
  featured_image_url?: string | null;
  is_featured?: boolean;
  featured_order?: number | null;
}

export interface BrowseOptions {
  limit?: number;
  offset?: number;
  category?: string;
  categoryTag?: string;
  tags?: string[];
  sortBy?: 'latest' | 'popular' | 'trending' | 'pinned';
  onboardingOnly?: boolean;
}

const STORAGE_BUCKET = 'recipe-images';

/**
 * Publish a local recipe to Supabase for sharing
 */
export async function publishRecipeToSupabase(
  recipe: Recipe,
  options: {
    category?: string;
    tags?: string[];
  } = {}
): Promise<string> {
  // Admin home-screen fields are carried on the recipe object itself so existing
  // callers don't need to thread them through options.
  const categoryTags = recipe.categoryTags ?? [];
  const isFeatured = recipe.isFeatured ?? false;
  const featuredOrder = recipe.featuredOrder ?? null;
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    // Step 1: Compress and upload example images if they exist
    // Make this optional - if images fail to upload, continue anyway
    let exampleResultUrl: string | null = null;

    // Photoshoot photos (multi). First entry doubles as the legacy example_result_url for prod 1.0.0.
    const photoshootSourceUris = (recipe.exampleResultUris && recipe.exampleResultUris.length > 0)
      ? recipe.exampleResultUris
      : (recipe.exampleResultUri ? [recipe.exampleResultUri] : []);
    const exampleResultUrls: string[] = [];
    for (let i = 0; i < photoshootSourceUris.length; i++) {
      const src = photoshootSourceUris[i];
      // Already an HTTPS URL from a previous upload — reuse as-is.
      if (/^https?:\/\//.test(src)) {
        exampleResultUrls.push(src);
        continue;
      }
      try {
        const url = await uploadCompressedImage(
          src,
          user.id,
          recipe.id,
          (i === 0 ? 'result' : (`result-${i}` as any))
        );
        exampleResultUrls.push(url);
      } catch (error) {
        console.warn(`Failed to upload photoshoot image ${i}, skipping:`, error);
      }
    }
    exampleResultUrl = exampleResultUrls[0] ?? null;

    // Optional featured override image (hero-only).
    let featuredImageUrl: string | null = null;
    if (recipe.featuredImageUri) {
      if (/^https?:\/\//.test(recipe.featuredImageUri)) {
        featuredImageUrl = recipe.featuredImageUri;
      } else {
        try {
          featuredImageUrl = await uploadCompressedImage(
            recipe.featuredImageUri,
            user.id,
            recipe.id,
            'featured' as any
          );
        } catch (error) {
          console.warn('Failed to upload featured image, skipping:', error);
        }
      }
    }

    // Step 2: Upload reference images if they exist
    const referenceImageUrls: string[] = [];
    if (recipe.referenceImageUris && recipe.referenceImageUris.length > 0) {
      for (let i = 0; i < recipe.referenceImageUris.length; i++) {
        try {
          const url = await uploadCompressedImage(
            recipe.referenceImageUris[i],
            user.id,
            recipe.id,
            `ref-${i}` as any
          );
          referenceImageUrls.push(url);
        } catch (error) {
          console.warn(`Failed to upload reference image ${i}, skipping:`, error);
        }
      }
    }

    // Step 3: Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = profile?.is_admin || false;

    // Step 4: Prepare recipe data (remove local-only fields)
    const recipeData: Record<string, any> = {
      name: recipe.name,
      inputType: recipe.inputType,
      inputDescription: recipe.inputDescription,
      instructions: recipe.instructions,
      photoInputLabel: recipe.photoInputLabel,
      steps: recipe.steps,
    };
    if (referenceImageUrls.length > 0) {
      recipeData.referenceImageUrls = referenceImageUrls;
    }

    // Step 5: Insert into public_recipes table
    // Only admin recipes are set to is_public = true (visible in browse)
    // All users can create recipes and get share links, but only admins appear in public browse
    // Recipes with reference images are hidden from older app versions via min_app_version
    const hasReferenceImages = referenceImageUrls.length > 0;
    const isAnyPhotoRecipe = !!recipe.photoInputLabel?.trim();
    // is_public drives old-app visibility (old apps query `is_public = true` directly).
    // Hide ref-image recipes and any-photo recipes from the old app; the new app sees
    // them via the `public_recipes_v2` view (which also includes `is_v2_published`).
    const isPublicForOldApp = isAdmin && !hasReferenceImages && !isAnyPhotoRecipe;
    const isPublicForNewApp = isAdmin;
    const { data, error } = await supabase
      .from('public_recipes')
      .insert({
        user_id: user.id,
        recipe_data: recipeData,
        example_result_url: exampleResultUrl,
        tags: options.tags || [],
        category: options.category || 'general',
        step_count: recipe.steps.length,
        estimated_cost: calculateRecipeCost(recipe.steps),
        is_public: isPublicForOldApp,
        is_v2_published: isPublicForNewApp,
        is_onboarding: recipe.isOnboarding || false,
        category_tags: categoryTags,
        example_result_urls: exampleResultUrls,
        featured_image_url: featuredImageUrl,
        is_featured: isFeatured,
        featured_order: featuredOrder,
        ...((hasReferenceImages || isAnyPhotoRecipe) && { min_app_version: '1.1' }),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error publishing recipe:', error);
      throw error;
    }

    console.log('Recipe published successfully:', data.id);
    if (isAdmin) {
      console.log('Recipe is public (admin) and will appear in browse');
    } else {
      console.log('Recipe is private (non-admin) but share link is available');
    }

    // Step 6: Save Supabase recipe ID to local recipe
    await updateRecipe(recipe.id, {
      supabaseRecipeId: data.id,
    });

    // Auto-copy share link to clipboard
    const shareLink = generateRecipeShareLink(data.id);
    await Clipboard.setStringAsync(shareLink);

    return data.id;
  } catch (error) {
    console.error('Error in publishRecipeToSupabase:', error);
    throw error;
  }
}

/**
 * Upload a compressed image to Supabase Storage
 */
async function uploadCompressedImage(
  localUri: string,
  userId: string,
  recipeId: string,
  type: 'input' | 'result'
): Promise<string> {
  try {
    // Step 1: Compress image
    console.log(`Compressing ${type} image from:`, localUri);
    const compressed = await compressImageForRecipe(localUri);
    console.log(`Compressed ${type} image to ${compressed.sizeKB}KB`);

    // Step 2: Read file as base64
    const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Step 3: Convert base64 to ArrayBuffer (React Native doesn't support blob properly)
    const arrayBuffer = decode(base64);

    // Step 4: Upload to Supabase Storage
    const filename = `${userId}/${recipeId}/${type}.jpg`;
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true, // Replace if exists
      });

    if (error) {
      console.error('Error uploading to storage:', error);
      throw error;
    }

    // Step 4: Get public URL with cache-bust suffix.
    // Why: storage path is deterministic (`${userId}/${recipeId}/${type}.jpg`), so
    // every save writes to the same URL — Supabase CDN (cacheControl 3600s) and
    // expo-image disk cache both key by URL and would keep serving stale bytes.
    // Appending `?v=<timestamp>` makes each save produce a unique URL.
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filename);

    return `${urlData.publicUrl}?v=${Date.now()}`;
  } catch (error) {
    console.error('Error uploading compressed image:', error);
    throw error;
  }
}

/**
 * Fetch a public recipe from Supabase (without importing to local storage)
 * This is used to view shared recipes
 */
export async function fetchPublicRecipe(
  recipeId: string
): Promise<PublicRecipe | null> {
  try {
    const { data, error } = await supabase
      .from('public_recipes')
      .select('*')
      .eq('id', recipeId)
      .single();

    if (error) {
      console.error('Error fetching public recipe:', error);
      return null;
    }

    // Increment view count
    await incrementRecipeViews(recipeId);

    return data;
  } catch (error) {
    console.error('Error in fetchPublicRecipe:', error);
    return null;
  }
}

/**
 * Import a public recipe from Supabase to local storage
 */
export async function importRecipeFromSupabase(
  recipeId: string,
  isHidden: boolean = false
): Promise<Recipe> {
  try {
    // Step 1: Fetch recipe from Supabase
    const { data, error } = await supabase
      .from('public_recipes')
      .select('*')
      .eq('id', recipeId)
      .single();

    if (error) {
      console.error('Error fetching recipe:', error);
      throw error;
    }

    if (!data) {
      throw new Error('Recipe not found');
    }

    // Step 2: Download example images to local storage
    let exampleResultUri: string | undefined;

    if (data.example_result_url) {
      try {
        exampleResultUri = await downloadImageToLocal(data.example_result_url);
      } catch (error) {
        console.warn('Failed to download result image:', error);
      }
    }

    // Step 3: Download reference images if they exist
    let referenceImageUris: string[] | undefined;
    if (data.recipe_data.referenceImageUrls && data.recipe_data.referenceImageUrls.length > 0) {
      const downloadedRefs: string[] = [];
      for (const url of data.recipe_data.referenceImageUrls) {
        try {
          const localUri = await downloadImageToLocal(url);
          downloadedRefs.push(localUri);
        } catch (error) {
          console.warn('Failed to download reference image:', error);
        }
      }
      if (downloadedRefs.length > 0) {
        referenceImageUris = downloadedRefs;
      }
    }

    // Step 4: Create local Recipe object
    const localRecipe: Recipe = {
      id: generateId(), // New local ID
      name: data.recipe_data.name,
      inputType: data.recipe_data.inputType,
      inputDescription: data.recipe_data.inputDescription,
      instructions: data.recipe_data.instructions,
      photoInputLabel: data.recipe_data.photoInputLabel,
      isPublic: false, // Mark as private (imported copy)
      supabaseRecipeId: recipeId, // Store reference to original public recipe
      steps: data.recipe_data.steps,
      referenceImageUris,
      exampleResultUri,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isFavorite: false,
      isHidden, // Hidden flag (true for temporary imports, false for explicit saves)
    };

    // Step 5: Save to local SQLite
    await insertRecipe(localRecipe);

    // Step 6: Increment view count on Supabase (only if not already viewed above)
    await incrementRecipeViews(recipeId);

    console.log('Recipe imported successfully:', localRecipe.id);
    return localRecipe;
  } catch (error) {
    console.error('Error importing recipe:', error);
    throw error;
  }
}

/**
 * Browse public recipes from Supabase
 */
export async function browsePublicRecipes(
  options: BrowseOptions = {}
): Promise<PublicRecipe[]> {
  const {
    limit = 20,
    offset = 0,
    category,
    categoryTag,
    tags,
    sortBy = 'latest',
    onboardingOnly = false,
  } = options;

  try {
    console.log('[Recipes] Fetching public recipes...');
    // The v2 view returns rows visible to the new app (is_public OR is_v2_published).
    let query = supabase
      .from('public_recipes_v2')
      .select('*');

    // Apply filters
    if (onboardingOnly) {
      query = query.eq('is_onboarding', true);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (categoryTag) {
      query = query.contains('category_tags', [categoryTag]);
    }

    if (tags && tags.length > 0) {
      query = query.contains('tags', tags);
    }

    // Apply sorting
    switch (sortBy) {
      case 'pinned':
        // Admin-controlled manual order (pin_order), newest first as tiebreaker.
        query = query
          .order('pin_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false });
        break;
      case 'popular':
        query = query.order('like_count', { ascending: false });
        break;
      case 'trending':
        query = query.order('view_count', { ascending: false });
        break;
      case 'latest':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error('[Recipes] Error browsing recipes:', error);
      // Return empty array instead of throwing - graceful degradation
      return [];
    }

    console.log('[Recipes] Fetched', data?.length || 0, 'recipes');
    return data || [];
  } catch (error) {
    console.error('[Recipes] Error in browsePublicRecipes:', error);
    // Return empty array instead of throwing - app should work even if Supabase is down
    return [];
  }
}

/**
 * Increment view count for a recipe
 */
export async function incrementRecipeViews(recipeId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_recipe_views', {
      recipe_id: recipeId,
    });

    if (error) {
      console.error('Error incrementing views:', error);
    }
  } catch (error) {
    console.error('Error in incrementRecipeViews:', error);
  }
}

/**
 * Like a recipe
 */
export async function likeRecipe(recipeId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { error } = await supabase
      .from('recipe_likes')
      .insert({
        recipe_id: recipeId,
        user_id: user.id,
      });

    if (error) {
      console.error('Error liking recipe:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in likeRecipe:', error);
    throw error;
  }
}

/**
 * Unlike a recipe
 */
export async function unlikeRecipe(recipeId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { error } = await supabase
      .from('recipe_likes')
      .delete()
      .eq('recipe_id', recipeId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error unliking recipe:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in unlikeRecipe:', error);
    throw error;
  }
}

/**
 * Check if current user has liked a recipe
 */
export async function isRecipeLiked(recipeId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from('recipe_likes')
      .select('id')
      .eq('recipe_id', recipeId)
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking like status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isRecipeLiked:', error);
    return false;
  }
}

/**
 * Delete a published recipe (user must own it)
 */
export async function deletePublicRecipe(recipeId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('public_recipes')
      .delete()
      .eq('id', recipeId);

    if (error) {
      console.error('Error deleting recipe:', error);
      throw error;
    }

    console.log('Recipe deleted successfully');
  } catch (error) {
    console.error('Error in deletePublicRecipe:', error);
    throw error;
  }
}

/**
 * Update a published recipe on Supabase
 * Only admins can update public recipes
 */
export async function updatePublicRecipe(
  supabaseRecipeId: string,
  recipe: Recipe
): Promise<void> {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    // Upload updated example images if they exist
    let exampleResultUrl: string | null = null;

    // Photoshoot photos (multi). Re-upload local URIs, pass through existing HTTPS URLs.
    const photoshootSourceUris = (recipe.exampleResultUris && recipe.exampleResultUris.length > 0)
      ? recipe.exampleResultUris
      : (recipe.exampleResultUri ? [recipe.exampleResultUri] : []);
    const exampleResultUrls: string[] = [];
    for (let i = 0; i < photoshootSourceUris.length; i++) {
      const src = photoshootSourceUris[i];
      if (/^https?:\/\//.test(src)) {
        exampleResultUrls.push(src);
        continue;
      }
      try {
        const url = await uploadCompressedImage(
          src,
          user.id,
          recipe.id,
          (i === 0 ? 'result' : (`result-${i}` as any))
        );
        exampleResultUrls.push(url);
      } catch (error) {
        console.warn(`Failed to upload photoshoot image ${i}, skipping:`, error);
      }
    }
    if (exampleResultUrls.length > 0) {
      exampleResultUrl = exampleResultUrls[0];
    }

    // Featured override (single, hero-only)
    let featuredImageUrl: string | null = null;
    let touchedFeatured = false;
    if (recipe.featuredImageUri !== undefined) {
      touchedFeatured = true;
      if (!recipe.featuredImageUri) {
        featuredImageUrl = null;
      } else if (/^https?:\/\//.test(recipe.featuredImageUri)) {
        featuredImageUrl = recipe.featuredImageUri;
      } else {
        try {
          featuredImageUrl = await uploadCompressedImage(
            recipe.featuredImageUri,
            user.id,
            recipe.id,
            'featured' as any
          );
        } catch (error) {
          console.warn('Failed to upload featured image on update, keeping existing:', error);
          touchedFeatured = false;
        }
      }
    }

    // Upload reference images if they exist
    const referenceImageUrls: string[] = [];
    if (recipe.referenceImageUris && recipe.referenceImageUris.length > 0) {
      for (let i = 0; i < recipe.referenceImageUris.length; i++) {
        try {
          const url = await uploadCompressedImage(
            recipe.referenceImageUris[i],
            user.id,
            recipe.id,
            `ref-${i}` as any
          );
          referenceImageUrls.push(url);
        } catch (error) {
          console.warn(`Failed to upload reference image ${i}, keeping existing:`, error);
        }
      }
    }

    // Prepare recipe data
    const recipeData: Record<string, any> = {
      name: recipe.name,
      inputType: recipe.inputType,
      inputDescription: recipe.inputDescription,
      instructions: recipe.instructions,
      photoInputLabel: recipe.photoInputLabel,
      steps: recipe.steps,
    };
    if (referenceImageUrls.length > 0) {
      recipeData.referenceImageUrls = referenceImageUrls;
    }

    // Build update object
    const hasReferenceImages = referenceImageUrls.length > 0;
    const isAnyPhotoRecipe = !!recipe.photoInputLabel?.trim();
    const updateData: Record<string, any> = {
      recipe_data: recipeData,
      step_count: recipe.steps.length,
      estimated_cost: calculateRecipeCost(recipe.steps),
      updated_at: new Date().toISOString(),
      is_onboarding: recipe.isOnboarding || false,
      // Old apps query `is_public = true` directly. Hide ref-image and any-photo
      // recipes from them; the new app picks them up via the v2 view.
      is_public: !hasReferenceImages && !isAnyPhotoRecipe,
      is_v2_published: true,
      min_app_version: (hasReferenceImages || isAnyPhotoRecipe) ? '1.1' : '1.0.0',
    };

    if (recipe.categoryTags !== undefined) {
      updateData.category_tags = recipe.categoryTags;
    }
    if (recipe.isFeatured !== undefined) {
      updateData.is_featured = recipe.isFeatured;
    }
    if (recipe.featuredOrder !== undefined) {
      updateData.featured_order = recipe.featuredOrder;
    }
    // Always write the array if we built one — lets admins remove photos.
    if (recipe.exampleResultUris !== undefined) {
      updateData.example_result_urls = exampleResultUrls;
    }
    if (touchedFeatured) {
      updateData.featured_image_url = featuredImageUrl;
    }

    // Only update images if new ones were uploaded
    if (exampleResultUrl) {
      updateData.example_result_url = exampleResultUrl;
    }

    // Update the recipe
    const { error } = await supabase
      .from('public_recipes')
      .update(updateData)
      .eq('id', supabaseRecipeId);

    if (error) {
      console.error('Error updating public recipe:', error);
      throw error;
    }

    console.log('Public recipe updated successfully:', supabaseRecipeId);
  } catch (error) {
    console.error('Error in updatePublicRecipe:', error);
    throw error;
  }
}

/**
 * Generate a shareable web link for a recipe
 * Uses Vercel Edge Function for deep linking
 */
export function generateRecipeShareLink(recipeId: string): string {
  return `https://picsroom-deeplink.vercel.app/api/deeplink?open=recipe/${recipeId}`;
}

/**
 * Get the Supabase ID for a published recipe by local ID
 */
export async function getPublishedRecipeId(localRecipeId: string): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return null;
    }

    // Query for public recipes with matching name (as we don't store local ID in Supabase)
    // This is a workaround - ideally we'd store a mapping
    const { data, error } = await supabase
      .from('public_recipes')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error getting published recipe ID:', error);
    return null;
  }
}

/**
 * Delete all published community recipes (DANGER: This deletes everything!)
 */
export async function deleteAllPublicRecipes(): Promise<number> {
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

    console.log(`Found ${count} recipes to delete`);

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

/**
 * Get the current user's published recipes from Supabase
 */
export async function getMyPublishedRecipes(): Promise<PublicRecipe[]> {
  try {
    console.log('📚 [Supabase] Fetching my published recipes...');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('📚 [Supabase] No user logged in');
      return [];
    }
    console.log('📚 [Supabase] User ID:', user.id);

    const { data, error } = await supabase
      .from('public_recipes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('📚 [Supabase] Error fetching my published recipes:', error);
      throw error;
    }

    console.log('📚 [Supabase] Found recipes:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('📚 [Supabase] Error in getMyPublishedRecipes:', error);
    return [];
  }
}
