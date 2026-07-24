/**
 * Recipe View Screen - Display recipe details and run workflow
 */

import React, { useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Dimensions,
  FlatList,
  InteractionManager,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { db } from '../../lib/database/db';
import { getRecipe, deleteRecipe, getRecipes, updateRecipe } from '../../lib/recipes/recipeQueries';
import type { Recipe } from '../../lib/recipes/types';
import { RECIPE_FLAT_COST_COINS } from '../../lib/recipes/pricing';
import { Zap, Plus, ArrowLeft, Share, Pencil, Trash2, Code, Camera, ImagePlus, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';

const ROUNDED_FONT = 'SFRounded-Medium';

import { supabase } from '../../lib/supabase';
import { useRecipeExecution } from '../hooks/useRecipeExecution';
import { useImageModels } from '../hooks/useCloudModels';
import { fetchPublicRecipe, importRecipeFromSupabase, deletePublicRecipe, type PublicRecipe } from '../../lib/recipes/supabaseRecipes';
import { useBalance } from '../../contexts/BalanceContext';

import { useSettings } from '../../contexts/SettingsContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { useAuth } from '../../contexts/AuthModalContext';
import { useSouls } from '../../contexts/SoulsContext';
import { useRecipes } from '../../contexts/RecipesContext';
import { hasCoinSystem } from '../../config/appVariant';
import CreateSoulModal from '../components/CreateSoulModal';
import { ensureAIConsent } from '../../lib/ai/aiConsent';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';


export default function RecipeViewScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { balanceInfo } = useBalance();

  const { hasCustomApiKey, isAdmin } = useSettings();
  const { showPaywall } = usePaywall();
  const { requireSession } = useAuth();
  const { souls, addSoul, updateSoul } = useSouls();
  const { removeRecipe } = useRecipes();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [publicRecipe, setPublicRecipe] = useState<PublicRecipe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isAlreadyImported, setIsAlreadyImported] = useState(false);
  const [isPreparingRun, setIsPreparingRun] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [showPromptAdmin, setShowPromptAdmin] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [selectedSoulId, setSelectedSoulId] = useState<string | null>(null);
  const [showCreateSoul, setShowCreateSoul] = useState(false);
  const [editingSoulData, setEditingSoulData] = useState<any>(null);
  const [anyPhotoUri, setAnyPhotoUri] = useState<string | null>(null);
  const [isPickerProcessing, setIsPickerProcessing] = useState(false);
  const [heroImgIdx, setHeroImgIdx] = useState(0);
  const { executeRecipe, state: executionState } = useRecipeExecution();
  const { models: cloudModels } = useImageModels();

  const MAX_PROMPT_LENGTH = 120;

  useEffect(() => {
    console.log('RecipeViewScreen mounted with ID:', id);
    loadRecipe();
    loadCurrentUser();
  }, [id]);

  // Auto-select first soul if available
  useEffect(() => {
    if (souls.length > 0 && !selectedSoulId) {
      setSelectedSoulId(souls[0].id);
    }
  }, [souls]);

  // Cycle through example images in the hero — matches the home tab card behavior.
  const heroImages = (() => {
    const r = recipe;
    if (r?.exampleResultUris?.length) return r.exampleResultUris;
    if (publicRecipe?.example_result_urls?.length) return publicRecipe.example_result_urls;
    const single = r?.exampleResultUri ?? publicRecipe?.example_result_url;
    return single ? [single] : [];
  })();
  useEffect(() => {
    setHeroImgIdx(0);
    if (heroImages.length < 2) return;
    const interval = setInterval(() => {
      setHeroImgIdx((i) => (i + 1) % heroImages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [heroImages.length]);


  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const navigation = useNavigation();

  const loadRecipe = async () => {
    try {
      console.log('Loading recipe with ID:', id);
      setIsLoading(true);

      await db.initialize();
      const loadedRecipe = await getRecipe(id);

      if (loadedRecipe) {
        setRecipe(loadedRecipe);
        setPublicRecipe(null);
        setIsAlreadyImported(false);
      } else {
        const publicRecipeData = await fetchPublicRecipe(id);

        if (publicRecipeData) {
          setPublicRecipe(publicRecipeData);
          setRecipe(null);

          const allRecipes = await getRecipes(1000, 0);
          const alreadyImported = allRecipes.some(r => r.supabaseRecipeId === id && !r.isHidden);
          setIsAlreadyImported(alreadyImported);
        } else {
          setRecipe(null);
          setPublicRecipe(null);
          setIsAlreadyImported(false);
        }
      }
    } catch (error) {
      console.error('Error loading recipe:', error);
      Alert.alert(t('recipe.errorTitle'), t('recipe.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };



  const handleImportRecipe = async () => {
    if (!publicRecipe) return;

    try {
      setIsImporting(true);

      const allRecipes = await getRecipes(1000, 0);
      const existingHiddenRecipe = allRecipes.find(r => r.supabaseRecipeId === id && r.isHidden);

      if (existingHiddenRecipe) {
        await updateRecipe(existingHiddenRecipe.id, { isHidden: false });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsAlreadyImported(true);
        Alert.alert(t('recipe.recipeAddedTitle'), t('recipe.recipeAddedMessage', { name: existingHiddenRecipe.name }));
      } else {
        const importedRecipe = await importRecipeFromSupabase(id, false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsAlreadyImported(true);
        Alert.alert(t('recipe.recipeImportedTitle'), t('recipe.recipeImportedMessage', { name: importedRecipe.name }));
      }
    } catch (error) {
      console.error('Error importing recipe:', error);
      Alert.alert(t('recipe.errorTitle'), t('recipe.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const pickAnyPhotoFromLibrary = async () => {
    if (!(await ensureAIConsent())) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('recipe.permissionRequiredTitle'), t('recipe.photoLibraryPermission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsPickerProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsPickerProcessing(false);
      }
      setAnyPhotoUri(uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const takeAnyPhotoWithCamera = async () => {
    if (!(await ensureAIConsent())) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('recipe.permissionRequiredTitle'), t('recipe.cameraPermission'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsPickerProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsPickerProcessing(false);
      }
      setAnyPhotoUri(uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleRunRecipe = async () => {
    if (isPreparingRun) return;

    // Registration is optional — just ensure a session (guests can run recipes).
    requireSession();

    try {
      setIsPreparingRun(true);

      let recipeToRun = recipe;

      if (!recipe && publicRecipe) {
        try {
          const allRecipes = await getRecipes(1000, 0);
          const existingRecipe = allRecipes.find(r => r.supabaseRecipeId === id);

          if (existingRecipe) {
            recipeToRun = existingRecipe;
          } else {
            const importedRecipe = await importRecipeFromSupabase(id, true);
            recipeToRun = importedRecipe;
          }
        } catch (error) {
          console.error('Error importing recipe before execution:', error);
          Alert.alert(t('recipe.errorTitle'), t('recipe.importFailed'));
          setIsPreparingRun(false);
          return;
        }
      }

      if (!recipeToRun) {
        setIsPreparingRun(false);
        return;
      }

      const costCoins = recipeCostCoins;

      const hasUnlimitedAccess = balanceInfo.displayText === '\u221E' ||
                                  balanceInfo.hasFalKey ||
                                  balanceInfo.hasReplicateKey;

      if (hasCoinSystem() && !hasUnlimitedAccess) {
        if (balanceInfo.rawValue < costCoins) {
          showPaywall('insufficient_coins');
          setIsPreparingRun(false);
          return;
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Resolve input images based on recipe mode.
      const photoInputLabel = recipeToRun.photoInputLabel?.trim();
      const isAnyPhotoMode = !!photoInputLabel;
      let inputImagesToUse: string[];
      if (isAnyPhotoMode) {
        inputImagesToUse = anyPhotoUri ? [anyPhotoUri] : [];
      } else {
        const selectedSoul = selectedSoulId ? souls.find(s => s.id === selectedSoulId) : null;
        inputImagesToUse = selectedSoul ? selectedSoul.imageUris : [];
      }

      // Defer the (now lightweight) enqueue work until after the alert has
      // a chance to render — the touch-to-alert path stays snappy.
      InteractionManager.runAfterInteractions(() => {
        executeRecipe(recipeToRun, inputImagesToUse);
      });

      setIsPreparingRun(false);

      Alert.alert(
        t('recipe.generationStartedTitle'),
        t('recipe.generationStartedMessage'),
        [
          { text: t('common.close'), style: 'cancel' },
          { text: t('recipe.goToLibrary'), onPress: () => router.push('/(tabs)/library') },
        ],
      );
    } catch (error) {
      console.error('Error preparing recipe run:', error);
      setIsPreparingRun(false);
    }
  };

  const handleCopyLink = async () => {
    if (!recipe && !publicRecipe) return;

    try {
      const deepLinkUrl = `https://picsroom-deeplink.vercel.app/api/deeplink?open=recipe/${id}`;
      await Clipboard.setStringAsync(deepLinkUrl);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('recipe.linkCopiedTitle'), t('recipe.linkCopiedMessage'));
    } catch (error) {
      console.error('Error copying link:', error);
      Alert.alert(t('recipe.errorTitle'), t('recipe.copyLinkFailed'));
    }
  };

  const handleDelete = () => {
    Alert.alert(
      t('recipe.deleteTitle'),
      t('recipe.deleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (recipe) {
                if (recipe.supabaseRecipeId) {
                  try {
                    await deletePublicRecipe(recipe.supabaseRecipeId);
                  } catch (unpublishError) {
                    console.error('Error unpublishing recipe:', unpublishError);
                  }
                }
                await deleteRecipe(id);
              } else if (publicRecipe) {
                await deletePublicRecipe(id);
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              removeRecipe(id);
              router.back();
            } catch (error) {
              console.error('Error deleting recipe:', error);
              Alert.alert(t('recipe.errorTitle'), t('recipe.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  // Compute allPrompts early so header can reference it safely
  const computeAllPrompts = (): string => {
    const steps = recipe?.steps ?? publicRecipe?.recipe_data?.steps;
    if (!steps) return '';
    return steps
      .flatMap((step: any) => step.prompts || [step.prompt || ''])
      .filter((p: string) => p?.trim())
      .join('\n\n');
  };
  const allPrompts = computeAllPrompts();

  // Resolve model names used across all steps
  const modelNames: string[] = (() => {
    const steps = recipe?.steps ?? publicRecipe?.recipe_data?.steps ?? [];
    const ids = new Set<string>();
    steps.forEach((step: any) => {
      const stepIds = step.modelIds || (step.modelId ? [step.modelId] : []);
      stepIds.forEach((id: string) => id && ids.add(id));
    });
    return Array.from(ids).map(id => {
      const found = cloudModels.find(m => m.slug === id);
      return found?.name || id;
    });
  })();

  // Reference images baked into the recipe (if any)
  const referenceImageUris: string[] =
    recipe?.referenceImageUris ?? publicRecipe?.recipe_data?.referenceImageUris ?? [];

  // Real recipe cost in coins, computed from each step's models, numImages, and prompts.
  // Falls back to the legacy flat cost while cloud models are still loading.
  const recipeCostCoins: number = (() => {
    const steps = recipe?.steps ?? publicRecipe?.recipe_data?.steps ?? [];
    if (steps.length === 0 || cloudModels.length === 0) return RECIPE_FLAT_COST_COINS;
    let total = 0;
    for (const step of steps as any[]) {
      const ids: string[] = step.modelIds || (step.modelId ? [step.modelId] : []);
      const numImages = step.numImages || 1;
      const numPrompts = step.prompts?.length || 1;
      const stepModelCost = ids.reduce((sum, id) => {
        const m = cloudModels.find(cm => cm.slug === id);
        return sum + (m?.costCoins || 0);
      }, 0);
      total += stepModelCost * numImages * numPrompts;
    }
    return total || RECIPE_FLAT_COST_COINS;
  })();

  // Set header - transparent to overlay on hero image
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: '',
      headerTransparent: true,
      headerBackVisible: false,
      headerStyle: {
        backgroundColor: 'transparent',
      },
      headerTintColor: '#fff',
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push('/(tabs)/recipes');
            }
          }}
          style={[styles.headerIconHit, { marginLeft: 4 }]}
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
      ),
      headerRight: () => {
        const isOwner = recipe || (publicRecipe && currentUserId && (publicRecipe.user_id === currentUserId || isAdmin));

        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 4 }}>
            {isAdmin && allPrompts.length > 0 && (
              <Pressable style={styles.headerIconHit} onPress={() => setShowPromptAdmin(prev => !prev)}>
                <Code size={18} color="#F4D58D" />
              </Pressable>
            )}
            <Pressable style={styles.headerIconHit} onPress={handleCopyLink}>
              <Share size={18} color="#fff" />
            </Pressable>
            {isOwner && (
              <>
                <Pressable style={styles.headerIconHit} onPress={() => router.push(`/recipe/edit/${id}`)}>
                  <Pencil size={18} color="#fff" />
                </Pressable>
                <Pressable style={styles.headerIconHit} onPress={handleDelete}>
                  <Trash2 size={18} color="#ef4444" />
                </Pressable>
              </>
            )}
          </View>
        );
      },
    });
  }, [recipe, publicRecipe, id, navigation, handleDelete, handleCopyLink, currentUserId, isAdmin]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!recipe && !publicRecipe) {
    return (
      <View style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={64} color="#666" />
        <Text style={styles.errorText}>{t('recipe.notFound')}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>{t('recipe.goBack')}</Text>
        </Pressable>
      </View>
    );
  }

  const getRecipeData = () => {
    if (recipe) {
      const multi = recipe.exampleResultUris && recipe.exampleResultUris.length > 0
        ? recipe.exampleResultUris
        : recipe.exampleResultUri ? [recipe.exampleResultUri] : [];
      return {
        name: recipe.name,
        steps: recipe.steps,
        exampleResultUri: recipe.exampleResultUri,
        exampleResultUris: multi,
        photoInputLabel: recipe.photoInputLabel?.trim() || null,
      };
    } else if (publicRecipe) {
      const multi = Array.isArray(publicRecipe.example_result_urls) && publicRecipe.example_result_urls.length > 0
        ? publicRecipe.example_result_urls
        : publicRecipe.example_result_url ? [publicRecipe.example_result_url] : [];
      return {
        name: publicRecipe.recipe_data.name,
        steps: publicRecipe.recipe_data.steps,
        exampleResultUri: publicRecipe.example_result_url,
        exampleResultUris: multi,
        photoInputLabel: publicRecipe.recipe_data.photoInputLabel?.trim() || null,
      };
    }
    return null;
  };

  const recipeData = getRecipeData();
  if (!recipeData) return null;

  const isPromptLong = allPrompts.length > MAX_PROMPT_LENGTH;
  const displayPrompt = promptExpanded || !isPromptLong
    ? allPrompts
    : allPrompts.slice(0, MAX_PROMPT_LENGTH) + '...';

  const handleCopyPrompt = async () => {
    await Clipboard.setStringAsync(allPrompts);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Prompt copied to clipboard');
  };

  const handleGoToCreate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/create',
      params: { prompt: allPrompts },
    });
  };

  const hasUnlimitedAccess = balanceInfo.hasFalKey ||
                             balanceInfo.hasReplicateKey ||
                             hasCustomApiKey;

  const showDollarPrice = balanceInfo.hasFalKey ||
                          balanceInfo.hasReplicateKey ||
                          hasCustomApiKey;

  const displayCostCoins = recipeCostCoins;
  const recipeCost = showDollarPrice
    ? `$${(displayCostCoins / 500).toFixed(2)}`
    : String(displayCostCoins);

  const isLoggedIn = balanceInfo.displayText !== '';

  const canAffordRecipe = (() => {
    if (balanceInfo.isLoading) return true;
    if (!isLoggedIn) return true;
    if (hasUnlimitedAccess) return true;
    return balanceInfo.rawValue >= displayCostCoins;
  })();

  const photoInputLabel = recipeData.photoInputLabel;
  const isAnyPhotoMode = !!photoInputLabel;
  const hasSoulSelected = !!selectedSoulId;
  const hasInputReady = isAnyPhotoMode ? !!anyPhotoUri : hasSoulSelected;
  const isRunButtonDisabled = executionState.isExecuting || isPreparingRun || !hasInputReady;

  const selectedSoul = selectedSoulId ? souls.find(s => s.id === selectedSoulId) : null;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Full-bleed Hero Image — cycles through example photos like the home cards. */}
        <Pressable
          style={styles.heroSection}
          onPress={() => {
            const tappedUri = heroImages[heroImgIdx] ?? recipeData.exampleResultUri;
            if (tappedUri) setFullScreenImage(tappedUri);
          }}
        >
          {heroImages.length > 0 ? (
            <Image
              source={{ uri: heroImages[heroImgIdx] ?? heroImages[0] }}
              style={styles.heroImage}
              contentFit="cover"
              transition={300}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.heroImagePlaceholder}>
              <MaterialIcons name="image" size={64} color="#333" />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={styles.heroGradient}
          >
            <View style={styles.heroBottom}>
              <Text style={styles.heroRecipeName}>{recipeData.name}</Text>
              <View style={styles.heroMetaCost}>
                <Zap size={14} color="#FF2D95" strokeWidth={2.5} fill="#FF2D95" />
                <Text style={styles.heroMetaCostText}>{recipeCost}</Text>
              </View>
            </View>
          </LinearGradient>
        </Pressable>

        {/* Input picker — any-photo mode replaces the soul selector. */}
        {isAnyPhotoMode ? (
          <View style={styles.soulSection}>
            <View style={anyPhotoStyles.titleWrap}>
              <Text style={[styles.sectionLabel, anyPhotoStyles.title]}>{t('recipe.choosePhotoToApply', { label: photoInputLabel })}</Text>
            </View>
            {isPickerProcessing ? (
              <View style={anyPhotoStyles.previewRow}>
                <View style={[anyPhotoStyles.thumbWrap, anyPhotoStyles.thumb, anyPhotoStyles.processingTile]}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={anyPhotoStyles.processingTileText}>{t('recipe.processing')}</Text>
                </View>
              </View>
            ) : anyPhotoUri ? (
              <View style={anyPhotoStyles.previewRow}>
                <View style={anyPhotoStyles.thumbWrap}>
                  <Image source={{ uri: anyPhotoUri }} style={anyPhotoStyles.thumb} contentFit="cover" />
                  <TouchableOpacity
                    style={anyPhotoStyles.removeBtn}
                    onPress={() => setAnyPhotoUri(null)}
                    hitSlop={8}
                  >
                    <X size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={anyPhotoStyles.actionsRow}>
                <TouchableOpacity style={anyPhotoStyles.actionBtn} onPress={pickAnyPhotoFromLibrary}>
                  <ImagePlus size={20} color="#fff" />
                  <Text style={anyPhotoStyles.actionText}>{t('recipe.library')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={anyPhotoStyles.actionBtn} onPress={takeAnyPhotoWithCamera}>
                  <Camera size={20} color="#fff" />
                  <Text style={anyPhotoStyles.actionText}>{t('recipe.camera')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : souls.length === 0 ? (
          <View style={styles.noSoulsEmptyState}>
            <Text style={styles.noSoulsHeadline}>{t('recipe.createSoulHeadline')}</Text>
            <TouchableOpacity
              style={styles.noSoulsButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowCreateSoul(true);
              }}
            >
              <Text style={styles.noSoulsButtonText}>{t('recipe.createSoul')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.soulSection}>
          <Text style={styles.sectionLabel}>{t('recipe.chooseSoul')}</Text>
          <Text style={styles.soulInfoText}>{t('recipe.soulInfo')}</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[...([...souls].reverse()), { id: '__add__' } as any]}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.soulList}
            renderItem={({ item }) => {
              if (item.id === '__add__') {
                return (
                  <TouchableOpacity
                    style={styles.addSoulButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowCreateSoul(true);
                    }}
                  >
                    <Plus size={24} color="#666" />
                    <Text style={styles.addSoulText}>{t('recipe.add')}</Text>
                  </TouchableOpacity>
                );
              }

              const isSelected = selectedSoulId === item.id;
              return (
                <TouchableOpacity
                  style={[styles.soulCard, isSelected && styles.soulCardSelected]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedSoulId(isSelected ? null : item.id);
                  }}
                  onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setEditingSoulData(item);
                    setShowCreateSoul(true);
                  }}
                >
                  {item.imageUris?.length > 0 ? (
                    <Image
                      source={{ uri: item.imageUris[0] }}
                      style={[styles.soulImage, isSelected && styles.soulImageSelected]}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.soulImage, styles.soulImagePlaceholder, isSelected && styles.soulImageSelected]}>
                      <MaterialIcons name="person" size={24} color="#666" />
                    </View>
                  )}
                  <Text style={[styles.soulName, isSelected && styles.soulNameSelected]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {isSelected && (
                    <View style={styles.soulCheckmark}>
                      <MaterialIcons name="check-circle" size={16} color="#F4D58D" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
        )}

        {/* Recipe details — visible to all users */}
        {(allPrompts.length > 0 || modelNames.length > 0 || referenceImageUris.length > 0) && (
          <View style={styles.infoSection}>
            {modelNames.length > 0 && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('recipe.model')}</Text>
                <Text style={styles.infoValue} numberOfLines={2}>
                  {modelNames.join(', ')}
                </Text>
              </View>
            )}

            {referenceImageUris.length > 0 && (
              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>{t('recipe.referenceImages')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.refImagesRow}
                >
                  {referenceImageUris.map((uri, idx) => (
                    <Pressable
                      key={`${uri}-${idx}`}
                      onPress={() => setFullScreenImage(uri)}
                    >
                      <Image
                        source={{ uri }}
                        style={styles.refImageThumb}
                        contentFit="cover"
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {isAdmin && showPromptAdmin && allPrompts.length > 0 && (
              <View style={styles.infoBlock}>
                <View style={styles.promptHeaderRow}>
                  <Text style={styles.infoLabel}>Prompt</Text>
                  <TouchableOpacity
                    style={styles.copyPromptButton}
                    onPress={handleCopyPrompt}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="content-copy" size={14} color="#9ca3af" />
                    <Text style={styles.copyPromptText}>Copy</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => isPromptLong && setPromptExpanded(!promptExpanded)}
                  activeOpacity={isPromptLong ? 0.7 : 1}
                >
                  <Text style={styles.promptCueText}>{displayPrompt}</Text>
                  {isPromptLong && (
                    <Text style={styles.promptExpandText}>
                      {promptExpanded ? 'Show less' : 'Show more'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Spacer for button */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Fixed Run Button — hidden when soul-required recipe has no souls yet */}
      {!(!isAnyPhotoMode && souls.length === 0) && (
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.generateButton,
            isRunButtonDisabled && styles.generateButtonDisabled
          ]}
          onPress={handleRunRecipe}
          disabled={isRunButtonDisabled}
        >
          <View style={styles.generateButtonContent}>
            <Text style={[styles.generateButtonText, isRunButtonDisabled && styles.generateButtonTextDisabled]} numberOfLines={1}>
              {isPreparingRun
                ? t('recipe.preparing')
                : executionState.isExecuting
                ? t('recipe.starting')
                : isAnyPhotoMode
                ? (!anyPhotoUri ? t('recipe.pickPhotoToContinue') : t('recipe.generate'))
                : !hasSoulSelected
                ? t('recipe.chooseSoulToApply')
                : t('recipe.generatePhotoOf', { name: selectedSoul?.name || t('recipe.you') })}
            </Text>
            {!isPreparingRun && !executionState.isExecuting && (
              <View style={styles.generateButtonPrice}>
                {showDollarPrice ? (
                  <Text style={[styles.generateButtonPriceText, isRunButtonDisabled && styles.generateButtonTextDisabled]}>
                    {recipeCost}
                  </Text>
                ) : (
                  <>
                    <Zap
                      size={20}
                      color={isRunButtonDisabled ? 'rgba(255,255,255,0.55)' : '#111'}
                      strokeWidth={2.5}
                      fill={isRunButtonDisabled ? 'rgba(255,255,255,0.55)' : '#111'}
                    />
                    <Text style={[styles.generateButtonPriceText, isRunButtonDisabled && styles.generateButtonTextDisabled]}>
                      {recipeCost}
                    </Text>
                  </>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
      )}

      {/* Full Screen Image Preview Modal */}
      <Modal
        visible={!!fullScreenImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFullScreenImage(null)}
      >
        <Pressable
          style={styles.fullScreenOverlay}
          onPress={() => setFullScreenImage(null)}
        >
          <View style={styles.fullScreenContainer}>
            {fullScreenImage && (
              <Image
                source={{ uri: fullScreenImage }}
                style={styles.fullScreenImage}
                contentFit="contain"
              />
            )}
          </View>
          <Pressable
            style={styles.fullScreenCloseButton}
            onPress={() => setFullScreenImage(null)}
          >
            <MaterialIcons name="close" size={28} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create/Edit Soul Modal */}
      <CreateSoulModal
        visible={showCreateSoul}
        onClose={() => {
          setShowCreateSoul(false);
          setEditingSoulData(null);
        }}
        editingSoul={editingSoulData}
        onSave={async (name, imageUris) => {
          if (editingSoulData) {
            await updateSoul(editingSoulData.id, { name, imageUris });
            setEditingSoulData(null);
            return editingSoulData.id;
          }
          const soulId = await addSoul({ name, imageUris });
          setSelectedSoulId(soulId);
          return soulId;
        }}
      />
    </View>
  );
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.65;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 200,
  },
  // Hero
  heroSection: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    backgroundColor: '#111',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
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
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 80,
  },
  heroBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroRecipeName: {
    fontSize: 19,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
    color: '#fff',
    flex: 1,
    marginRight: 12,
    letterSpacing: -0.2,
  },
  heroMetaCost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroMetaCostText: {
    fontSize: 16,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
    color: '#F4D58D',
  },
  // Header buttons
  headerIconHit: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soul Section
  soulSection: {
    paddingTop: 24,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  noSoulsEmptyState: {
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  noSoulsHeadline: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 28,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 36,
    letterSpacing: -0.5,
    paddingHorizontal: 8,
    marginBottom: 24,
  },
  noSoulsButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noSoulsButtonText: {
    fontSize: 17,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
    color: '#000',
  },
  soulInfoText: {
    fontSize: 14,
    fontFamily: ROUNDED_FONT,
    color: '#888',
    lineHeight: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 28,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
    color: '#fff',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  soulList: {
    gap: 12,
    paddingRight: 20,
  },
  soulCard: {
    alignItems: 'center',
    width: 72,
    position: 'relative',
  },
  soulCardSelected: {
    // Selection indicated by checkmark overlay
  },
  soulImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#222',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  soulImageSelected: {
    borderColor: '#F4D58D',
  },
  soulImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  soulName: {
    fontSize: 12,
    fontFamily: 'Manrope-Medium',
    color: '#999',
    marginTop: 6,
    textAlign: 'center',
  },
  soulNameSelected: {
    color: '#F4D58D',
  },
  soulCheckmark: {
    position: 'absolute',
    top: 0,
    right: 4,
    backgroundColor: '#000',
    borderRadius: 10,
  },
  addSoulButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0,
  },
  addSoulText: {
    fontSize: 10,
    fontFamily: 'Manrope-Medium',
    color: '#666',
    marginTop: 2,
  },
  // Admin prompt
  adminToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
  },
  adminToggleText: {
    fontSize: 12,
    fontFamily: 'Manrope-Medium',
    color: '#666',
  },
  infoSection: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoBlock: {
    gap: 8,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: 'Manrope-Medium',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
    color: '#fff',
    textAlign: 'right',
  },
  refImagesRow: {
    gap: 8,
    paddingRight: 4,
  },
  refImageThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#0a0a0a',
  },
  promptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptCueSection: {
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  promptCueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  promptCueLabel: {
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  copyPromptText: {
    fontSize: 12,
    fontFamily: 'Manrope-Medium',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goToCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 6,
  },
  goToCreateText: {
    fontSize: 12,
    fontFamily: 'Manrope-Medium',
    color: '#fff',
  },
  promptCueText: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: '#ccc',
    lineHeight: 20,
  },
  promptExpandText: {
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    color: '#F4D58D',
    marginTop: 8,
  },
  // Footer / Run Button
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    padding: 16,
  },
  generateButton: {
    backgroundColor: '#fff',
    borderRadius: 32,
    borderCurve: 'continuous',
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  generateButtonDisabled: {
    backgroundColor: '#333',
  },
  generateButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  generateButtonText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#111',
    flex: 1,
  },
  generateButtonTextDisabled: {
    color: 'rgba(255,255,255,0.55)',
  },
  generateButtonPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 12,
  },
  generateButtonPriceText: {
    color: '#111',
    fontSize: 20,
    fontWeight: '600',
  },
  // Loading / Error
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
    marginBottom: 24,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // Full Screen Image Preview
  fullScreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  fullScreenCloseButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const anyPhotoStyles = StyleSheet.create({
  titleWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    width: '75%',
    textAlign: 'center',
    marginBottom: 0,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 16,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  actionText: {
    color: '#fff',
    fontSize: 17,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width: 110,
    height: 110,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: '#0a0a0a',
  },
  processingTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  processingTileText: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: ROUNDED_FONT,
    fontWeight: '500',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
});
