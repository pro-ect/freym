/**
 * RecipeBuilderModal - Create or edit recipes (simplified flat form)
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import type { Recipe, RecipeStep } from '../../lib/recipes/types';
import { insertRecipe, updateRecipe } from '../../lib/recipes/recipeQueries';
import { generateId } from '../../lib/recipes/utils';
import { useCloudModels } from '../hooks/useCloudModels';
import { calculateRecipeCost } from '../../lib/recipes/pricing';
import { Zap } from 'lucide-react-native';
import { publishRecipeToSupabase, generateRecipeShareLink, deletePublicRecipe, updatePublicRecipe, fetchPublicRecipe } from '../../lib/recipes/supabaseRecipes';
import * as Clipboard from 'expo-clipboard';
import { useSettings } from '../../contexts/SettingsContext';
import { useRecipes } from '../../contexts/RecipesContext';
import { CATEGORIES, CategorySlug } from '../../lib/recipes/categories';
import { supabase } from '../../lib/supabase';
import { ensureAIConsent } from '../../lib/ai/aiConsent';

type DynamicCategory = { slug: string; title: string; sort_order: number };

/**
 * Seed a NEW recipe's form fields from an existing library item. The modal
 * still calls `insertRecipe` on save (treats it as a new recipe), so this is
 * the right prop to use for "Create Recipe from this image" flows. Don't
 * confuse with `recipe` — passing a Recipe object triggers `updateRecipe`.
 */
export interface RecipeBuilderPrefill {
  modelId?: string;
  prompt?: string;
  referenceImageUris?: string[];
  exampleResultUris?: string[];
  aspectRatio?: string;
  isPublic?: boolean;
}

interface RecipeBuilderModalProps {
  visible: boolean;
  recipe: Recipe | null; // null for new recipe, Recipe for editing
  prefill?: RecipeBuilderPrefill | null;
  onClose: () => void;
  onSave: () => void;
}

