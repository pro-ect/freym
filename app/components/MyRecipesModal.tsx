import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, FlaskConical, Plus, Trash2, Edit3 } from 'lucide-react-native';
import { router } from 'expo-router';
import type { Recipe } from '../../lib/recipes/types';
import MasonryGrid from './MasonryGrid';
import { deleteRecipe } from '../../lib/recipes/recipeQueries';
import RecipeBuilderModal from './RecipeBuilderModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 2;

interface MyRecipesModalProps {
  visible: boolean;
  onClose: () => void;
  recipes: Recipe[];
  onRecipesChange: () => void;
}

export default function MyRecipesModal({
  visible,
  onClose,
  recipes,
  onRecipesChange,
}: MyRecipesModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);

  const handleViewRecipe = (recipe: Recipe) => {
    onClose();
    router.push(`/recipe/${recipe.id}`);
  };

  const handleCreateRecipe = () => {
    setEditingRecipe(null);
    setShowBuilder(true);
  };

  const handleEditRecipe = (recipe: Recipe) => {
    setEditingRecipe(recipe);
    setShowBuilder(true);
  };

  const handleRecipeSaved = () => {
    setShowBuilder(false);
    setEditingRecipe(null);
    onRecipesChange();
  };

  const handleDeleteRecipe = (recipe: Recipe) => {
    Alert.alert(
      t('myRecipes.deleteTitle'),
      t('myRecipes.deleteConfirm', { name: recipe.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDeleting(recipe.id);
              await deleteRecipe(recipe.id);
              onRecipesChange();
            } catch (error) {
              console.error('Error deleting recipe:', error);
              Alert.alert(t('common.error'), t('myRecipes.deleteFailed'));
            } finally {
              setIsDeleting(null);
            }
          },
        },
      ]
    );
  };

  const renderRecipeCard = useCallback((
    item: Recipe,
    imageDimensions?: { width: number; height: number },
    updateDimensions?: (id: string, width: number, height: number) => void
  ) => {
    const columnWidth = (SCREEN_WIDTH - (NUM_COLUMNS + 1) * 12) / NUM_COLUMNS;

    let imageHeight = 160;
    if (imageDimensions) {
      const aspectRatio = imageDimensions.height / imageDimensions.width;
      imageHeight = Math.min(Math.max(columnWidth * aspectRatio, 120), 400);
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
        onPress={() => handleViewRecipe(item)}
        onLongPress={() => handleDeleteRecipe(item)}
      >
        <View style={styles.cardImageContainer}>
          {item.exampleResultUri ? (
            <Image
              source={{ uri: item.exampleResultUri }}
              style={[styles.cardImage, { height: imageHeight }]}
              contentFit="cover"
              onLoad={handleImageLoad}
              cachePolicy="memory-disk"
              transition={200}
            />
          ) : (
            <View style={[styles.placeholderImage, { height: imageHeight }]}>
              <FlaskConical size={32} color="#444" />
            </View>
          )}

          {/* Steps badge */}
          <View style={styles.stepsBadge}>
            <Text style={styles.stepsBadgeText}>
              {item.steps.length === 1
                ? t('myRecipes.stepCountOne', { n: item.steps.length })
                : t('myRecipes.stepCountOther', { n: item.steps.length })}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => handleEditRecipe(item)}
            >
              <Edit3 size={14} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDeleteRecipe(item)}
            >
              <Trash2 size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
        </View>
      </Pressable>
    );
  }, []);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <FlaskConical size={48} color="#444" />
      <Text style={styles.emptyText}>{t('myRecipes.emptyTitle')}</Text>
      <Text style={styles.emptySubtext}>
        {t('myRecipes.emptySubtitle')}
      </Text>
      <TouchableOpacity
        style={styles.emptyCreateButton}
        onPress={handleCreateRecipe}
      >
        <Plus size={18} color="#111" />
        <Text style={styles.emptyCreateButtonText}>{t('myRecipes.createRecipe')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>{t('myRecipes.title')}</Text>
            {recipes.length > 0 && (
              <Text style={styles.recipeCount}>{recipes.length}</Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.createButton}
            onPress={handleCreateRecipe}
          >
            <Plus size={20} color="#111" />
          </TouchableOpacity>
        </View>

        {/* Recipe Grid */}
        <MasonryGrid
          data={recipes}
          renderItem={renderRecipeCard}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          emptyComponent={renderEmpty()}
          contentContainerStyle={styles.gridContent}
        />
      </View>

      {/* Recipe Builder Modal */}
      {showBuilder && (
        <RecipeBuilderModal
          visible={showBuilder}
          recipe={editingRecipe}
          onClose={() => {
            setShowBuilder(false);
            setEditingRecipe(null);
          }}
          onSave={handleRecipeSaved}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  recipeCount: {
    color: '#6b7280',
    fontSize: 14,
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridContent: {
    padding: 12,
    paddingBottom: 40,
  },
  recipeCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardImageContainer: {
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    backgroundColor: '#222',
  },
  placeholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#222',
  },
  stepsBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stepsBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  editButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    padding: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
    lineHeight: 18,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFD700',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  emptyCreateButtonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
});
