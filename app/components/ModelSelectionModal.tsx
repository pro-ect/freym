import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable, TextInput, ScrollView, Modal, StyleSheet, Switch } from 'react-native';
import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { ModelCard } from './ModelCard';
import { getCustomModels } from '../../lib/customModels';
import type { CustomModel } from '../../lib/customModels/types';
import * as Haptics from 'expo-haptics';

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  capabilities: string[];
  maxTokens: number;
  pricePerToken: number;
  icon?: string;
  color?: string;
  recommended?: boolean;
  speed: 'fast' | 'medium' | 'slow';
  quality: 'high' | 'medium' | 'low';
  api: 'replicate' | 'seedream' | 'fal';
  isCustom?: boolean; // Flag to identify custom models
  customModelData?: CustomModel; // Store full custom model data
}

interface ModelSelectionProps {
  visible: boolean;
  onClose: () => void;
  models: AIModel[];
  onModelSelect?: (model: AIModel) => void;
  onModelsSelect?: (models: AIModel[]) => void;
  initialSelectedId?: string;
  initialSelectedIds?: string[];
  multiSelect?: boolean;
}

/**
 * Convert CustomModel to AIModel format for display in selection modal
 */
function convertCustomModelToAIModel(customModel: CustomModel): AIModel {
  // Extract owner from replicate_model (e.g., "owner/name" -> "owner")
  const owner = customModel.replicate_model.split('/')[0] || 'Custom';

  // Generate a simple color based on the first letter of the name
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
  const colorIndex = customModel.name.charCodeAt(0) % colors.length;

  return {
    id: `custom_${customModel.id}`, // Prefix to avoid ID collisions
    name: customModel.name,
    provider: owner,
    description: customModel.description || `Custom model: ${customModel.replicate_model}`,
    capabilities: [], // Derived from schema if needed
    maxTokens: 0, // Not applicable for custom models
    pricePerToken: 0, // Using coins instead
    icon: customModel.name[0]?.toUpperCase() || 'C',
    color: colors[colorIndex],
    recommended: false,
    speed: 'medium',
    quality: 'medium',
    api: 'replicate',
    isCustom: true,
    customModelData: customModel,
  };
}

export const ModelSelectionModal: React.FC<ModelSelectionProps> = ({
  visible,
  onClose,
  models,
  onModelSelect,
  onModelsSelect,
  initialSelectedId,
  initialSelectedIds,
  multiSelect = false,
}) => {
  const { t } = useTranslation();
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(
    () => models.find(m => m.id === initialSelectedId) || null
  );
  const [selectedModels, setSelectedModels] = useState<AIModel[]>(
    () => initialSelectedIds ? models.filter(m => initialSelectedIds.includes(m.id)) : []
  );
  const [isMultiSelectMode, setIsMultiSelectMode] = useState<boolean>(multiSelect);
  const [customModels, setCustomModels] = useState<AIModel[]>([]);

  // Load custom models when modal becomes visible
  useEffect(() => {
    if (visible) {
      loadCustomModels();
    }
  }, [visible]);

  const loadCustomModels = async () => {
    try {
      const models = await getCustomModels();
      const convertedModels = models.map(convertCustomModelToAIModel);
      setCustomModels(convertedModels);
    } catch (error) {
      console.error('Error loading custom models:', error);
      setCustomModels([]);
    }
  };

  // Merge built-in models with custom models
  const allModels = useMemo(() => {
    return [...models, ...customModels];
  }, [models, customModels]);

  const handleModelSelect = (model: AIModel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (isMultiSelectMode) {
      // Toggle model in selection
      setSelectedModels(prev => {
        const isSelected = prev.some(m => m.id === model.id);
        if (isSelected) {
          return prev.filter(m => m.id !== model.id);
        } else {
          return [...prev, model];
        }
      });
    } else {
      // Single select mode - select and close immediately
      setSelectedModel(model);
      onModelsSelect?.([model]); // Pass as array for consistency
      onClose();
    }
  };

  const handleConfirmMultiSelect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isMultiSelectMode && onModelsSelect) {
      onModelsSelect(selectedModels);
      onClose();
    }
  };

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
            <View style={styles.modelSelection}>
              {/* Close button */}
              <Pressable
                style={styles.closeButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onClose();
                }}
                hitSlop={12}
                accessibilityLabel="Close model selection"
              >
                <X size={20} color="#fff" strokeWidth={1.5} />
              </Pressable>

              {/* Header */}
              <View style={styles.modelSelectionHeader}>
                {/* Toggle for multi-select mode */}
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>{t('modelSelect.useSeveralModels')}</Text>
                  <Switch
                    value={isMultiSelectMode}
                    onValueChange={setIsMultiSelectMode}
                    trackColor={{ false: 'rgba(255, 255, 255, 0.2)', true: '#FFD700' }}
                    thumbColor={isMultiSelectMode ? '#000000' : '#f4f3f4'}
                  />
                </View>
              </View>

              {/* Model Grid */}
              <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                {/* Built-in Models */}
                {models.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.modelSelectionGrid}>
                      {models.map((model) => (
                        <ModelCard
                          key={model.id}
                          model={model}
                          isSelected={
                            isMultiSelectMode
                              ? selectedModels.some(m => m.id === model.id)
                              : selectedModel?.id === model.id
                          }
                          onSelect={handleModelSelect}
                        />
                      ))}
                    </View>
                  </View>
                )}

                {/* Custom Models */}
                {customModels.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('modelSelect.yourCustomModels')}</Text>
                    <View style={styles.modelSelectionGrid}>
                      {customModels.map((model) => (
                        <ModelCard
                          key={model.id}
                          model={model}
                          isSelected={
                            isMultiSelectMode
                              ? selectedModels.some(m => m.id === model.id)
                              : selectedModel?.id === model.id
                          }
                          onSelect={handleModelSelect}
                        />
                      ))}
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* Confirm button for multi-select */}
              {isMultiSelectMode && (
                <View style={styles.confirmButtonContainer}>
                  <Pressable
                    style={[
                      styles.confirmButton,
                      selectedModels.length === 0 && styles.confirmButtonDisabled
                    ]}
                    onPress={handleConfirmMultiSelect}
                    disabled={selectedModels.length === 0}
                  >
                    <Text style={styles.confirmButtonText}>
                      {selectedModels.length > 0
                        ? t('modelSelect.confirmWithCount', { n: selectedModels.length })
                        : t('modelSelect.confirm')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
      </BlurView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
  },
  darkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalOverlayPressable: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'transparent',
    borderRadius: 16,
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
  },
  modelSelection: {
    padding: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modelSelectionHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
    paddingLeft: 4,
    paddingRight: 48,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
    color: '#ffffff',
  },
  modelSelectionTitle: {
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    color: '#ffffff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  scrollView: {
    maxHeight: 500,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  modelSelectionGrid: {
    gap: 8,
  },
  confirmButtonContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  confirmButton: {
    backgroundColor: '#FFD700',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: 'rgba(255, 215, 0, 0.3)',
  },
  confirmButtonText: {
    color: '#000000',
    fontSize: 15,
    fontFamily: 'Manrope-SemiBold',
  },
});
