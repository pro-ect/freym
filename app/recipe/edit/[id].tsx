/**
 * Recipe Edit Screen - Opens the builder modal for editing
 * Supports both local recipes and public recipes from Supabase (admin only)
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { db } from '../../../lib/database/db';
import { getRecipe } from '../../../lib/recipes/recipeQueries';
import { fetchPublicRecipe, type PublicRecipe } from '../../../lib/recipes/supabaseRecipes';
import { downloadImageToLocal } from '../../../lib/recipes/imageCompression';
import type { Recipe } from '../../../lib/recipes/types';
import RecipeBuilderModal from '../../components/RecipeBuilderModal';
import { useSettings } from '../../../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';

export default function RecipeEditScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin } = useSettings();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadRecipe();
  }, [id]);

  /**
   * Convert a PublicRecipe from Supabase to local Recipe format
   */
  const convertPublicRecipeToLocal = async (publicRecipe: PublicRecipe): Promise<Recipe> => {
    let exampleResultUri: string | undefined;

    if (publicRecipe.example_result_url) {
      try {
        exampleResultUri = await downloadImageToLocal(publicRecipe.example_result_url);
      } catch (error) {
        console.warn('Failed to download result image:', error);
      }
    }

    let referenceImageUris: string[] | undefined;
    const refUrls = publicRecipe.recipe_data.referenceImageUrls;
    if (refUrls && refUrls.length > 0) {
      const downloaded: string[] = [];
      for (const url of refUrls) {
        try {
          downloaded.push(await downloadImageToLocal(url));
        } catch (error) {
          console.warn('Failed to download reference image:', error);
        }
      }
      if (downloaded.length > 0) referenceImageUris = downloaded;
    }

    return {
      id: publicRecipe.id, // Use the Supabase ID
      name: publicRecipe.recipe_data.name,
      inputType: publicRecipe.recipe_data.inputType,
      inputDescription: publicRecipe.recipe_data.inputDescription,
      instructions: publicRecipe.recipe_data.instructions,
      photoInputLabel: publicRecipe.recipe_data.photoInputLabel,
      isPublic: true,
      isOnboarding: publicRecipe.is_onboarding || false,
      supabaseRecipeId: publicRecipe.id,
      steps: publicRecipe.recipe_data.steps,
      referenceImageUris,
      exampleResultUri,
      createdAt: new Date(publicRecipe.created_at).getTime(),
      updatedAt: new Date(publicRecipe.updated_at).getTime(),
      isFavorite: false,
      isHidden: false,
    };
  };

  const loadRecipe = async () => {
    try {
      console.log('📝 Loading recipe for edit with ID:', id);
      await db.initialize();

      // Step 1: Try to load from local database first
      const localRecipe = await getRecipe(id);

      if (localRecipe) {
        console.log('✅ Recipe loaded from local database:', localRecipe.name);
        setRecipe(localRecipe);
      } else {
        // Step 2: Not found locally, try fetching from Supabase (for public recipes)
        console.log('🌐 Recipe not found locally, fetching from Supabase...');
        const publicRecipe = await fetchPublicRecipe(id);

        if (publicRecipe) {
          console.log('✅ Public recipe loaded from Supabase:', publicRecipe.recipe_data.name);

          // Only admins can edit public recipes
          if (!isAdmin) {
            Alert.alert(
              t('recipeEdit.permissionDeniedTitle'),
              t('recipeEdit.permissionDeniedMessage'),
              [{ text: t('common.ok'), onPress: () => router.back() }]
            );
            return;
          }

          // Convert to local Recipe format
          const convertedRecipe = await convertPublicRecipeToLocal(publicRecipe);
          setRecipe(convertedRecipe);
        } else {
          console.log('❌ Recipe not found');
          Alert.alert(t('common.error'), t('recipeEdit.recipeNotFound'), [
            { text: t('common.ok'), onPress: () => router.back() }
          ]);
        }
      }
    } catch (error) {
      console.error('Error loading recipe:', error);
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    router.back();
  };

  const handleClose = () => {
    router.back();
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2196F3" />
      </View>
    );
  }

  return (
    <RecipeBuilderModal
      visible={true}
      recipe={recipe}
      onClose={handleClose}
      onSave={handleSave}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
