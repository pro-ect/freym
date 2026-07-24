import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Plus } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Recipe } from '../../lib/recipes/types';
import MasonryGrid, { useImageDimensions } from './MasonryGrid';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type GridColumns = 2 | 3;

interface RecipeListProps {
  recipes: Recipe[];
  isLoading: boolean;
  onRefresh: () => void;
  onDelete?: (recipeId: string) => void;
  onEdit?: (recipe: Recipe) => void;
  onDuplicate?: (recipe: Recipe) => void;
  gridColumns: GridColumns;
  currentUserId?: string | null;
  showEditActions?: boolean; // Whether to show edit/delete actions
  onAddRecipe?: () => void; // Callback for adding a new recipe
}

export default function RecipeList({
  recipes,
  isLoading,
  onRefresh,
  onDelete,
  onEdit,
  onDuplicate,
  gridColumns,
  currentUserId,
  showEditActions = false,
  onAddRecipe,
}: RecipeListProps) {
  const { t } = useTranslation();

  // Sort recipes by creation date (newest first)
  const sortedRecipes = useMemo(() => {
    return [...recipes].sort((a, b) => b.createdAt - a.createdAt);
  }, [recipes]);

  const handleDeleteRecipe = useCallback((recipeId: string) => {
    if (!onDelete) return;

    Alert.alert(
      t('recipeList.deleteRecipeTitle'),
      t('recipeList.deleteRecipeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => onDelete(recipeId),
        },
      ]
    );
  }, [onDelete]);

  const renderAddRecipeCard = useCallback(() => {
    if (!onAddRecipe || !showEditActions) return null;
    
    const columnWidth = (SCREEN_WIDTH - (gridColumns + 1) * 12) / gridColumns;
    const imageHeight = 200; // Default height for add card

    return (
      <Pressable
        style={[styles.recipeCard, styles.addRecipeCard, { width: columnWidth, marginBottom: 12 }]}
        onPress={onAddRecipe}
      >
        <View style={[styles.addRecipeCardContent, { height: imageHeight }]}>
          <View style={styles.addRecipeCardInner}>
            <Plus size={24} color="#999" strokeWidth={2} />
            <Text style={styles.addRecipeCardTitle}>{t('recipeList.addRecipe')}</Text>
          </View>
        </View>
      </Pressable>
    );
  }, [gridColumns, onAddRecipe, showEditActions]);

  const renderRecipeCard = useCallback((
    item: Recipe,
    imageDimensions?: { width: number; height: number },
    updateDimensions?: (id: string, width: number, height: number) => void
  ) => {
    const columnWidth = (SCREEN_WIDTH - (gridColumns + 1) * 12) / gridColumns;
    const usageCount = 0; // Placeholder - will be fetched from cloud in future

    // Calculate image height based on aspect ratio
    let imageHeight = 200; // Default height
    if (imageDimensions) {
      const aspectRatio = imageDimensions.height / imageDimensions.width;
      imageHeight = Math.min(Math.max(columnWidth * aspectRatio, 120), 500); // Min 120, max 500
    }

    const handleImageLoad = (event: any) => {
      const { width, height } = event.source;
      if (width && height && updateDimensions && !imageDimensions) {
        updateDimensions(item.id, width, height);
      }
    };

    return (
      <Pressable
        style={[styles.recipeCard, { width: columnWidth, marginBottom: 12 }]}
        onPress={() => router.push(`/recipe/${item.id}`)}
        onLongPress={() => {
          if (!showEditActions) return;

          Alert.alert(
            t('recipeList.recipeOptionsTitle'),
            item.name,
            [
              { text: t('recipeList.view'), onPress: () => router.push(`/recipe/${item.id}`) },
              { text: t('recipeList.edit'), onPress: () => onEdit?.(item) },
              { text: t('recipeList.duplicate'), onPress: () => onDuplicate?.(item) },
              { text: t('common.delete'), style: 'destructive', onPress: () => handleDeleteRecipe(item.id) },
              { text: t('common.cancel'), style: 'cancel' },
            ]
          );
        }}
      >
        {item.exampleResultUri ? (
          <Image
            source={{ uri: item.exampleResultUri }}
            style={[styles.recipeCardImageMasonry, { height: imageHeight }]}
            contentFit="cover"
            onLoad={handleImageLoad}
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.recipePlaceholderImage}>
            <MaterialIcons name="auto-awesome" size={48} color="#444" />
          </View>
        )}

        {/* Public indicator */}
        {item.isPublic && (
          <View style={styles.publicBadge}>
            <MaterialIcons name="public" size={16} color="#fff" />
          </View>
        )}

        <View style={styles.recipeCardContent}>
          <Text style={styles.recipeCardTitle} numberOfLines={2}>{item.name}</Text>
          {usageCount > 0 && (
            <Text style={styles.recipeUsageCount}>{t('recipeList.usesInCloud', { n: usageCount })}</Text>
          )}
        </View>
      </Pressable>
    );
  }, [gridColumns, showEditActions, handleDeleteRecipe, onEdit, onDuplicate]);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="menu-book" size={64} color="#444" />
      <Text style={styles.emptyText}>{t('recipeList.noRecipesYet')}</Text>
      <Text style={styles.emptySubtext}>
        {showEditActions
          ? t('recipeList.emptyCreateFirst')
          : t('recipeList.emptyBrowseCommunity')}
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>{t('recipeList.loadingRecipes')}</Text>
      </View>
    );
  }

  // Combine add card with recipes - add card always first
  const dataWithAddCard = useMemo(() => {
    if (!onAddRecipe || !showEditActions) {
      return sortedRecipes;
    }
    // Return a special marker for the add card, followed by recipes
    return [{ __isAddCard: true }, ...sortedRecipes];
  }, [sortedRecipes, onAddRecipe, showEditActions]);

  const renderItem = useCallback((
    item: Recipe | { __isAddCard: boolean },
    imageDimensions?: { width: number; height: number },
    updateDimensions?: (id: string, width: number, height: number) => void
  ) => {
    if ('__isAddCard' in item && item.__isAddCard) {
      return renderAddRecipeCard();
    }
    return renderRecipeCard(item as Recipe, imageDimensions, updateDimensions);
  }, [renderAddRecipeCard, renderRecipeCard]);

  return (
    <MasonryGrid
      data={dataWithAddCard}
      renderItem={renderItem}
      keyExtractor={(item, index) => {
        if ('__isAddCard' in item && item.__isAddCard) {
          return 'add-recipe-card';
        }
        return (item as Recipe).id || `recipe-${index}`;
      }}
      numColumns={gridColumns}
      onRefresh={onRefresh}
      isRefreshing={isLoading}
      emptyComponent={renderEmpty()}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    marginTop: 16,
  },
  emptySubtext: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  recipeCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
  },
  addRecipeCard: {
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  addRecipeCardContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  addRecipeCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipeCardImage: {
    width: '100%',
    height: undefined,
    aspectRatio: undefined,
    minHeight: 120,
    maxHeight: 300,
    backgroundColor: '#222',
  },
  recipeCardImageMasonry: {
    width: '100%',
    backgroundColor: '#222',
    borderRadius: 12,
  },
  recipePlaceholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 180,
  },
  recipeCardContent: {
    padding: 12,
  },
  recipeCardTitle: {
    fontSize: 16,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
    marginBottom: 4,
  },
  addRecipeCardTitle: {
    fontSize: 16,
    fontFamily: 'Manrope-SemiBold',
    color: '#999',
  },
  recipeUsageCount: {
    fontSize: 12,
    fontFamily: 'Manrope-Regular',
    color: '#666',
    marginTop: 4,
  },
  publicBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 215, 0, 0.9)',
    borderRadius: 12,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
});
