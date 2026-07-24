import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
} from 'react-native';
import { BlurView } from 'expo-blur';
import { calculateVideoCoinCostAsync, calculateVideoPriceInCentsAsync } from '../../lib/pricing';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Zap, ImagePlus } from 'lucide-react-native';
import DynamicModelForm, { getDefaultValuesFromSchema } from '../components/DynamicModelForm';
import { useReplicateModel } from '../hooks/useReplicateModel';
import { useReplicateBalance } from '../hooks/useReplicateBalance';
import { useSettings } from '../../contexts/SettingsContext';
import { useApiKeyModal } from '../../contexts/ApiKeyModalContext';
import { useAuth } from '../../contexts/AuthModalContext';

import { useBalance } from '../../contexts/BalanceContext';
import { useVideoModels } from '../hooks/useCloudModels';
import { CloudModel } from '../../lib/cloudModels';
import CoinBalance from '../components/CoinBalance';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { ensureAIConsent } from '../../lib/ai/aiConsent';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';

export default function VideoScreen() {
  const { t } = useTranslation();
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
  const { models: allVideoModels, isLoading: modelsLoading, error: modelsError } = useVideoModels();

  // Get API provider setting (admin-only, default: fal)
  const { apiProvider } = useSettings();

  // Filter models based on API provider
  // Fal models end with '-fal', Replicate models don't
  const videoModels = useMemo(() => {
    if (apiProvider === 'fal') {
      // Show only Fal models (ending with -fal)
      return allVideoModels.filter(m => m.slug.endsWith('-fal'));
    } else {
      // Show only Replicate models (not ending with -fal)
      return allVideoModels.filter(m => !m.slug.endsWith('-fal'));
    }
  }, [allVideoModels, apiProvider]);

  // Extract unique tags from video models
  const allTags = useMemo(() => {
    const tagSet = new Set<string>(['all']);
    videoModels.forEach(model => {
      model.tags.forEach(tag => {
        // Only include relevant video tags
        if (tag !== 'video') tagSet.add(tag);
      });
    });
    return Array.from(tagSet);
  }, [videoModels]);

  // Tag filtering - default to 'all'
  const [selectedTags, setSelectedTags] = useState<string[]>(['all']);

  // Model selection - single model for video
  const [selectedModelSlug, setSelectedModelSlug] = useState<string | null>(null);

  // Model-specific form values
  const [modelFormValues, setModelFormValues] = useState<Record<string, any>>({});

  // Text prompt
  const [prompt, setPrompt] = useState('');
  const [promptInputHeight, setPromptInputHeight] = useState(140);

  // First frame image
  const [firstFrameImage, setFirstFrameImage] = useState<string | null>(null);
  const [isFirstFrameProcessing, setIsFirstFrameProcessing] = useState(false);
  const [isLastFrameProcessing, setIsLastFrameProcessing] = useState(false);

  // Last frame image (for first-to-last frame models)
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(null);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Button cooldown
  const [isButtonCooldown, setIsButtonCooldown] = useState(false);

  // Balance display - auto-updates via realtime
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();
  const { hasCustomKey: hasCustomApiKey } = useBalance();
  const { checkCanGenerate } = useApiKeyModal();
  const { requireSession } = useAuth();

  // Generation hook
  const { generate: generateModel } = useReplicateModel();

  // Get selected model
  const selectedModel = useMemo(() => {
    if (!selectedModelSlug) return null;
    return videoModels.find(m => m.slug === selectedModelSlug) || null;
  }, [selectedModelSlug, videoModels]);

  // Filter models by selected tags
  const filteredModels = useMemo(() => {
    if (selectedTags.includes('all')) {
      return videoModels;
    }
    return videoModels.filter(model =>
      selectedTags.some(tag => model.tags.includes(tag))
    );
  }, [videoModels, selectedTags]);

  // Dynamic pricing state
  const [estimatedCost, setEstimatedCost] = useState<string>('0');

  // Extract duration from form values or param schema default
  const getDurationSeconds = useCallback((): number => {
    if (!selectedModel?.paramSchema?.duration) return 5; // Default

    const durationParam = selectedModel.paramSchema.duration;
    let durationValue = modelFormValues.duration ?? durationParam.default;

    // Handle different formats: "5", "8s", 5
    if (typeof durationValue === 'string') {
      // Remove 's' suffix if present (e.g., "8s" -> "8")
      durationValue = durationValue.replace(/s$/, '');
      return parseInt(durationValue, 10) || 5;
    }
    return durationValue || 5;
  }, [selectedModel, modelFormValues.duration]);

  // Extract audio state from form values (for models that support audio generation)
  const getAudioEnabled = useCallback((): boolean => {
    // Check if model has generate_audio in param_schema
    if (!selectedModel?.paramSchema?.generate_audio) return false;
    // Return the form value, defaulting to the schema default
    return modelFormValues.generate_audio ?? selectedModel.paramSchema.generate_audio.default ?? false;
  }, [selectedModel, modelFormValues.generate_audio]);

  // Calculate cost when model, duration, or audio changes
  useEffect(() => {
    const calculateCost = async () => {
      if (!selectedModel) {
        setEstimatedCost('0');
        return;
      }

      const duration = getDurationSeconds();
      const withAudio = getAudioEnabled();

      try {
        if (hasCustomApiKey) {
          const cents = await calculateVideoPriceInCentsAsync(selectedModel.slug, duration, withAudio);
          setEstimatedCost(`$${(cents / 100).toFixed(2)}`);
        } else {
          const coins = await calculateVideoCoinCostAsync(selectedModel.slug, duration, withAudio);
          setEstimatedCost(String(coins));
        }
      } catch (error) {
        console.warn('Error calculating video price:', error);
        // Fall back to static pricing
        const coins = selectedModel.costCoins;
        setEstimatedCost(hasCustomApiKey ? `$${(coins / 500).toFixed(2)}` : String(coins));
      }
    };

    calculateCost();
  }, [selectedModel, modelFormValues.duration, modelFormValues.generate_audio, hasCustomApiKey, getDurationSeconds, getAudioEnabled]);

  // Pick first frame image
  const pickFirstFrameImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!(await ensureAIConsent())) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(t('video.permissionRequiredTitle'), t('video.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsFirstFrameProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsFirstFrameProcessing(false);
      }
      setFirstFrameImage(uri);
    }
  };

  // Pick last frame image
  const pickLastFrameImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!(await ensureAIConsent())) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(t('video.permissionRequiredTitle'), t('video.permissionRequiredMessage'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setIsLastFrameProcessing(true);
      try {
        await ensureAssetsLocal([uri]);
      } finally {
        setIsLastFrameProcessing(false);
      }
      setLastFrameImage(uri);
    }
  };

  // Handle model selection
  const selectModel = (modelSlug: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModelSlug(modelSlug);

    // Initialize form values with defaults from param_schema
    const model = videoModels.find(m => m.slug === modelSlug);
    if (model?.paramSchema) {
      const defaults = getDefaultValuesFromSchema(model.paramSchema);
      setModelFormValues(defaults);
    }
  };

  // Update form value
  const updateFormValue = (key: string, value: any) => {
    setModelFormValues(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  // Handle generate
  const handleGenerate = async () => {
    // Registration is optional — just ensure a session (guests can generate).
    requireSession();

    // For API variant, check if user has API key (show modal if not)
    if (!checkCanGenerate()) {
      return;
    }

    if (!selectedModel) {
      Alert.alert(t('video.noModelTitle'), t('video.noModelMessage'));
      return;
    }

    if (!prompt.trim()) {
      Alert.alert(t('video.noPromptTitle'), t('video.noPromptMessage'));
      return;
    }

    // Check if first frame is required
    if (requiresFirstFrame && !firstFrameImage) {
      Alert.alert(t('video.startFrameRequiredTitle'), t('video.startFrameRequiredMessage'));
      return;
    }

    // Activate cooldown
    setIsButtonCooldown(true);
    setTimeout(() => setIsButtonCooldown(false), 1500);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();

    // Build options from form values
    const options: Record<string, any> = {
      ...modelFormValues,
    };

    // Pass frame images if provided (first frame, then last frame if available)
    const inputImages: string[] = [];
    if (firstFrameImage) {
      inputImages.push(firstFrameImage);
      if (lastFrameImage) {
        inputImages.push(lastFrameImage);
      }
    }

    try {
      await generateModel(selectedModel.slug, prompt, inputImages, options);
    } catch (error: any) {
      console.error('Video generation error:', error);
      Alert.alert(t('video.errorTitle'), error.message || t('video.generationFailed'));
    }
  };

  // Clear form
  const handleClearForm = () => {
    setPrompt('');
    setFirstFrameImage(null);
    setLastFrameImage(null);
    setModelFormValues({});
  };

  // Toggle tag selection
  const toggleTag = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        setSelectedModelSlug(null);
        return ['all'];
      } else {
        setSelectedModelSlug(null);
        return [tag];
      }
    });
  };

  // Check if model supports first frame image
  const supportsFirstFrame = selectedModel
    ? (selectedModel.referenceImagesMax || 0) > 0
    : false;

  // Check if model supports last frame image (for first-to-last frame models like Kling O1)
  const supportsLastFrame = selectedModel
    ? (selectedModel.referenceImagesMax || 0) >= 2
    : false;

  // Check if model requires first frame (referenceImagesMin >= 1)
  const requiresFirstFrame = selectedModel
    ? (selectedModel.referenceImagesMin || 0) >= 1
    : false;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            {t('common.create')}{' '}
            <Text style={styles.headerModelName}>
              {selectedModel ? selectedModel.name : t('video.video')}
            </Text>
          </Text>
        </View>
        <View style={styles.headerRight}>
          <CoinBalance
            balance={balanceInfo.isLoading ? null : balanceInfo.displayText}
            onPress={() => setShowSettings(true)}
            iconType="asterisk"
            isPremium={subscriptionStatus.isSubscribed}
          />
          {(prompt || firstFrameImage || lastFrameImage) && (
            <TouchableOpacity
              style={styles.clearFormButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                handleClearForm();
              }}
            >
              <MaterialIcons name="clear" size={20} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Loading State */}
        {modelsLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FFD700" />
            <Text style={styles.loadingText}>{t('video.loadingModels')}</Text>
          </View>
        )}

        {/* Model Selector with Tags */}
        {!modelsLoading && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('video.model')}</Text>
            {/* Tags - horizontal scroll */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagsScrollContent}
              style={styles.tagsScroll}
            >
              {allTags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[
                    styles.tagButton,
                    selectedTags.includes(tag) && styles.tagButtonActive,
                  ]}
                  onPress={() => toggleTag(tag)}
                >
                  <Text
                    style={[
                      styles.tagText,
                      selectedTags.includes(tag) && styles.tagTextActive,
                    ]}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Models grid */}
            {filteredModels.length === 0 ? (
              <View style={styles.noModelsContainer}>
                <Text style={styles.noModelsText}>
                  {apiProvider === 'fal'
                    ? t('video.noFalModels')
                    : t('video.noReplicateModels')}
                </Text>
              </View>
            ) : (
              <View style={styles.modelSelector}>
                {filteredModels.map((model) => {
                  const isSelected = selectedModelSlug === model.slug;

                  return (
                    <TouchableOpacity
                      key={model.slug}
                      style={[
                        styles.modelOption,
                        isSelected && styles.modelOptionActive,
                      ]}
                      onPress={() => selectModel(model.slug)}
                    >
                      <View style={styles.modelOptionContent}>
                        <View style={styles.modelOptionText}>
                          <View style={styles.modelTitleRow}>
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
                            {model.isNew && (
                              <View style={styles.newBadge}>
                                <Text style={styles.newBadgeText}>{t('video.newBadge')}</Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <View style={[
                          styles.modelOptionCheck,
                          !isSelected && styles.modelOptionCheckHidden,
                        ]} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Prompt Input */}
        {!modelsLoading && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{t('video.prompt')}</Text>
                {prompt.trim().length > 0 && <View style={styles.filledIndicator} />}
              </View>
              <View style={styles.promptButtonsRow}>
                {prompt.trim().length > 0 && (
                  <TouchableOpacity
                    style={styles.promptClearButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPrompt('');
                    }}
                  >
                    <MaterialIcons name="clear" size={14} color="#9ca3af" />
                    <Text style={styles.promptClearButtonText}>{t('video.clear')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.card}>
              <TextInput
                style={styles.promptInput}
                placeholder={t('video.promptPlaceholder')}
                placeholderTextColor="#6b7280"
                value={prompt}
                onChangeText={setPrompt}
                multiline
                textAlignVertical="top"
              />
            </View>
          </View>
        )}

        {/* Start Frame Image Input */}
        {!modelsLoading && supportsFirstFrame && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {supportsLastFrame ? t('video.startFrame') : t('video.firstFrame')} {requiresFirstFrame ? t('video.requiredSuffix') : t('video.optionalSuffix')}
            </Text>
            <View style={styles.card}>
              {isFirstFrameProcessing ? (
                <View style={styles.emptyImagePicker}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.emptyText}>{t('video.processing')}</Text>
                </View>
              ) : firstFrameImage ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: firstFrameImage }} style={styles.imagePreview} />
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setFirstFrameImage(null);
                    }}
                  >
                    <MaterialIcons name="close" size={16} color="white" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.emptyImagePicker}
                  onPress={pickFirstFrameImage}
                >
                  <ImagePlus size={32} color="#6b7280" strokeWidth={1.5} />
                  <Text style={styles.emptyText}>
                    {supportsLastFrame ? t('video.addStartFrame') : t('video.addFirstFrame')}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {supportsLastFrame
                      ? t('video.startFrameHint')
                      : t('video.firstFrameHint')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Last Frame Image Input (for first-to-last frame models) */}
        {!modelsLoading && supportsLastFrame && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('video.endFrameOptional')}</Text>
            <View style={styles.card}>
              {isLastFrameProcessing ? (
                <View style={styles.emptyImagePicker}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.emptyText}>{t('video.processing')}</Text>
                </View>
              ) : lastFrameImage ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: lastFrameImage }} style={styles.imagePreview} />
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setLastFrameImage(null);
                    }}
                  >
                    <MaterialIcons name="close" size={16} color="white" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.emptyImagePicker}
                  onPress={pickLastFrameImage}
                >
                  <ImagePlus size={32} color="#6b7280" strokeWidth={1.5} />
                  <Text style={styles.emptyText}>{t('video.addEndFrame')}</Text>
                  <Text style={styles.emptySubtext}>{t('video.endFrameHint')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Dynamic Model Options */}
        {!modelsLoading && selectedModel && selectedModel.paramSchema && (() => {
          // Filter out hidden fields
          const hiddenFields = [
            'negative_prompt',  // Usually has good defaults
            'cfg_scale',        // Advanced setting
          ];
          const filteredSchema = Object.fromEntries(
            Object.entries(selectedModel.paramSchema).filter(([key]) => !hiddenFields.includes(key))
          );

          return Object.keys(filteredSchema).length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('video.videoOptions')}</Text>
              <View style={styles.card}>
                <DynamicModelForm
                  schema={filteredSchema}
                  values={modelFormValues}
                  onChange={updateFormValue}
                  referenceImagesCount={firstFrameImage ? 1 : 0}
                />
              </View>
            </View>
          ) : null;
        })()}
      </ScrollView>

      {/* Generate Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.generateButton,
            (isButtonCooldown || !selectedModel || !prompt.trim() || (requiresFirstFrame && !firstFrameImage)) && styles.generateButtonDisabled,
          ]}
          onPress={handleGenerate}
          disabled={isButtonCooldown || !selectedModel || !prompt.trim() || (requiresFirstFrame && !firstFrameImage)}
        >
          <View style={styles.generateButtonContent}>
            <Text style={styles.generateButtonText}>
              {isButtonCooldown
                ? t('video.startedCheckLibrary')
                : !selectedModel
                ? t('video.selectModel')
                : !prompt.trim()
                ? t('video.enterPrompt')
                : (requiresFirstFrame && !firstFrameImage)
                ? t('video.addStartFrameButton')
                : t('video.generateVideo')}
            </Text>
            {selectedModel && !isButtonCooldown && (
              <View style={styles.generateButtonPrice}>
                <Zap size={18} color="#000000" strokeWidth={2.5} fill="#000000" />
                <Text style={styles.generateButtonPriceText}>{estimatedCost}</Text>
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

      {/* Settings Modal */}
      <LibrarySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
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

  // === Header ===
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 70,
    paddingBottom: 12,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerModelName: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  promptButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  promptClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(156, 163, 175, 0.12)',
  },
  promptClearButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  filledIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFD700',
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

  // === Tags ===
  tagsScroll: {
    marginBottom: 12,
  },
  tagsScrollContent: {
    gap: 8,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  tagButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  tagButtonActive: {
    backgroundColor: '#FFD700',
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
  modelSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modelOption: {
    width: '48.5%',
    backgroundColor: '#333',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  modelOptionActive: {
    backgroundColor: '#FFD700',
  },
  modelOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modelOptionText: {
    flex: 1,
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelOptionTitle: {
    fontSize: 13,
    color: '#fff',
    flex: 1,
  },
  modelOptionTitleActive: {
    color: '#111',
  },
  newBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFD700',
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

  // === Prompt Input ===
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  promptInput: {
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },

  // === First Frame Image ===
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
  imagePreviewContainer: {
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    backgroundColor: '#222',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#ef4444',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
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
    borderRadius: 12,
    padding: 16,
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
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: '600',
  },
});