export default function RecipeBuilderModal({
  visible,
  recipe,
  prefill = null,
  onClose,
  onSave,
}: RecipeBuilderModalProps) {
  const { t } = useTranslation();
  const { isAdmin } = useSettings();
  const { refreshRecipes } = useRecipes();
  const { models: cloudModels, isLoading: isLoadingModels } = useCloudModels({ category: 'image' });

  // Filter to only show Fal models
  const falModels = cloudModels.filter(m => m.slug.endsWith('-fal'));

  const [name, setName] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [photoInputLabel, setPhotoInputLabel] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [previousIsPublic, setPreviousIsPublic] = useState(false);
  const [exampleResultUri, setExampleResultUri] = useState<string | undefined>();
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [numImages, setNumImages] = useState<number>(2);
  const [isSaving, setIsSaving] = useState(false);
  const [simplifiedWarning, setSimplifiedWarning] = useState(false);
  const [referenceImageUris, setReferenceImageUris] = useState<string[]>([]);
  const [exampleResultUris, setExampleResultUris] = useState<string[]>([]);
  const [featuredImageUri, setFeaturedImageUri] = useState<string | undefined>();
  const [featuredImageTouched, setFeaturedImageTouched] = useState(false);
  const [categoryTags, setCategoryTags] = useState<CategorySlug[]>([]);
  const [availableCategories, setAvailableCategories] = useState<DynamicCategory[]>(
    CATEGORIES.map((c) => ({ slug: c.slug, title: c.title, sort_order: 0 })),
  );
  const [isFeatured, setIsFeatured] = useState(false);
  const [featuredOrder, setFeaturedOrder] = useState<string>('');

  // Load categories from Supabase whenever the modal opens so newly-created
  // categories appear without rebuilding the app.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    supabase
      .from('recipe_categories')
      .select('slug, title, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[RecipeBuilder] load categories failed:', error.message);
          return;
        }
        if (data && data.length > 0) {
          setAvailableCategories(data as DynamicCategory[]);
        }
      });
    return () => { cancelled = true; };
  }, [visible]);

  // Load recipe data when editing
  useEffect(() => {
    if (recipe) {
      setName(recipe.name);
      setInputDescription(recipe.inputDescription || '');
      setInstructions(recipe.instructions || '');
      setPhotoInputLabel(recipe.photoInputLabel || '');
      setIsPublic(recipe.isPublic || false);
      setIsOnboarding(recipe.isOnboarding || false);
      setPreviousIsPublic(recipe.isPublic || false);
      setExampleResultUri(recipe.exampleResultUri);
      setExampleResultUris(
        recipe.exampleResultUris && recipe.exampleResultUris.length > 0
          ? recipe.exampleResultUris
          : recipe.exampleResultUri ? [recipe.exampleResultUri] : []
      );
      setReferenceImageUris(recipe.referenceImageUris || []);
      setCategoryTags((recipe.categoryTags as CategorySlug[]) || []);
      setIsFeatured(recipe.isFeatured || false);
      setFeaturedOrder(recipe.featuredOrder != null ? String(recipe.featuredOrder) : '');

      // If editing a published recipe, hydrate admin fields from Supabase
      if (recipe.supabaseRecipeId && isAdmin) {
        fetchPublicRecipe(recipe.supabaseRecipeId)
          .then((pub) => {
            if (!pub) return;
            setCategoryTags(((pub.category_tags as CategorySlug[]) || []));
            setIsFeatured(!!pub.is_featured);
            setFeaturedOrder(pub.featured_order != null ? String(pub.featured_order) : '');
            const multi = pub.example_result_urls;
            if (Array.isArray(multi) && multi.length > 0) {
              setExampleResultUris(multi);
            } else if (pub.example_result_url) {
              setExampleResultUris([pub.example_result_url]);
            }
            if (pub.featured_image_url) {
              setFeaturedImageUri(pub.featured_image_url);
            }
          })
          .catch(() => { /* ignore — defaults already set */ });
      }

      // Extract first model and first prompt from first step
      const firstStep = recipe.steps[0];
      if (firstStep) {
        const modelIds = firstStep.modelIds || (firstStep.modelId ? [firstStep.modelId] : []);
        setSelectedModelId(modelIds[0] || '');
        setPrompt(firstStep.prompts?.[0] || (firstStep as any).prompt || '');
        setAspectRatio(firstStep.aspectRatio || '9:16');
        setNumImages(firstStep.numImages || 2);
      } else {
        setSelectedModelId('');
        setPrompt('');
        setAspectRatio('9:16');
        setNumImages(2);
      }

      // Warn if recipe had multiple steps or multiple models
      const hasMultipleSteps = recipe.steps.length > 1;
      const hasMultipleModels = recipe.steps.some(s => {
        const ids = s.modelIds || (s.modelId ? [s.modelId] : []);
        return ids.length > 1;
      });
      setSimplifiedWarning(hasMultipleSteps || hasMultipleModels);
    } else {
      // Reset for new recipe — `prefill` (when set) seeds the form fields with
      // values from a source library item so admins can quickly turn a good
      // generation into a recipe. Save still calls insertRecipe (new row).
      setName('');
      setSelectedModelId(prefill?.modelId || '');
      setPrompt(prefill?.prompt || '');
      setAspectRatio(prefill?.aspectRatio || '9:16');
      setNumImages(2);
      setInputDescription('');
      setInstructions('');
      setPhotoInputLabel('');
      setIsPublic(prefill?.isPublic ?? false);
      setIsOnboarding(false);
      setPreviousIsPublic(false);
      setExampleResultUri(prefill?.exampleResultUris?.[0]);
      setExampleResultUris(prefill?.exampleResultUris || []);
      setFeaturedImageUri(undefined);
      setFeaturedImageTouched(false);
      setReferenceImageUris(prefill?.referenceImageUris || []);
      setCategoryTags([]);
      setIsFeatured(false);
      setFeaturedOrder('');
      setSimplifiedWarning(false);
    }
  }, [recipe, prefill, visible]);

  const MAX_PHOTOSHOOT_IMAGES = 12;

  const handlePickPhotoshootImages = async () => {
    if (exampleResultUris.length >= MAX_PHOTOSHOOT_IMAGES) {
      Alert.alert(t('recipeBuilder.limitReachedTitle'), t('recipeBuilder.maxPhotosPerPhotoshoot', { n: MAX_PHOTOSHOOT_IMAGES }));
      return;
    }
    if (!(await ensureAIConsent())) return;
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(t('recipeBuilder.permissionRequiredTitle'), t('recipeBuilder.permissionRequiredMessage'));
      return;
    }
    const remaining = MAX_PHOTOSHOOT_IMAGES - exampleResultUris.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    const FileSystem = require('expo-file-system/legacy');
    const newUris: string[] = [];
    for (const asset of result.assets) {
      const filename = `recipe-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const permanentUri = `${FileSystem.documentDirectory}${filename}`;
      try {
        await FileSystem.copyAsync({ from: asset.uri, to: permanentUri });
        newUris.push(permanentUri);
      } catch (err) {
        console.error('Error copying photoshoot image:', err);
        newUris.push(asset.uri);
      }
    }
    setExampleResultUris((prev) => [...prev, ...newUris].slice(0, MAX_PHOTOSHOOT_IMAGES));
  };

  const handleRemovePhotoshootImage = (index: number) => {
    setExampleResultUris((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePickFeaturedImage = async () => {
    if (!(await ensureAIConsent())) return;
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const FileSystem = require('expo-file-system/legacy');
    const filename = `recipe-featured-${Date.now()}.jpg`;
    const permanentUri = `${FileSystem.documentDirectory}${filename}`;
    try {
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: permanentUri });
      setFeaturedImageUri(permanentUri);
    } catch (err) {
      console.error('Error copying featured image:', err);
      setFeaturedImageUri(result.assets[0].uri);
    }
    setFeaturedImageTouched(true);
  };

  const handleClearFeaturedImage = () => {
    setFeaturedImageUri(undefined);
    setFeaturedImageTouched(true);
  };

  const handleMakePhotoshootCover = (index: number) => {
    setExampleResultUris((prev) => {
      if (index === 0) return prev;
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return next;
    });
  };

  const handlePickReferenceImages = async () => {
    if (referenceImageUris.length >= 4) {
      Alert.alert('Limit Reached', 'Maximum 4 reference images allowed.');
      return;
    }

    if (!(await ensureAIConsent())) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }

    const remaining = 4 - referenceImageUris.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      const FileSystem = require('expo-file-system/legacy');
      const newUris: string[] = [];

      for (const asset of result.assets) {
        const filename = `recipe-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const permanentUri = `${FileSystem.documentDirectory}${filename}`;
        try {
          await FileSystem.copyAsync({ from: asset.uri, to: permanentUri });
          newUris.push(permanentUri);
        } catch (error) {
          console.error('Error copying reference image:', error);
          newUris.push(asset.uri);
        }
      }

      setReferenceImageUris(prev => [...prev, ...newUris].slice(0, 4));
    }
  };

  const handleRemoveReferenceImage = (index: number) => {
    setReferenceImageUris(prev => prev.filter((_, i) => i !== index));
  };

  const validateRecipe = (): string | null => {
    if (!name.trim()) {
      return t('recipeBuilder.errorEnterName');
    }
    if (!selectedModelId) {
      return t('recipeBuilder.errorSelectModel');
    }
    if (!prompt.trim()) {
      return t('recipeBuilder.errorEnterPrompt');
    }
    return null;
  };

  // Build single step from flat state
  const buildStep = (): RecipeStep => ({
    id: recipe?.steps[0]?.id || generateId(),
    order: 1,
    modelIds: [selectedModelId],
    numImages,
    prompts: [prompt],
    aspectRatio,
    useAllPreviousResults: true,
  });

  const handleSave = async () => {
    const error = validateRecipe();
    if (error) {
      Alert.alert(t('recipeBuilder.validationErrorTitle'), error);
      return;
    }

    // Check if non-admin is trying to edit a public recipe
    if (recipe?.isPublic && recipe?.supabaseRecipeId && !isAdmin) {
      Alert.alert(
        t('recipeBuilder.permissionDeniedTitle'),
        t('recipeBuilder.permissionDeniedMessage')
      );
      return;
    }

    setIsSaving(true);
    try {
      const steps = [buildStep()];

      const recipeData: Recipe = {
        id: recipe?.id || generateId(),
        name: name.trim(),
        inputType: 'prompt',
        inputDescription: inputDescription.trim() || undefined,
        instructions: instructions.trim() || undefined,
        photoInputLabel: photoInputLabel.trim() || undefined,
        isPublic,
        isOnboarding,
        supabaseRecipeId: recipe?.supabaseRecipeId,
        steps,
        referenceImageUris: referenceImageUris.length > 0 ? referenceImageUris : undefined,
        exampleResultUri: exampleResultUris[0] ?? exampleResultUri,
        exampleResultUris,
        featuredImageUri: featuredImageTouched ? (featuredImageUri ?? '') : featuredImageUri,
        categoryTags,
        isFeatured,
        featuredOrder: featuredOrder.trim() === '' ? null : Number(featuredOrder),
        createdAt: recipe?.createdAt || Date.now(),
        updatedAt: Date.now(),
        isFavorite: recipe?.isFavorite || false,
        isHidden: recipe?.isHidden || false,
      };

      // Check if this is a "cloud-only" recipe
      const isCloudOnlyRecipe = recipe && recipe.id === recipe.supabaseRecipeId;

      // Check if we need to unpublish
      const shouldUnpublish = recipe && previousIsPublic && !isPublic && recipe.supabaseRecipeId;

      if (shouldUnpublish) {
        try {
          await deletePublicRecipe(recipe.supabaseRecipeId!);
          console.log('Recipe unpublished from Supabase');
          recipeData.supabaseRecipeId = undefined;
          Alert.alert(t('recipeBuilder.recipeUnpublishedTitle'), t('recipeBuilder.recipeUnpublishedMessage'));
        } catch (unpublishError) {
          console.error('Error unpublishing recipe:', unpublishError);
          Alert.alert(
            t('recipeBuilder.warningTitle'),
            t('recipeBuilder.unpublishFailedMessage')
          );
        }
      }

      if (isCloudOnlyRecipe) {
        console.log('Updating cloud-only recipe on Supabase:', recipe.supabaseRecipeId);
        try {
          await updatePublicRecipe(recipe.supabaseRecipeId!, recipeData);
          console.log('Cloud-only recipe updated on Supabase successfully');
        } catch (updateError) {
          console.error('Error updating cloud-only recipe on Supabase:', updateError);
          Alert.alert(t('recipeBuilder.errorTitle'), t('recipeBuilder.updateFailedMessage'));
          setIsSaving(false);
          return;
        }
      } else {
        if (recipe) {
          await updateRecipe(recipe.id, recipeData);
        } else {
          await insertRecipe(recipeData);
        }

        if (recipeData.supabaseRecipeId && !shouldUnpublish) {
          try {
            await updatePublicRecipe(recipeData.supabaseRecipeId, recipeData);
            console.log('Recipe updated on Supabase:', recipeData.supabaseRecipeId);
          } catch (updateError) {
            console.error('Error updating on Supabase:', updateError);
            Alert.alert(
              t('recipeBuilder.warningTitle'),
              t('recipeBuilder.syncFailedMessage')
            );
          }
        } else if (isPublic && !recipeData.supabaseRecipeId) {
          try {
            const publishedRecipeId = await publishRecipeToSupabase(recipeData, {
              category: 'general',
              tags: [],
            });
            console.log('Recipe published to Supabase:', publishedRecipeId);

            const shareLink = generateRecipeShareLink(publishedRecipeId);
            await Clipboard.setStringAsync(shareLink);

            setTimeout(() => {
              Alert.alert(
                t('recipeBuilder.recipePublishedTitle'),
                t('recipeBuilder.recipePublishedMessage', { shareLink }),
                [{ text: t('common.ok') }]
              );
            }, 300);
          } catch (publishError) {
            console.error('Error publishing to Supabase:', publishError);
            Alert.alert(
              t('recipeBuilder.warningTitle'),
              t('recipeBuilder.publishFailedMessage')
            );
          }
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Invalidate home recipes-tab cache so new prompt/cover images appear immediately.
      // The cache (5min TTL in RecipesContext) would otherwise hide changes until pull-to-refresh.
      if (recipeData.supabaseRecipeId || isCloudOnlyRecipe) {
        refreshRecipes().catch(() => {});
      }
      onSave();
    } catch (error) {
      console.error('Error saving recipe:', error);
      Alert.alert(t('recipeBuilder.errorTitle'), t('recipeBuilder.saveFailedMessage'));
    } finally {
      setIsSaving(false);
    }
  };

  // Cost preview from current selection
  const previewSteps = selectedModelId ? [buildStep()] : [];
  const previewCost = previewSteps.length > 0 ? calculateRecipeCost(previewSteps) : 0;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <BlurView intensity={40} tint="dark" style={styles.modalOverlay}>
        <View style={styles.darkOverlay} />
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {recipe ? t('recipeBuilder.editTitle') : t('recipeBuilder.newTitle')}
            </Text>
            <Pressable onPress={onClose} style={styles.iconButton}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {/* Simplified Warning */}
            {simplifiedWarning && (
              <View style={styles.warningBanner}>
                <MaterialIcons name="info" size={20} color="#f59e0b" />
                <Text style={styles.warningText}>
                  {t('recipeBuilder.simplifiedWarning')}
                </Text>
              </View>
            )}

            {/* Recipe Name */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.nameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t('recipeBuilder.namePlaceholder')}
                placeholderTextColor="#666"
              />
            </View>

            {/* Model Selection (single-select) */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.modelLabel')}</Text>
              <View style={styles.modelPicker}>
                {isLoadingModels ? (
                  <ActivityIndicator size="small" color="#2196F3" />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {falModels.map((model) => {
                      const isSelected = selectedModelId === model.slug;
                      return (
                        <Pressable
                          key={model.slug}
                          style={[
                            styles.modelOption,
                            isSelected && styles.modelOptionActive,
                          ]}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setSelectedModelId(model.slug);
                          }}
                        >
                          {isSelected && (
                            <MaterialIcons name="check-circle" size={16} color="#fff" style={{ marginRight: 4 }} />
                          )}
                          <Text
                            style={[
                              styles.modelOptionText,
                              isSelected && styles.modelOptionTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {model.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </View>

            {/* Prompt */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.promptLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={t('recipeBuilder.promptPlaceholder')}
                placeholderTextColor="#666"
                multiline
                numberOfLines={4}
              />
            </View>

            {/* Aspect Ratio */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.aspectRatioLabel')}</Text>
              <View style={styles.ratioButtons}>
                {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
                  <Pressable
                    key={ratio}
                    style={[
                      styles.ratioButton,
                      aspectRatio === ratio && styles.ratioButtonActive,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setAspectRatio(ratio);
                    }}
                  >
                    <View style={[
                      styles.ratioPreview,
                      ratio === '9:16' && { width: 16, height: 24 },
                      ratio === '1:1' && { width: 20, height: 20 },
                      ratio === '16:9' && { width: 24, height: 16 },
                      aspectRatio === ratio && styles.ratioPreviewActive,
                    ]} />
                    <Text style={[
                      styles.ratioButtonText,
                      aspectRatio === ratio && styles.ratioButtonTextActive,
                    ]}>
                      {ratio}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Number of Images */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.numImagesLabel')}</Text>
              <View style={styles.ratioButtons}>
                {([1, 2, 3, 4] as const).map((n) => (
                  <Pressable
                    key={n}
                    style={[
                      styles.ratioButton,
                      numImages === n && styles.ratioButtonActive,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setNumImages(n);
                    }}
                  >
                    <Text style={[
                      styles.ratioButtonText,
                      numImages === n && styles.ratioButtonTextActive,
                    ]}>
                      {n}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Public Recipe Switch - Only show for admins */}
            {isAdmin && (
              <View style={styles.section}>
                <View style={styles.switchRow}>
                  <View style={styles.switchLabel}>
                    <MaterialIcons name="public" size={24} color={isPublic ? '#FFD700' : '#666'} />
                    <View style={styles.switchLabelText}>
                      <Text style={styles.label}>Public Recipe</Text>
                      <Text style={styles.switchDescription}>
                        Share with input instructions and examples
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={isPublic}
                    onValueChange={setIsPublic}
                    trackColor={{ false: '#333', true: '#FFD700' }}
                    thumbColor="#fff"
                  />
                </View>
              </View>
            )}

            {/* Home Categories — admin only, when public */}
            {isPublic && isAdmin && (
              <View style={styles.section}>
                <Text style={styles.label}>Home Sections</Text>
                <Text style={styles.inputHint}>Tap to add this recipe to home sections (multi-select)</Text>
                <View style={categoryChipStyles.row}>
                  {availableCategories.map((cat) => {
                    const selected = categoryTags.includes(cat.slug as CategorySlug);
                    return (
                      <Pressable
                        key={cat.slug}
                        onPress={() => {
                          setCategoryTags((prev) =>
                            prev.includes(cat.slug as CategorySlug)
                              ? prev.filter((s) => s !== cat.slug)
                              : [...prev, cat.slug as CategorySlug]
                          );
                        }}
                        style={[categoryChipStyles.chip, selected && categoryChipStyles.chipSelected]}
                      >
                        <Text style={[categoryChipStyles.chipText, selected && categoryChipStyles.chipTextSelected]}>
                          {cat.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Featured (hero) — admin only, when public */}
            {isPublic && isAdmin && (
              <View style={styles.section}>
                <View style={styles.switchRow}>
                  <View style={styles.switchLabel}>
                    <MaterialIcons name="auto-awesome" size={24} color={isFeatured ? '#FFD700' : '#666'} />
                    <View style={styles.switchLabelText}>
                      <Text style={styles.label}>Featured on Home</Text>
                      <Text style={styles.switchDescription}>Appears in the hero banner carousel</Text>
                    </View>
                  </View>
                  <Switch
                    value={isFeatured}
                    onValueChange={setIsFeatured}
                    trackColor={{ false: '#333', true: '#FFD700' }}
                    thumbColor="#fff"
                  />
                </View>
                {isFeatured && (
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={featuredOrder}
                    onChangeText={(t) => setFeaturedOrder(t.replace(/[^0-9]/g, ''))}
                    placeholder="Sort order (e.g., 1, 2, 3) — leave blank for last"
                    placeholderTextColor="#666"
                    keyboardType="number-pad"
                  />
                )}
                {isFeatured && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.label}>Featured Photo (optional)</Text>
                    <Text style={styles.inputHint}>
                      Used only in the hero banner. If empty, the hero cycles through this recipe&apos;s photoshoot photos.
                    </Text>
                    <View style={featuredImageStyles.row}>
                      {featuredImageUri ? (
                        <View style={featuredImageStyles.wrapper}>
                          <Image source={{ uri: featuredImageUri }} style={featuredImageStyles.thumb} contentFit="cover" />
                          <Pressable style={featuredImageStyles.remove} hitSlop={6} onPress={handleClearFeaturedImage}>
                            <MaterialIcons name="close" size={14} color="#fff" />
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable style={featuredImageStyles.add} onPress={handlePickFeaturedImage}>
                          <MaterialIcons name="add-photo-alternate" size={28} color="#666" />
                          <Text style={featuredImageStyles.addLabel}>Add</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Onboarding Recipe Switch - Only show for admins when public */}
            {isPublic && isAdmin && (
              <View style={styles.section}>
                <View style={styles.switchRow}>
                  <View style={styles.switchLabel}>
                    <MaterialIcons name="star" size={24} color={isOnboarding ? '#FFD700' : '#666'} />
                    <View style={styles.switchLabelText}>
                      <Text style={styles.label}>Onboarding Recipe</Text>
                      <Text style={styles.switchDescription}>
                        Show in onboarding flow for new users
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={isOnboarding}
                    onValueChange={setIsOnboarding}
                    trackColor={{ false: '#333', true: '#FFD700' }}
                    thumbColor="#fff"
                  />
                </View>
              </View>
            )}

            {/* Input Description (only shown if public and admin) */}
            {isPublic && isAdmin && (
              <View style={styles.section}>
                <Text style={styles.label}>Input Description</Text>
                <TextInput
                  style={styles.input}
                  value={inputDescription}
                  onChangeText={setInputDescription}
                  placeholder="e.g., Upload a portrait photo"
                  placeholderTextColor="#666"
                />
              </View>
            )}

            {/* Photo input label — switches recipe to "any photo" mode */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.anyPhotoInputLabel')}</Text>
              <Text style={styles.inputHint}>
                {t('recipeBuilder.anyPhotoInputHint')}
              </Text>
              <TextInput
                style={styles.input}
                value={photoInputLabel}
                onChangeText={setPhotoInputLabel}
                placeholder={t('recipeBuilder.anyPhotoInputPlaceholder')}
                placeholderTextColor="#666"
                maxLength={40}
                autoCapitalize="none"
              />
            </View>

            {/* Instructions */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.instructionsLabel')}</Text>
              <Text style={styles.inputHint}>{t('recipeBuilder.instructionsHint')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={instructions}
                onChangeText={setInstructions}
                placeholder={t('recipeBuilder.instructionsPlaceholder')}
                placeholderTextColor="#666"
                multiline
                numberOfLines={4}
              />
            </View>

            {/* Reference Images (Admin only) */}
            {isAdmin && (
              <View style={styles.section}>
                <Text style={styles.label}>Reference Images</Text>
                <Text style={styles.inputHint}>Sent to model every run, invisible to users (up to 4)</Text>
                <View style={styles.refImagesRow}>
                  {referenceImageUris.map((uri, index) => (
                    <View key={index} style={styles.refImageWrapper}>
                      <Image
                        source={{ uri }}
                        style={styles.refImageThumb}
                        contentFit="cover"
                      />
                      <Pressable
                        style={styles.refImageRemove}
                        onPress={() => handleRemoveReferenceImage(index)}
                      >
                        <MaterialIcons name="close" size={14} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                  {referenceImageUris.length < 4 && (
                    <Pressable
                      style={styles.refImageAdd}
                      onPress={handlePickReferenceImages}
                    >
                      <MaterialIcons name="add-photo-alternate" size={28} color="#666" />
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {/* Photoshoot photos (multi — auto-cycle on home cards) */}
            <View style={styles.section}>
              <Text style={styles.label}>{t('recipeBuilder.photoshootPhotosLabel')}</Text>
              <Text style={styles.inputHint}>
                {t('recipeBuilder.photoshootPhotosHint', { n: MAX_PHOTOSHOOT_IMAGES })}
              </Text>
              <View style={photoshootStyles.row}>
                {exampleResultUris.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={photoshootStyles.wrapper}>
                    <Pressable onPress={() => handleMakePhotoshootCover(index)}>
                      <Image source={{ uri }} style={photoshootStyles.thumb} contentFit="cover" />
                    </Pressable>
                    {index === 0 ? (
                      <View style={photoshootStyles.coverBadge}>
                        <Text style={photoshootStyles.coverBadgeText}>{t('recipeBuilder.coverBadge')}</Text>
                      </View>
                    ) : null}
                    <Pressable
                      style={photoshootStyles.remove}
                      hitSlop={6}
                      onPress={() => handleRemovePhotoshootImage(index)}
                    >
                      <MaterialIcons name="close" size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {exampleResultUris.length < MAX_PHOTOSHOOT_IMAGES ? (
                  <Pressable style={photoshootStyles.add} onPress={handlePickPhotoshootImages}>
                    <MaterialIcons name="add-photo-alternate" size={28} color="#666" />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Spacer */}
            <View style={{ height: 40 }} />
          </ScrollView>

          {/* Cost Summary */}
          {previewCost > 0 && (
            <View style={styles.costSummary}>
              <View style={styles.costSummaryContent}>
                <Text style={styles.costLabel}>{t('recipeBuilder.totalCost')}</Text>
                <View style={styles.costValue}>
                  <Text style={styles.costAmount}>{previewCost}</Text>
                  <Zap size={20} color="#FFD700" strokeWidth={2.5} fill="#FFD700" />
                </View>
              </View>
            </View>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.saveButton, isSaving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="save" size={20} color="#fff" />
                  <Text style={styles.saveButtonText}>{t('recipeBuilder.saveButton')}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
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
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  modalContent: {
    flex: 1,
    backgroundColor: '#111',
    marginTop: 60,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
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
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  inputHint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    marginTop: -8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    padding: 14,
    margin: 20,
    marginBottom: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#f59e0b',
    lineHeight: 18,
  },
  ratioButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  ratioButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
  },
  ratioButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  ratioButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
  },
  ratioButtonTextActive: {
    color: '#fff',
  },
  ratioPreview: {
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: '#666',
  },
  ratioPreviewActive: {
    borderColor: '#fff',
  },
  modelPicker: {
    marginBottom: 4,
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#222',
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  modelOptionActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  modelOptionText: {
    fontSize: 14,
    color: '#999',
  },
  modelOptionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  switchLabelText: {
    flex: 1,
  },
  switchDescription: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  refImagesRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  refImageWrapper: {
    position: 'relative',
    width: 72,
    height: 72,
  },
  refImageThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  refImageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refImageAdd: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  costSummary: {
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  costSummaryContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  costLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#999',
  },
  costValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  costAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  cancelButton: {
    backgroundColor: '#333',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  saveButton: {
    backgroundColor: '#2196F3',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

const featuredImageStyles = StyleSheet.create({
  row: { flexDirection: 'row', marginTop: 8 },
  wrapper: { position: 'relative' },
  thumb: {
    width: 120,
    height: 90,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: '#222',
  },
  remove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: 120,
    height: 90,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
    gap: 4,
  },
  addLabel: { color: '#666', fontSize: 11 },
});

const photoshootStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  wrapper: {
    position: 'relative',
  },
  thumb: {
    width: 70,
    height: 92,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: '#222',
  },
  coverBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(255, 215, 0, 0.95)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  coverBadgeText: { color: '#000', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  remove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: 70,
    height: 92,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
  },
});

const categoryChipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
  },
  chipSelected: {
    backgroundColor: '#FFD700',
    borderColor: '#FFD700',
  },
  chipText: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#000',
  },
});
