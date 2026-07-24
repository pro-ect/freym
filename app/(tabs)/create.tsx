import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  StyleSheet,
  Keyboard,
  StatusBar,
  ActivityIndicator,
  Platform,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

const HAS_LIQUID_GLASS = (() => {
  try { return isLiquidGlassAvailable(); } catch { return false; }
})();
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Zap, ImagePlus, X } from 'lucide-react-native';
import SoulSelector from '../components/SoulSelector';
import CreateSoulModal from '../components/CreateSoulModal';
import DynamicModelForm, { getDefaultValuesFromSchema } from '../components/DynamicModelForm';
import PromptBuilder from '../components/PromptBuilder';
import AIPromptEditModal from '../components/AIPromptEditModal';
import { useSouls } from '../../contexts/SoulsContext';
import { useReplicateModel } from '../hooks/useReplicateModel';
import { useReplicateBalance } from '../hooks/useReplicateBalance';
import { useSettings } from '../../contexts/SettingsContext';
import { capturePH } from '../../lib/posthog';
import { showPrompt, showAlert } from '../../lib/utils/webAlert';
import { gptImage2CoinCost } from '../../lib/pricing';
import { useApiKeyModal } from '../../contexts/ApiKeyModalContext';
import { useAuth } from '../../contexts/AuthModalContext';

import { useBalance } from '../../contexts/BalanceContext';
import { useImageModels } from '../hooks/useCloudModels';
import { CloudModel, invalidateModelsCache } from '../../lib/cloudModels';
import { supabase } from '../../lib/supabase';
import CoinBalance from '../components/CoinBalance';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import Skeleton from '../components/Skeleton';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useLibrary } from '../../contexts/LibraryContext';
import { ensureAIConsent } from '../../lib/ai/aiConsent';

const MAX_REFERENCE_IMAGES = 10;
const TOOLS_TAG = 'tools';

// Component for reference images with loading state
interface ReferenceImageItemProps {
  uri: string;
  index: number;
  onRemove: (index: number) => void;
}

function ReferenceImageItem({ uri, index, onRemove }: ReferenceImageItemProps) {
  const [isLoading, setIsLoading] = useState(true);

  // Timeout fallback for iCloud photos that may not fire onLoadEnd properly
  useEffect(() => {
    setIsLoading(true); // Reset loading state when URI changes
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 5000); // 5 second timeout fallback

    return () => clearTimeout(timeout);
  }, [uri]); // Reset timeout when URI changes

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleError = useCallback(() => {
    // Hide loader on error too
    setIsLoading(false);
  }, []);

  return (
    <View style={refImageStyles.container}>
      <Image
        source={{ uri }}
        style={refImageStyles.image}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
      />
      {isLoading && (
        <View style={refImageStyles.loaderOverlay}>
          <ActivityIndicator size="small" color="#F4D58D" />
        </View>
      )}
      <TouchableOpacity
        style={refImageStyles.removeButton}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onRemove(index);
        }}
      >
        <MaterialIcons name="close" size={16} color="white" />
      </TouchableOpacity>
      <View style={refImageStyles.numberBadge}>
        <Text style={refImageStyles.numberText}>{index + 1}</Text>
      </View>
    </View>
  );
}

const refImageStyles = StyleSheet.create({
  container: {
    marginRight: 12,
    position: 'relative',
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#222',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34, 34, 34, 0.8)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#111',
  },
  numberBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  numberText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});

function GlassClearButton({ onPress }: { onPress: () => void }) {
  if (HAS_LIQUID_GLASS) {
    return (
      <GlassView isInteractive glassEffectStyle="clear" style={glassClearStyles.shell}>
        <TouchableOpacity onPress={onPress} hitSlop={8} style={glassClearStyles.touch} activeOpacity={0.85}>
          <MaterialIcons name="clear" size={20} color="#fff" />
        </TouchableOpacity>
      </GlassView>
    );
  }
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={glassClearStyles.shell} activeOpacity={0.85}>
      <MaterialIcons name="clear" size={20} color="#fff" />
    </TouchableOpacity>
  );
}

