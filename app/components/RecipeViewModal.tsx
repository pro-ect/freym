/**
 * RecipeViewModal - Display recipe details in read-only mode
 * Redesigned layout: image left, info right, then prompt, instructions, workflow
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import type { Recipe } from '../../lib/recipes/types';
import { getReplicateModelConfig } from '../config/modelRegistry';
import { useCloudModels } from '../hooks/useCloudModels';
import { ensureAIConsent } from '../../lib/ai/aiConsent';

interface RecipeViewModalProps {
  visible: boolean;
  recipe: Recipe;
  onClose: () => void;
  onEdit: () => void;
}

const MAX_PROMPT_LENGTH = 150;

export default function RecipeViewModal({
  visible,
  recipe,
  onClose,
  onEdit,
}: RecipeViewModalProps) {
  const { t } = useTranslation();
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { models: cloudModels } = useCloudModels({ category: 'image' });

  // Get all prompts from all steps as a single string
  const getAllPrompts = () => {
    return recipe.steps
      .flatMap(step => step.prompts || [(step as any).prompt || ''])
      .filter(p => p?.trim())
      .join('\n\n');
  };

  // Get unique model names from all steps
  const getModelNames = (): string[] => {
    const modelIds = new Set<string>();
    recipe.steps.forEach(step => {
      const ids = step.modelIds || (step.modelId ? [step.modelId] : []);
      ids.forEach(id => modelIds.add(id));
    });
    return Array.from(modelIds).map(id => {
      // Try cloud models first
      const cloudModel = cloudModels.find(m => m.slug === id);
      if (cloudModel) return cloudModel.name;
      // Fallback to local registry
      const config = getReplicateModelConfig(id);
      return config?.name || id;
    });
  };

  // Calculate total photos that will be generated
  const getTotalPhotos = (): number => {
    return recipe.steps.reduce((total, step) => {
      const numImages = step.numImages || 1;
      const numPrompts = step.prompts?.length || 1;
      const modelIds = step.modelIds || (step.modelId ? [step.modelId] : []);
      const numModels = modelIds.length || 1;
      return total + (numImages * numPrompts * numModels);
    }, 0);
  };

  const allPrompts = getAllPrompts();
  const isPromptLong = allPrompts.length > MAX_PROMPT_LENGTH;
  const displayPrompt = promptExpanded || !isPromptLong
    ? allPrompts
    : allPrompts.slice(0, MAX_PROMPT_LENGTH) + '...';

  const modelNames = getModelNames();
  const totalPhotos = getTotalPhotos();

  const handleCopyPrompt = async () => {
    await Clipboard.setStringAsync(allPrompts);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(t('recipeView.copiedTitle'), t('recipeView.copiedMessage'));
  };

  const handlePickImages = async () => {
    if (!(await ensureAIConsent())) return;
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(t('recipeView.permissionRequiredTitle'), t('recipeView.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      const uris = result.assets.map(asset => asset.uri);
      setUploadedImages(uris);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRunRecipe = () => {
    // Check if images are required but not uploaded
    if (recipe.inputType === 'images' && uploadedImages.length === 0) {
      Alert.alert(t('recipeView.uploadRequiredTitle'), t('recipeView.uploadRequiredMessage'));
      return;
    }

    // TODO: Implement recipe execution
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(t('recipeView.runRecipeTitle'), t('recipeView.runRecipeComingSoon'));
  };

  const canRunRecipe = recipe.inputType === 'prompt' || uploadedImages.length > 0;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <BlurView intensity={40} tint="dark" style={styles.modalOverlay}>
        <View style={styles.darkOverlay} />
        <Pressable style={styles.modalOverlayPressable} onPress={onClose}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {/* Header with close/edit buttons */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{t('recipeView.headerTitle')}</Text>
              <View style={styles.headerButtons}>
                <Pressable onPress={onEdit} style={styles.iconButton}>
                  <MaterialIcons name="edit" size={24} color="#2196F3" />
                </Pressable>
                <Pressable onPress={onClose} style={styles.iconButton}>
                  <MaterialIcons name="close" size={24} color="#fff" />
                </Pressable>
              </View>
            </View>

            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              {/* Hero Section: Image Left, Info Right */}
              <View style={styles.heroSection}>
                {/* Example Image */}
                <View style={styles.heroImageContainer}>
                  {recipe.exampleResultUri ? (
                    <Image
                      source={{ uri: recipe.exampleResultUri }}
                      style={styles.heroImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.heroImagePlaceholder}>
                      <MaterialIcons name="image" size={40} color="#444" />
                    </View>
                  )}
                </View>

                {/* Info Side */}
                <View style={styles.heroInfo}>
                  <Text style={styles.recipeName}>{recipe.name}</Text>

                  {recipe.inputDescription && (
                    <Text style={styles.recipeDescription}>{recipe.inputDescription}</Text>
                  )}

                  {/* Input Mode Badge - only show for image-input recipes */}
                  {recipe.inputType === 'images' && (
                    <View style={styles.modeBadge}>
                      <MaterialIcons name="image" size={14} color="#FFD700" />
                      <Text style={styles.modeBadgeText}>{t('recipeView.imageInputBadge')}</Text>
                    </View>
                  )}

                  {/* Model & Photos Summary */}
                  <Text style={styles.modelSummary}>
                    {t('recipeView.usingModels', { models: modelNames.slice(0, 2).join(', ') })}{modelNames.length > 2 ? t('recipeView.moreModelsSuffix', { n: modelNames.length - 2 }) : ''}
                  </Text>
                  <Text style={styles.photosSummary}>
                    {t('recipeView.photosWillBeGenerated', { n: totalPhotos })}
                  </Text>
                </View>
              </View>

              {/* Prompt Section */}
              {allPrompts.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{t('recipeView.promptTitle')}</Text>
                    <Pressable style={styles.copyButton} onPress={handleCopyPrompt}>
                      <MaterialIcons name="content-copy" size={14} color="#FFD700" />
                      <Text style={styles.copyButtonText}>{t('recipeView.copy')}</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => isPromptLong && setPromptExpanded(!promptExpanded)}
                    disabled={!isPromptLong}
                  >
                    <Text style={styles.promptText}>{displayPrompt}</Text>
                    {isPromptLong && (
                      <Text style={styles.expandText}>
                        {promptExpanded ? t('recipeView.showLess') : t('recipeView.showMore')}
                      </Text>
                    )}
                  </Pressable>
                </View>
              )}

              {/* Instructions Section */}
              {recipe.instructions && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('recipeView.instructionsTitle')}</Text>
                  <Text style={styles.instructionsText}>{recipe.instructions}</Text>
                </View>
              )}

              {/* Workflow Summary */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('recipeView.workflowTitle')}</Text>
                <View style={styles.workflowCard}>
                  <View style={styles.workflowRow}>
                    {recipe.steps.length > 1 && (
                      <>
                        <View style={styles.workflowItem}>
                          <MaterialIcons name="layers" size={20} color="#2196F3" />
                          <Text style={styles.workflowLabel}>{t('recipeView.stepsLabel')}</Text>
                          <Text style={styles.workflowValue}>{recipe.steps.length}</Text>
                        </View>
                        <View style={styles.workflowDivider} />
                      </>
                    )}
                    {modelNames.length > 1 && (
                      <>
                        <View style={styles.workflowItem}>
                          <MaterialIcons name="auto-awesome" size={20} color="#2196F3" />
                          <Text style={styles.workflowLabel}>{t('recipeView.modelsLabel')}</Text>
                          <Text style={styles.workflowValue}>{modelNames.length}</Text>
                        </View>
                        <View style={styles.workflowDivider} />
                      </>
                    )}
                    <View style={styles.workflowItem}>
                      <MaterialIcons name="photo-library" size={20} color="#2196F3" />
                      <Text style={styles.workflowLabel}>{t('recipeView.photosLabel')}</Text>
                      <Text style={styles.workflowValue}>{totalPhotos}</Text>
                    </View>
                  </View>

                  {/* Model List */}
                  <View style={styles.modelList}>
                    {modelNames.map((name, idx) => (
                      <View key={idx} style={styles.modelChip}>
                        <Text style={styles.modelChipText}>{name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* Image Upload Section (only for image-based recipes) */}
              {recipe.inputType === 'images' && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{t('recipeView.yourImages', { n: uploadedImages.length })}</Text>
                    <Pressable style={styles.uploadButton} onPress={handlePickImages}>
                      <MaterialIcons name="add-photo-alternate" size={18} color="#fff" />
                      <Text style={styles.uploadButtonText}>
                        {uploadedImages.length > 0 ? t('recipeView.add') : t('recipeView.upload')}
                      </Text>
                    </Pressable>
                  </View>

                  {uploadedImages.length > 0 ? (
                    <View style={styles.uploadedImagesGrid}>
                      {uploadedImages.map((uri, index) => (
                        <View key={index} style={styles.uploadedImageContainer}>
                          <Image
                            source={{ uri }}
                            style={styles.uploadedImage}
                            contentFit="cover"
                          />
                          <Pressable
                            style={styles.removeImageButton}
                            onPress={() => handleRemoveImage(index)}
                          >
                            <MaterialIcons name="close" size={14} color="#fff" />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Pressable style={styles.uploadPlaceholder} onPress={handlePickImages}>
                      <MaterialIcons name="cloud-upload" size={40} color="#666" />
                      <Text style={styles.uploadPlaceholderText}>
                        {t('recipeView.tapToUploadImages')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Spacer */}
              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Footer with Run Button */}
            <View style={styles.footer}>
              <Pressable
                style={[styles.runButton, !canRunRecipe && styles.runButtonDisabled]}
                onPress={handleRunRecipe}
                disabled={!canRunRecipe}
              >
                <MaterialIcons name="play-arrow" size={24} color="#000" />
                <Text style={styles.runButtonText}>
                  {recipe.inputType === 'images' && uploadedImages.length === 0
                    ? t('recipeView.uploadImagesFirst')
                    : t('recipeView.runRecipeButton')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalOverlayPressable: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    backgroundColor: '#111',
    borderRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#999',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },

  // Hero Section - Image Left, Info Right
  heroSection: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  heroImageContainer: {
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  heroInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  recipeName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  recipeDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 12,
    lineHeight: 20,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderRadius: 12,
    marginBottom: 12,
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFD700',
  },
  modelSummary: {
    fontSize: 13,
    color: '#ccc',
    marginBottom: 2,
  },
  photosSummary: {
    fontSize: 12,
    color: '#666',
  },

  // Sections
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFD700',
  },
  promptText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 22,
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 10,
  },
  expandText: {
    fontSize: 13,
    color: '#FFD700',
    marginTop: 8,
    fontWeight: '500',
  },
  instructionsText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 22,
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 10,
  },

  // Workflow Card
  workflowCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  workflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  workflowItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  workflowLabel: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
  },
  workflowValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  workflowDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#333',
  },
  modelList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modelChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#222',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  modelChipText: {
    fontSize: 13,
    color: '#ccc',
  },

  // Upload Section
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  uploadButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  uploadPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  uploadPlaceholderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
  },
  uploadedImagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  uploadedImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  uploadedImage: {
    width: '100%',
    height: '100%',
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Footer
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  runButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD700',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  runButtonDisabled: {
    backgroundColor: '#333',
  },
  runButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#000',
  },
});