const glassClearStyles = StyleSheet.create({
  shell: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  touch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

export default function CreateScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Get prompt and model from navigation params (e.g., from recipe "Go to Create" or Home model tap)
  const { prompt: initialPrompt, model: initialModelSlug } = useLocalSearchParams<{
    prompt?: string;
    model?: string;
  }>();

  // Track keyboard visibility and height
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Cloud models from Supabase
  const { models: allCloudModels, isLoading: modelsLoading, error: modelsError, refresh: refreshCloudModels } = useImageModels();

  // Get API provider setting (admin-only, default: fal)
  const { apiProvider, isAdmin } = useSettings();

  // Filter models based on API provider
  // Fal models end with '-fal', Replicate models don't.
  // On-device tools end with '-local' and Cloudflare free models end with '-cf';
  // both pass through regardless of provider.
  const cloudModels = useMemo(() => {
    if (apiProvider === 'fal') {
      return allCloudModels.filter(m =>
        m.slug.endsWith('-fal') || m.slug.endsWith('-phota') || m.slug.endsWith('-local') || m.slug.endsWith('-cf')
      );
    } else {
      return allCloudModels.filter(m =>
        (!m.slug.endsWith('-fal') && !m.slug.endsWith('-phota')) || m.slug.endsWith('-local') || m.slug.endsWith('-cf')
      );
    }
  }, [allCloudModels, apiProvider]);

  // Extract unique tags from cloud models (excluding some tags)
  const allTags = useMemo(() => {
    const tagSet = new Set<string>(['all']);
    const excludedTags = ['typography', '4k', 'realism', 'flux2'];
    cloudModels.forEach(model => {
      model.tags.forEach(tag => {
        if (!excludedTags.includes(tag.toLowerCase())) {
          tagSet.add(tag);
        }
      });
    });
    return Array.from(tagSet);
  }, [cloudModels]);

  // Tag filtering - default to 'all' to show all models
  const [selectedTags, setSelectedTags] = useState<string[]>(['all']);

  // Show more models toggle (for 'all' tag)
  const [showAllModels, setShowAllModels] = useState(false);

  // Model selection - multiple models can be selected (by slug)
  const [selectedModelSlugs, setSelectedModelSlugs] = useState<string[]>([]);

  // Honor `?model=<slug>` from navigation. Studio stays mounted across tab
  // changes, so we ALWAYS adopt the slug when Home pushes one — every tap on
  // a Home model card should swap the active model. The default-fallback only
  // applies on first ever mount when no slug was sent and nothing's selected.
  useEffect(() => {
    if (cloudModels.length === 0) return;

    if (initialModelSlug && typeof initialModelSlug === 'string') {
      // Exact match first. Home surfaces ALL active models (no provider filter),
      // so it can pass a slug like 'flux-2-pro' that isn't selectable under the
      // current provider (fal mode only keeps '-fal' variants). In that case
      // resolve to the provider-appropriate variant so the chosen model still
      // routes through instead of silently falling back to the default.
      const base = initialModelSlug.replace(/-fal$/, '');
      const requested =
        cloudModels.find(m => m.slug === initialModelSlug) ||
        cloudModels.find(m => m.slug === `${base}-fal`) ||
        cloudModels.find(m => m.slug === base);
      if (requested) {
        setSelectedModelSlugs([requested.slug]);
        return;
      }
    }

    if (selectedModelSlugs.length === 0) {
      // Prefer Nano Banana 2, fall back to original Nano Banana if unavailable
      const defaultModel =
        cloudModels.find(m => m.slug === 'nano-banana-2-fal') ||
        cloudModels.find(m => m.slug === 'nano-banana-fal');
      if (defaultModel) {
        setSelectedModelSlugs([defaultModel.slug]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudModels, initialModelSlug]);

  // Model-specific form values (keyed by model slug)
  const [modelFormValues, setModelFormValues] = useState<Record<string, Record<string, any>>>({});

  // Text prompt
  const [prompt, setPrompt] = useState('');
  const [promptInputHeight, setPromptInputHeight] = useState(140);

  // Set prompt from navigation params (from recipe "Go to Create")
  useEffect(() => {
    if (initialPrompt && typeof initialPrompt === 'string') {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  // Reference images
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // Measured megapixels of the first reference image (used for Topaz tier pricing).
  // Falls back to 4MP (~2048×2048) if measurement is pending or fails.
  const [inputMegapixels, setInputMegapixels] = useState<number>(4);
  useEffect(() => {
    const uri = referenceImages[0];
    if (!uri) {
      setInputMegapixels(4);
      return;
    }
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled) setInputMegapixels((w * h) / 1_000_000);
      },
      () => {
        if (!cancelled) setInputMegapixels(4);
      },
    );
    return () => { cancelled = true; };
  }, [referenceImages]);

  // Track which images came from which soul for proper removal
  const [soulImageMapping, setSoulImageMapping] = useState<Map<string, string[]>>(new Map());

  // Soul creation modal
  const [showCreateSoulModal, setShowCreateSoulModal] = useState(false);
  const [editingSoulId, setEditingSoulId] = useState<string | null>(null);
  const { addSoul, souls } = useSouls();
  const editingSoul = useMemo(
    () => (editingSoulId ? souls.find((s) => s.id === editingSoulId) ?? null : null),
    [editingSoulId, souls],
  );

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Prompt builder modal
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);

  // AI prompt edit modal
  const [showAIPromptEdit, setShowAIPromptEdit] = useState(false);

  // Fullscreen prompt edit modal
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [fullscreenPromptDraft, setFullscreenPromptDraft] = useState('');

  // Souls section collapse
  const [soulsCollapsed, setSoulsCollapsed] = useState(false);

  // Number of images to generate (1-10) - creates separate jobs
  const [numImagesToGenerate, setNumImagesToGenerate] = useState(1);

  // Global aspect ratio (applied to models that support it)
  const [globalAspectRatio, setGlobalAspectRatio] = useState<string>('9:16');

  // Button cooldown to prevent accidental multiple presses
  const [isButtonCooldown, setIsButtonCooldown] = useState(false);

  // Balance display (Replicate or Coins) - auto-updates via realtime
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();
  const { hasCustomKey: hasCustomApiKey } = useBalance();
  const { checkCanGenerate } = useApiKeyModal();
  const { requireSession } = useAuth();

  // Generation hooks
  const { generate: generateReplicateModel } = useReplicateModel();
  const { addImage } = useLibrary();

  // Get selected cloud models
  const selectedModels = useMemo(() => {
    return selectedModelSlugs
      .map(slug => cloudModels.find(m => m.slug === slug))
      .filter((m): m is CloudModel => m !== undefined);
  }, [selectedModelSlugs, cloudModels]);

  // Check if model is a tools model (no prompt needed)
  const isToolsModel = (model: CloudModel) => model.tags.includes(TOOLS_TAG);

  // Check if all selected models are tools (no prompt needed)
  const allSelectedAreTools = selectedModels.length > 0 && selectedModels.every(isToolsModel);

  // Check if any selected model accepts reference images
  const supportsReferenceImages = useMemo(() => {
    if (selectedModels.length === 0) return true; // Show by default when no models selected
    return selectedModels.some(model => (model.referenceImagesMax || 0) > 0);
  }, [selectedModels]);

  // Topaz tier pricing — must match start-prediction-fal/index.ts.
  // Tiers (output MP → coins): ≤24=40, ≤48=80, ≤96=160, ≤512=680.
  const topazCoinsForRun = (model: CloudModel): number => {
    const f = Number(modelFormValues[model.slug]?.upscale_factor) || 2;
    const factor = Math.max(1, Math.min(4, Math.round(f)));
    const outputMp = (inputMegapixels > 0 ? inputMegapixels : 4) * factor * factor;
    const cents = outputMp <= 24 ? 8 : outputMp <= 48 ? 16 : outputMp <= 96 ? 32 : 136;
    return Math.ceil(cents * 5);
  };

  // Crystal size-based pricing — must match start-prediction-fal/index.ts.
  // Fal charges $0.016 per output MP; output MP = input MP × factor². Floor 20 coins.
  const crystalCoinsForRun = (model: CloudModel): number => {
    const f = Number(modelFormValues[model.slug]?.scale_factor) || 2;
    const factor = Math.max(2, Math.min(6, Math.round(f)));
    const outputMp = (inputMegapixels > 0 ? inputMegapixels : 4) * factor * factor;
    return Math.max(20, Math.ceil(outputMp * 1.6 * 5));
  };

  // GPT Image 2 quality × resolution pricing — must match start-prediction-fal/index.ts.
  const gptImage2CoinsForRun = (model: CloudModel): number => {
    const form = modelFormValues[model.slug] || {};
    return gptImage2CoinCost(form.quality, form.image_size);
  };

  // Seedream 5.0 Pro 1K/2K pricing — must match start-prediction-fal/index.ts.
  // Base costCoins is the 1K price; 2K doubles it (Fal $0.0675 → $0.135).
  const seedreamProCoinsForRun = (model: CloudModel): number => {
    const size = String(modelFormValues[model.slug]?.image_size ?? '2K');
    return size.includes('2K') ? model.costCoins * 2 : model.costCoins;
  };

  // Calculate total cost from cloud models
  const getTotalCost = () => {
    if (selectedModels.length === 0) return '0';
    const totalCoins = selectedModels.reduce((sum, model) => {
      const numImages = isToolsModel(model) ? referenceImages.length : numImagesToGenerate;
      const perRun = model.slug === 'topaz-upscale-fal'
        ? topazCoinsForRun(model)
        : model.slug === 'crystal-upscaler-fal'
          ? crystalCoinsForRun(model)
          : model.slug === 'gpt-image-2-fal'
            ? gptImage2CoinsForRun(model)
            : model.slug === 'seedream-5-pro-fal'
              ? seedreamProCoinsForRun(model)
              : model.costCoins;
      return sum + (perRun * numImages);
    }, 0);
    return hasCustomApiKey ? `$${(totalCoins / 500).toFixed(2)}` : String(totalCoins);
  };

  // Filter models by selected tags, then float pinned models to the top.
  const filteredModels = useMemo(() => {
    const base = selectedTags.includes('all')
      ? cloudModels
      : cloudModels.filter((model) => selectedTags.some((tag) => model.tags.includes(tag)));
    return [...base].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }, [cloudModels, selectedTags]);

  // If a selected model lives in the collapsed tail (past the first 8 shown
  // under the 'all' tag), auto-expand so the chosen model stays visible.
  useEffect(() => {
    if (!selectedTags.includes('all') || showAllModels) return;
    if (selectedModelSlugs.length === 0) return;
    const hiddenSelected = filteredModels
      .slice(8)
      .some((m) => selectedModelSlugs.includes(m.slug));
    if (hiddenSelected) setShowAllModels(true);
  }, [filteredModels, selectedModelSlugs, selectedTags, showAllModels]);

  // Up to 8 models can be pinned across the whole catalog.
  const PIN_LIMIT = 8;
  const pinnedCount = useMemo(
    () => cloudModels.filter((m) => m.isPinned).length,
    [cloudModels],
  );

  const togglePinModel = useCallback(async (model: CloudModel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextPinned = !model.isPinned;
    if (nextPinned && pinnedCount >= PIN_LIMIT) {
      Alert.alert(
        t('studio.pinLimitReachedTitle'),
        t('studio.pinLimitReachedMessage', { n: PIN_LIMIT }),
      );
      return;
    }
    Alert.alert(
      nextPinned ? t('studio.pinToTopTitle') : t('studio.unpinModelTitle'),
      model.name,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: nextPinned ? t('studio.pinToTop') : t('studio.unpin'),
          style: nextPinned ? 'default' : 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('models')
              .update({ is_pinned: nextPinned })
              .eq('id', model.id);
            if (error) {
              console.error('[create] pin update failed:', error);
              Alert.alert(t('studio.pinUpdateFailedTitle'), error.message ?? t('studio.pinUpdateFailedMessage'));
              return;
            }
            await invalidateModelsCache();
            await refreshCloudModels();
          },
        },
      ],
    );
  }, [pinnedCount, refreshCloudModels]);

  // Get max reference images based on selected models (use most restrictive)
  const maxReferenceImages = useMemo(() => {
    if (selectedModels.length === 0) {
      return MAX_REFERENCE_IMAGES;
    }
    return selectedModels.reduce((min, model) => {
      const modelMax = model.referenceImagesMax || MAX_REFERENCE_IMAGES;
      return Math.min(min, modelMax);
    }, MAX_REFERENCE_IMAGES);
  }, [selectedModels]);

  // Get min reference images required (use most restrictive)
  const minReferenceImages = useMemo(() => {
    if (selectedModels.length === 0) return 0;
    return selectedModels.reduce((max, model) => {
      return Math.max(max, model.referenceImagesMin || 0);
    }, 0);
  }, [selectedModels]);

  // Format aspect ratio option for display
  const formatAspectRatioLabel = (ratio: string): string => {
    const labels: Record<string, string> = {
      'default': t('studio.aspectDefault'),
      'auto_2K': t('studio.aspectAuto2K'),
      'auto_4K': t('studio.aspectAuto4K'),
      'square_hd': t('studio.aspectSquareHd'),
      'square': t('studio.aspectSquare'),
      'portrait_3_4': t('studio.aspectPortrait34'),
      'portrait_9_16': t('studio.aspectPortrait916'),
      'landscape_4_3': t('studio.aspectLandscape43'),
      'landscape_16_9': t('studio.aspectLandscape169'),
    };
    return labels[ratio] || ratio;
  };

  // Get aspect ratio options from selected models
  const aspectRatioInfo = useMemo(() => {
    // Common aspect ratios as fallback
    const commonAspectRatios = ['9:16', '1:1', '16:9', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'];

    // Find models that have aspect_ratio in their paramSchema
    const modelsWithAspectRatio = selectedModels.filter(
      model => model.paramSchema?.aspect_ratio?.type === 'select'
    );

    if (modelsWithAspectRatio.length === 0) {
      return { show: false, options: [], supportedModels: 0, totalModels: selectedModels.length };
    }

    // If single model selected, use its specific options from param_schema
    if (modelsWithAspectRatio.length === 1) {
      const modelOptions = modelsWithAspectRatio[0].paramSchema?.aspect_ratio?.options;
      if (modelOptions && Array.isArray(modelOptions) && modelOptions.length > 0) {
        return {
          show: true,
          options: modelOptions,
          supportedModels: 1,
          totalModels: selectedModels.length,
        };
      }
    }

    // Multiple models or no specific options - use common aspect ratios
    return {
      show: true,
      options: commonAspectRatios,
      supportedModels: modelsWithAspectRatio.length,
      totalModels: selectedModels.length,
    };
  }, [selectedModels]);

  // Check if reference images are required
  const requiresReferenceImages = minReferenceImages > 0;

  // Pick reference images
  const pickImages = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (referenceImages.length >= maxReferenceImages) {
      Alert.alert(
        t('studio.limitReachedTitle'),
        t('studio.limitReachedMessage', { n: maxReferenceImages })
      );
      return;
    }

    if (!(await ensureAIConsent())) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(t('studio.permissionRequiredTitle'), t('studio.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: maxReferenceImages - referenceImages.length,
    });

    if (!result.canceled && result.assets) {
      const newImages = result.assets.map(asset => asset.uri);
      const combinedImages = [...referenceImages, ...newImages].slice(0, maxReferenceImages);
      setReferenceImages(combinedImages);
    }
  };

  // Remove reference image
  const removeImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
  };

  // Handle soul selection
  const handleSelectSoul = (soulId: string, imageUris: string[], soulName: string): boolean => {
    const newTotal = referenceImages.length + imageUris.length;

    if (newTotal > maxReferenceImages) {
      return false; // Fail silently, SoulSelector will show alert
    }

    // Add soul images to reference images
    const combinedImages = [...referenceImages, ...imageUris].slice(0, maxReferenceImages);
    setReferenceImages(combinedImages);

    // Track which images came from this soul
    setSoulImageMapping(prev => new Map(prev).set(soulId, imageUris));

    return true;
  };

  // Handle soul deselection
  const handleDeselectSoul = (soulId: string): void => {
    const soulImages = soulImageMapping.get(soulId);
    if (!soulImages) return;

    // Remove only the images that came from this soul
    setReferenceImages(prev =>
      prev.filter(uri => !soulImages.includes(uri))
    );

    // Remove the soul from the mapping
    setSoulImageMapping(prev => {
      const newMap = new Map(prev);
      newMap.delete(soulId);
      return newMap;
    });
  };

  // Initialize form values when model is selected
  useEffect(() => {
    selectedModels.forEach(model => {
      if (!modelFormValues[model.slug]) {
        const defaults = getDefaultValuesFromSchema(model.paramSchema);
        setModelFormValues(prev => ({
          ...prev,
          [model.slug]: defaults,
        }));
      }
    });
  }, [selectedModels]);

  // Handle generate - generate with all selected models
  const handleGenerate = async () => {
    // Registration is optional — just ensure a session (guests can generate).
    requireSession();

    // For API variant, check if user has API key (show modal if not)
    if (!checkCanGenerate()) {
      return;
    }

    if (selectedModels.length === 0) {
      Alert.alert(t('studio.noModelSelectedTitle'), t('studio.noModelSelectedMessage'));
      return;
    }

    // Activate cooldown to prevent accidental double-taps
    setIsButtonCooldown(true);
    setTimeout(() => setIsButtonCooldown(false), 1500);

    // More active haptic feedback on job start
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();

    // Generate with each selected model
    for (const model of selectedModels) {
      // Get form values for this model, or use defaults
      const formValues = modelFormValues[model.slug] || getDefaultValuesFromSchema(model.paramSchema);

      // Build options from form values
      const options: Record<string, any> = {
        ...formValues,
      };

      // Apply global aspect ratio only to models that support it
      const modelSupportsAspectRatio = model.paramSchema?.aspect_ratio?.type === 'select';
      if (modelSupportsAspectRatio) {
        options.aspect_ratio = globalAspectRatio;
      }

      // Topaz/Crystal: pass measured input MP so the server can price by output size.
      // Internal field — stripped before Fal call by the `_` prefix logic.
      if ((model.slug === 'topaz-upscale-fal' || model.slug === 'crystal-upscaler-fal') && inputMegapixels > 0) {
        options._input_megapixels = inputMegapixels;
      }

      // Handle aspect_ratio with match_input_image
      if (options.aspect_ratio === 'match_input_image' && referenceImages.length === 0) {
        options.aspect_ratio = '16:9';
      }

      // Check if model supports reference images
      const modelSupportsImages = (model.referenceImagesMax || 0) > 0;

      // For tools models, create separate job for each image
      if (isToolsModel(model)) {
        for (const imageUri of referenceImages) {
          await generateReplicateModel(model.slug, '', [imageUri], options);
        }
      } else {
        // Only pass images to models that support them
        const imagesToPass = modelSupportsImages ? referenceImages : [];

        // Create separate jobs for each image requested (not num_images parameter)
        for (let i = 0; i < numImagesToGenerate; i++) {
          await generateReplicateModel(model.slug, prompt, imagesToPass, options);
        }
      }
    }

  };

  // "Request a model" — free-text wish sent to PostHog.
  // showPrompt works on all platforms (Alert.prompt is iOS-only / no-ops on Android).
  const handleRequestModel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showPrompt(
      t('studio.requestModelTitle'),
      t('studio.requestModelMessage'),
      { confirmText: t('studio.send'), cancelText: t('common.cancel') },
    ).then((text) => {
      const requested = (text || '').trim();
      if (!requested) return;
      capturePH('model_request', { requested_model: requested, source: 'studio' });
      showAlert(t('studio.requestThanksTitle'), t('studio.requestThanksMessage'));
    });
  };

  // Clear form data
  const handleClearForm = () => {
    setPrompt('');
    setReferenceImages([]);
    setSoulImageMapping(new Map());
    setModelFormValues({});
  };

  // Toggle tag selection - only one tag at a time
  const toggleTag = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        setSelectedModelSlugs([]);
        return ['all'];
      } else {
        setSelectedModelSlugs([]);
        return [tag];
      }
    });
  };

  // Toggle model selection
  const toggleModel = (modelSlug: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModelSlugs(prev => {
      if (prev.includes(modelSlug)) {
        return prev.filter(s => s !== modelSlug);
      } else {
        return [...prev, modelSlug];
      }
    });
  };

  // Update form value for a model
  const updateModelFormValue = (modelSlug: string, key: string, value: any) => {
    setModelFormValues(prev => ({
      ...prev,
      [modelSlug]: {
        ...(prev[modelSlug] || {}),
        [key]: value,
      },
    }));
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Header — translucent blur overlay matching Home/Recipes (no solid back) */}
      <View pointerEvents="box-none" style={[styles.headerOverlay, { height: insets.top + 8 + 44 + 12 }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
              locations={[0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            tint="systemChromeMaterialDark"
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>

        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {selectedModels.length === 0
                ? t('studio.title')
                : selectedModels.length === 1
                ? selectedModels[0].name
                : t('studio.modelsCount', { n: selectedModels.length })}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {(prompt || referenceImages.length > 0) && (
              <GlassClearButton
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleClearForm();
                }}
              />
            )}
            <CoinBalance
              balance={balanceInfo.isLoading ? null : balanceInfo.displayText}
              onPress={() => setShowSettings(true)}
              iconType="asterisk"
              isPremium={subscriptionStatus.isSubscribed}
            />
          </View>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Loading State — skeleton chip grid matching the real layout */}
        {modelsLoading && (
          <View style={styles.section}>
            <View style={styles.modelSelector}>
              {Array.from({ length: showAllModels ? 16 : 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  style={styles.modelOptionSkeleton}
                  borderRadius={16}
                  delayMs={i * 40}
                />
              ))}
            </View>
            <Skeleton
              style={styles.showMoreSkeleton}
              borderRadius={6}
              delayMs={400}
            />
          </View>
        )}

        {/* Model selector — section heading and tag filters removed for now;
            tags will come back later in a different shape. */}
        {!modelsLoading && (
          <View style={styles.section}>
            {/* Models grid */}
            {filteredModels.length === 0 ? (
              <View style={styles.noModelsContainer}>
                <Text style={styles.noModelsText}>{t('studio.noModelsMatchTags')}</Text>
              </View>
            ) : (
              <>
                <View style={styles.modelSelector}>
                    {(selectedTags.includes('all') && !showAllModels
                      ? filteredModels.slice(0, 8)
                      : filteredModels
                    ).map((model) => {
                      const isSelected = selectedModelSlugs.includes(model.slug);
                      const isPinned = model.isPinned;

                      // Only the headline-launch model carries a NEW sticker
                      // for now. Other newer models are listed in Home; here
                      // the badge is reserved so it really means "headline".
                      const showNewSticker = model.slug === 'nano-banana-2-fal';

                      return (
                        <TouchableOpacity
                          key={model.slug}
                          style={[
                            styles.modelOption,
                            isSelected && styles.modelOptionActive,
                          ]}
                          onPress={() => toggleModel(model.slug)}
                          onLongPress={() => togglePinModel(model)}
                          delayLongPress={400}
                        >
                          <View style={styles.modelOptionContent}>
                            <View style={styles.modelOptionText}>
                              <Text
                                style={[
                                  styles.modelOptionTitle,
                                  isSelected && styles.modelOptionTitleActive,
                                ]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                              >
                                {model.name}
                              </Text>
                            </View>
                            {/* Selection is already indicated by the gold card
                                background, so no dot for selected models. Only
                                render the gold dot when a model is pinned and
                                not currently selected. */}
                            {!isSelected && isPinned ? (
                              <View
                                style={[
                                  styles.modelOptionCheck,
                                  styles.modelOptionCheckPinned,
                                ]}
                              />
                            ) : null}
                          </View>

                          {showNewSticker && (
                            <View style={styles.newSticker} pointerEvents="none">
                              <Text style={styles.newStickerText}>NEW</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                {selectedTags.includes('all') && filteredModels.length > 8 && (
                  <TouchableOpacity
                    style={styles.showMoreButtonFlat}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowAllModels(!showAllModels);
                    }}
                  >
                    <Text style={styles.showMoreText}>
                      {showAllModels ? t('studio.showLess') : t('studio.showMore', { n: filteredModels.length - 8 })}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.requestModelButton}
                  onPress={handleRequestModel}
                >
                  <Text style={styles.requestModelText}>
                    {t('studio.cantFindModel')} <Text style={styles.requestModelLink}>{t('studio.requestIt')}</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Souls — large variant, recipe-page-style avatars (hidden for tools models) */}
        {supportsReferenceImages && !allSelectedAreTools && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.soulsHeader}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSoulsCollapsed((v) => !v);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{t('studio.souls')}</Text>
              <MaterialIcons
                name={soulsCollapsed ? 'expand-more' : 'expand-less'}
                size={22}
                color="#9ca3af"
              />
            </TouchableOpacity>
            {!soulsCollapsed && (
              <SoulSelector
                variant="large"
                onSelectSoul={handleSelectSoul}
                onDeselectSoul={handleDeselectSoul}
                maxImages={maxReferenceImages}
                currentImageCount={referenceImages.length}
                onAddNewSoul={() => {
                  setEditingSoulId(null);
                  setShowCreateSoulModal(true);
                }}
                onLongPressSoul={(soulId) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setEditingSoulId(soulId);
                  setShowCreateSoulModal(true);
                }}
              />
            )}
          </View>
        )}

        {/* Reference images — separate block, manual photo picker only */}
        {supportsReferenceImages && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('studio.referenceImagesCount', { current: referenceImages.length, max: maxReferenceImages })}
            </Text>
            <View style={styles.card}>
              {referenceImages.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageList}>
                  {referenceImages.length < maxReferenceImages && (
                    <TouchableOpacity
                      style={styles.addImageCard}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        pickImages();
                      }}
                    >
                      <Text style={styles.addImageText}>{t('studio.addMore')}</Text>
                    </TouchableOpacity>
                  )}
                  {referenceImages.map((uri, index) => (
                    <ReferenceImageItem
                      key={`${uri}-${index}`}
                      uri={uri}
                      index={index}
                      onRemove={removeImage}
                    />
                  ))}
                </ScrollView>
              ) : (
                <TouchableOpacity
                  style={styles.emptyImagePicker}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    pickImages();
                  }}
                >
                  <Text style={styles.emptyText}>{t('studio.tapToAddImages')}</Text>
                  <Text style={styles.emptySubtext}>
                    {requiresReferenceImages || allSelectedAreTools ? t('studio.required') : t('studio.upTo', { n: maxReferenceImages })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Prompt Input - hidden for tools models */}
        {!allSelectedAreTools && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{t('studio.prompt')}</Text>
                {prompt.trim().length > 0 && <View style={styles.filledIndicator} />}
              </View>
              <View style={styles.promptButtonsRow}>
                {prompt.trim().length > 0 && (
                  <TouchableOpacity
                    style={styles.promptIconButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPrompt('');
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <MaterialIcons name="clear" size={16} color="#9ca3af" />
                  </TouchableOpacity>
                )}
                {/* AI Edit hidden temporarily — needs fixes */}
                {false && (
                  <TouchableOpacity
                    style={styles.aiEditButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowAIPromptEdit(true);
                    }}
                  >
                    <MaterialIcons name="auto-awesome" size={13} color="#a78bfa" />
                    <Text style={styles.aiEditButtonText}>AI</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.fullscreenPromptButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setFullscreenPromptDraft(prompt);
                    setShowFullscreenPrompt(true);
                  }}
                >
                  <MaterialIcons name="open-in-full" size={13} color="#60a5fa" />
                  <Text style={styles.fullscreenPromptButtonText}>{t('studio.full')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.promptBuilderButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowPromptBuilder(true);
                  }}
                >
                  <MaterialIcons name="bookmark" size={13} color="#F4D58D" />
                  <Text style={styles.promptBuilderButtonText}>{t('studio.saved')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.card}>
              <TextInput
                style={[styles.promptInput, styles.promptInputAutoGrow]}
                placeholder={t('studio.promptPlaceholder')}
                placeholderTextColor="#6b7280"
                value={prompt}
                onChangeText={setPrompt}
                multiline
                textAlignVertical="top"
                scrollEnabled={false}
              />
            </View>
          </View>
        )}

        {/* Souls and reference images now render above the prompt block. */}

        {/* Global Aspect Ratio - shown when any selected model supports it */}
        {aspectRatioInfo.show && !allSelectedAreTools && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('studio.aspectRatio')}</Text>
            <View style={styles.card}>
              <View style={styles.aspectRatioHeader}>
                {aspectRatioInfo.supportedModels < aspectRatioInfo.totalModels && (
                  <Text style={styles.aspectRatioNote}>
                    {t('studio.appliedToModels', { supported: aspectRatioInfo.supportedModels, total: aspectRatioInfo.totalModels })}
                  </Text>
                )}
              </View>
              <View style={styles.aspectRatioScrollContent}>
                <View style={styles.aspectRatioButtons}>
                  {aspectRatioInfo.options.map((ratio) => (
                    <TouchableOpacity
                      key={ratio}
                      style={[
                        styles.aspectRatioButton,
                        globalAspectRatio === ratio && styles.aspectRatioButtonActive,
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setGlobalAspectRatio(ratio);
                      }}
                    >
                      <Text style={[
                        styles.aspectRatioText,
                        globalAspectRatio === ratio && styles.aspectRatioTextActive,
                      ]}>
                        {formatAspectRatioLabel(ratio)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Dynamic Model Options - from cloud param_schema (excluding global/hidden controls) */}
        {selectedModels.length === 1 && (() => {
          // Filter out fields that are either global controls or hidden from UI
          const hiddenFields = [
            'aspect_ratio',      // Global control
            'num_images',        // Global control
            'safety_filter',     // Hidden - always disabled
            'disable_safety_checker', // Hidden - always disabled
            'safe_mode',         // Hidden - always disabled
            'output_format',     // Hidden - use PNG
            'output_quality',    // Hidden - use max quality
            'prompt_magic',      // Hidden
            'magic_prompt',      // Hidden
            'magic_prompt_option', // Hidden
            'prompt_upsampling',  // Hidden
            'style',             // Hidden (ideogram)
            'style_type',        // Hidden (ideogram)
          ];
          const filteredSchema = Object.fromEntries(
            Object.entries(selectedModels[0].paramSchema).filter(([key]) => !hiddenFields.includes(key))
          );
          return Object.keys(filteredSchema).length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('studio.modelOptions')}</Text>
              <View style={styles.card}>
                <DynamicModelForm
                  schema={filteredSchema}
                  values={modelFormValues[selectedModels[0].slug] || {}}
                  onChange={(key, value) => updateModelFormValue(selectedModels[0].slug, key, value)}
                  referenceImagesCount={referenceImages.length}
                />
              </View>
            </View>
          ) : null;
        })()}

        {/* Number of Images to Generate - hidden for tools models */}
        {selectedModels.length > 0 && !allSelectedAreTools && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('studio.quantity')}</Text>
            <View style={styles.card}>
              <View style={styles.numImagesHeader}>
                <Text style={styles.numImagesDescription}>
                  {t('studio.quantityDescription', { n: numImagesToGenerate, total: numImagesToGenerate * selectedModels.length })}
                </Text>
              </View>
              <View style={styles.numImagesScrollContent}>
                <View style={styles.numImagesButtons}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.numImageButton,
                        numImagesToGenerate === num && styles.numImageButtonActive,
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setNumImagesToGenerate(num);
                      }}
                    >
                      <Text style={[
                        styles.numImageText,
                        numImagesToGenerate === num && styles.numImageTextActive,
                      ]}>
                        {num}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Generate Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.generateButton,
            (
              isButtonCooldown ||
              selectedModels.length === 0 ||
              (!allSelectedAreTools && !prompt.trim()) ||
              (requiresReferenceImages && referenceImages.length < minReferenceImages) ||
              (allSelectedAreTools && referenceImages.length < 1)
            ) && styles.generateButtonDisabled
          ]}
          onPress={handleGenerate}
          disabled={
            isButtonCooldown ||
            selectedModels.length === 0 ||
            (!allSelectedAreTools && !prompt.trim()) ||
            (requiresReferenceImages && referenceImages.length < minReferenceImages) ||
            (allSelectedAreTools && referenceImages.length < 1)
          }
        >
          <View style={styles.generateButtonContent}>
            <Text style={styles.generateButtonText}>
              {isButtonCooldown
                ? t('studio.startedCheckLibrary')
                : selectedModels.length === 0
                ? t('studio.selectModels')
                : selectedModels.length === 1
                ? (isToolsModel(selectedModels[0])
                    ? (selectedModels[0].slug.includes('upscal') ? t('studio.upscaleImage') :
                       selectedModels[0].slug.includes('background') ? t('studio.removeBackground') :
                       t('studio.processImage'))
                    : t('studio.generateImage'))
                : t('studio.generateWithModels', { n: selectedModels.length })}
            </Text>
            {selectedModels.length > 0 && !isButtonCooldown && (
              <View style={styles.generateButtonPrice}>
                {getTotalCost() === '0' ? (
                  <Text style={styles.generateButtonPriceText}>{t('studio.free')}</Text>
                ) : (
                  <>
                    <Zap size={22} color="#000000" strokeWidth={2.5} fill="#000000" />
                    <Text style={styles.generateButtonPriceText}>{getTotalCost()}</Text>
                  </>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Floating Hide Keyboard Button */}
      {keyboardHeight > 0 && (
        <TouchableOpacity
          style={[styles.floatingKeyboardButton, { bottom: keyboardHeight + 12 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Keyboard.dismiss();
          }}
          activeOpacity={0.8}
        >
          <BlurView intensity={60} tint="dark" style={styles.glassButton}>
            <MaterialIcons name="keyboard-hide" size={22} color="#fff" />
          </BlurView>
        </TouchableOpacity>
      )}

      {/* Create / Edit Soul Modal */}
      <CreateSoulModal
        visible={showCreateSoulModal}
        editingSoul={editingSoul}
        onClose={() => {
          setShowCreateSoulModal(false);
          setEditingSoulId(null);
        }}
        onSave={async (name, imageUris) => {
          const soulId = await addSoul({ name, imageUris });
          return soulId;
        }}
      />

      {/* Settings Modal */}
      <LibrarySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Saved Prompts Modal */}
      <PromptBuilder
        visible={showPromptBuilder}
        onClose={() => setShowPromptBuilder(false)}
        currentPrompt={prompt}
        onApply={(savedPrompt) => {
          // Replace current prompt with selected saved prompt
          setPrompt(savedPrompt);
        }}
      />

      {/* Fullscreen Prompt Modal */}
      <Modal
        visible={showFullscreenPrompt}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFullscreenPrompt(false)}
      >
        <KeyboardAvoidingView
          style={styles.fullscreenPromptModal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.fullscreenPromptHeader}>
            <TouchableOpacity onPress={() => setShowFullscreenPrompt(false)}>
              <BlurView intensity={40} tint="dark" style={styles.fullscreenPromptHeaderClose}>
                <X size={18} color="#fff" />
              </BlurView>
            </TouchableOpacity>
            <Text style={styles.fullscreenPromptTitle}>{t('studio.editPrompt')}</Text>
            <View style={styles.fullscreenPromptHeaderSpacer} />
          </View>
          <TextInput
            style={styles.fullscreenPromptInput}
            placeholder={t('studio.promptPlaceholder')}
            placeholderTextColor="#6b7280"
            value={fullscreenPromptDraft}
            onChangeText={setFullscreenPromptDraft}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.fullscreenPromptFooter}>
            <TouchableOpacity
              style={styles.fullscreenPromptDoneButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPrompt(fullscreenPromptDraft);
                setShowFullscreenPrompt(false);
              }}
            >
              <Text style={styles.fullscreenPromptDoneButtonText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI Prompt Edit Modal */}
      <AIPromptEditModal
        visible={showAIPromptEdit}
        onClose={() => setShowAIPromptEdit(false)}
        currentPrompt={prompt}
        onApply={(newPrompt) => {
          setPrompt(newPrompt);
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  // === Container & Layout ===
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 130,
    paddingBottom: 200,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    marginTop: 12,
  },

  // === Header (translucent overlay, matches Home/Recipes) ===
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    color: '#fff',
    fontFamily: 'SFRounded-Regular',
    fontSize: 24,
    fontWeight: '400',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coinBalanceContainer: {
    minHeight: 36,
    justifyContent: 'center',
  },
  coinBalancePlaceholder: {
    width: 60,
    height: 36,
  },
  coinBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244, 213, 141, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  coinText: {
    color: '#F4D58D',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },
  clearFormButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },

  // === Sections & Cards ===
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginLeft: 4,
    marginBottom: 12,
  },
  filledIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F4D58D',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  label: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 6,
  },
  // === Prompt ===
  promptLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  promptBuilderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: 'rgba(244, 213, 141, 0.12)',
  },
  promptBuilderButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#F4D58D',
  },
  aiEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: 'rgba(167, 139, 250, 0.12)',
  },
  aiEditButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#a78bfa',
  },
  promptIconButton: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(156, 163, 175, 0.12)',
  },
  promptButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soulsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fullscreenPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
  },
  fullscreenPromptButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#60a5fa',
  },
  fullscreenPromptModal: {
    flex: 1,
    backgroundColor: '#111',
  },
  fullscreenPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  fullscreenPromptHeaderClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenPromptHeaderSpacer: {
    width: 36,
    height: 36,
  },
  fullscreenPromptTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  fullscreenPromptInput: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    lineHeight: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    textAlignVertical: 'top',
  },
  fullscreenPromptFooter: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 56 : 40,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  fullscreenPromptDoneButton: {
    backgroundColor: '#F4D58D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  fullscreenPromptDoneButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  floatingKeyboardButton: {
    position: 'absolute',
    right: 16,
    zIndex: 100,
  },
  glassButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sublabel: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },

  // === Tags ===
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  tagsContainerFlat: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tagsScroll: {
    marginBottom: 12,
  },
  tagsScrollContent: {
    gap: 8,
  },
  tagButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  tagButtonActive: {
    backgroundColor: '#F4D58D',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  tagTextActive: {
    color: '#111',
  },

  // === Models ===
  modelSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Matches modelOption dimensions so nothing jumps when real data lands.
  modelOptionSkeleton: {
    width: '48.5%',
    height: 44,
  },
  showMoreSkeleton: {
    width: 120,
    height: 16,
    alignSelf: 'center',
    marginTop: 16,
  },
  showMoreButton: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  showMoreButtonFlat: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
  },
  requestModelButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  requestModelText: {
    fontSize: 13,
    color: '#6b7280',
  },
  requestModelLink: {
    color: '#F4D58D',
    fontWeight: '600',
  },
  noModelsContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noModelsText: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  modelOption: {
    width: '48.5%',
    backgroundColor: '#333',
    borderRadius: 16,
    borderCurve: 'continuous',
    paddingVertical: 12,
    paddingHorizontal: 14,
    // overflow: 'visible' lets the NEW sticker corner outside the card.
    overflow: 'visible',
  },
  modelOptionActive: {
    // Softer than #F4D58D — sun-bleached pastel gold instead of full saturation.
    backgroundColor: '#F4D58D',
  },
  modelOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modelOptionText: {
    flex: 1,
  },
  modelOptionTitle: {
    fontSize: 13,
    color: '#fff',
    flex: 1,
  },
  modelOptionTitleActive: {
    color: '#111',
  },
  modelOptionCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#111',
    marginLeft: 8,
  },
  modelOptionCheckHidden: {
    backgroundColor: 'transparent',
  },
  // Same slot as the selected dot, but smaller and in soft gold — used when a
  // model is pinned but not selected, so the name text never gets shrunk.
  modelOptionCheckPinned: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F4D58D',
  },
  // Floating sticker pinned to the top-right corner of the model card. Slightly
  // overlaps the edge for a peeled-off look so it never crowds the name text.
  newSticker: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#F4D58D',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 4,
    transform: [{ rotate: '8deg' }],
  },
  newStickerText: {
    color: '#111',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  variantSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  variantOption: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    borderWidth: 2,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  variantOptionActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  variantOptionText: {
    flex: 1,
  },
  variantOptionTitle: {
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
    color: 'white',
    marginBottom: 2,
  },
  variantOptionTitleActive: {
    color: '#3b82f6',
  },
  variantOptionDescription: {
    fontSize: 11,
    fontFamily: 'Manrope-Regular',
    color: '#9ca3af',
    lineHeight: 14,
  },
  // === Image Input ===
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  addImageCard: {
    width: 120,
    height: 120,
    marginRight: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptInput: {
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  promptInputAutoGrow: {
    minHeight: 120,
  },
  promptInputActive: {
    // No active style - using dot indicator instead
  },
  imageList: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 8,
  },
  addImageText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
    textAlign: 'center',
  },
  imageContainer: {
    marginRight: 12,
    position: 'relative',
  },
  referenceImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#222',
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#ef4444',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageNumber: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageNumberText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyImagePicker: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 15,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#6b7280',
    marginTop: 4,
    fontSize: 13,
    textAlign: 'center',
  },
  // === Num Images ===
  numImagesHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  numImagesDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  numImagesScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  numImagesButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  numImageButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numImageButtonActive: {
    backgroundColor: '#F4D58D',
  },
  numImageText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
  },
  numImageTextActive: {
    color: '#111',
  },
  numImageButtonDisabled: {
    opacity: 0.4,
  },
  numImageTextDisabled: {
    color: '#4b5563',
  },
  settingsPreview: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  settingsPreviewTitle: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'Manrope-SemiBold',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  settingItem: {
    flex: 1,
    minWidth: 80,
  },
  settingItemLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: 'Manrope-SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  settingItemValue: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  infoText: {
    flex: 1,
    color: '#93c5fd',
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    lineHeight: 18,
  },
  // === Footer & Generate Button ===
  footer: {
    position: 'absolute',
    bottom: 90,
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

  // === Aspect Ratio ===
  aspectRatioHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  aspectRatioNote: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  aspectRatioScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  aspectRatioButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  aspectRatioButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aspectRatioButtonActive: {
    backgroundColor: '#F4D58D',
  },
  aspectRatioText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  aspectRatioTextActive: {
    color: '#111',
  },
});
