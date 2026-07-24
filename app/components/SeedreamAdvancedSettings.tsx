import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

interface SeedreamAdvancedSettingsProps {
  visible: boolean;
  onClose: () => void;
  disabled?: boolean;

  // Settings
  imageSize: '1K' | '2K' | '4K';
  setImageSize: (size: '1K' | '2K' | '4K') => void;

  sequentialGeneration: 'auto' | 'disabled';
  setSequentialGeneration: (value: 'auto' | 'disabled') => void;

  maxImages: number;
  setMaxImages: (value: number) => void;

  responseFormat: 'url' | 'b64_json';
  setResponseFormat: (value: 'url' | 'b64_json') => void;

  enableWatermark: boolean;
  setEnableWatermark: (value: boolean) => void;

  optimizePromptMode: 'standard' | 'fast';
  setOptimizePromptMode: (value: 'standard' | 'fast') => void;
}

export default function SeedreamAdvancedSettings(props: SeedreamAdvancedSettingsProps) {
  const {
    visible,
    onClose,
    disabled = false,
    imageSize,
    setImageSize,
    sequentialGeneration,
    setSequentialGeneration,
    maxImages,
    setMaxImages,
    responseFormat,
    setResponseFormat,
    enableWatermark,
    setEnableWatermark,
    optimizePromptMode,
    setOptimizePromptMode,
  } = props;

  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={onClose}
      >
        <Pressable style={styles.advancedSettingsModal} onPress={(e) => e.stopPropagation()}>
          <View style={styles.advancedSettingsModalHeader}>
            <Text style={styles.advancedSettingsModalTitle}>{t('modelParams.advancedSettings')}</Text>
            <Pressable onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onClose();
            }}>
              <Text style={styles.advancedSettingsModalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.advancedSettingsModalScroll}
            contentContainerStyle={styles.advancedSettingsModalScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Size Selector */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('modelParams.outputImageSize')}</Text>
                <Text style={styles.settingDescription}>{t('modelParams.outputImageSizeHint')}</Text>
              </View>
              <View style={styles.sizeButtons}>
                {(['1K', '2K', '4K'] as const).map((size) => (
                  <Pressable
                    key={size}
                    style={[
                      styles.sizeButtonCompact,
                      imageSize === size && styles.sizeButtonActive,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setImageSize(size);
                    }}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.sizeButtonText,
                        imageSize === size && styles.sizeButtonTextActive,
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Sequential Generation */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('modelParams.sequentialGeneration')}</Text>
                <Text style={styles.settingDescription}>{t('modelParams.sequentialGenerationHint')}</Text>
              </View>
              <Switch
                value={sequentialGeneration === 'auto'}
                onValueChange={(value) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSequentialGeneration(value ? 'auto' : 'disabled');
                }}
                disabled={disabled}
                trackColor={{ false: '#555', true: '#FFD700' }}
                thumbColor="#fff"
              />
            </View>

            {sequentialGeneration === 'auto' && (
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{t('modelParams.maxImagesValue', { value: maxImages })}</Text>
                  <Text style={styles.settingDescription}>{t('modelParams.maxImagesHint')}</Text>
                </View>
                <View style={styles.numberInputContainer}>
                  <Pressable
                    style={styles.numberButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMaxImages(Math.max(1, maxImages - 1));
                    }}
                    disabled={disabled || maxImages <= 1}
                  >
                    <Text style={styles.numberButtonText}>−</Text>
                  </Pressable>
                  <Text style={styles.numberDisplay}>{maxImages}</Text>
                  <Pressable
                    style={styles.numberButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMaxImages(Math.min(15, maxImages + 1));
                    }}
                    disabled={disabled || maxImages >= 15}
                  >
                    <Text style={styles.numberButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Response Format */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('modelParams.responseFormat')}</Text>
                <Text style={styles.settingDescription}>{t('modelParams.responseFormatHint')}</Text>
              </View>
              <View style={styles.toggleButtonGroup}>
                <Pressable
                  style={[
                    styles.toggleButton,
                    responseFormat === 'url' && styles.toggleButtonActive,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setResponseFormat('url');
                  }}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.toggleButtonText,
                      responseFormat === 'url' && styles.toggleButtonTextActive,
                    ]}
                  >
                    {t('modelParams.responseFormatUrl')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.toggleButton,
                    responseFormat === 'b64_json' && styles.toggleButtonActive,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setResponseFormat('b64_json');
                  }}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.toggleButtonText,
                      responseFormat === 'b64_json' && styles.toggleButtonTextActive,
                    ]}
                  >
                    {t('modelParams.responseFormatBase64')}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Watermark */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('modelParams.addWatermark')}</Text>
                <Text style={styles.settingDescription}>{t('modelParams.addWatermarkHint')}</Text>
              </View>
              <Switch
                value={enableWatermark}
                onValueChange={(value) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setEnableWatermark(value);
                }}
                disabled={disabled}
                trackColor={{ false: '#555', true: '#FFD700' }}
                thumbColor="#fff"
              />
            </View>

            {/* Prompt Optimization */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('modelParams.promptOptimization')}</Text>
                <Text style={styles.settingDescription}>{t('modelParams.promptOptimizationHint')}</Text>
              </View>
              <View style={styles.toggleButtonGroup}>
                <Pressable
                  style={[
                    styles.toggleButton,
                    optimizePromptMode === 'standard' && styles.toggleButtonActive,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setOptimizePromptMode('standard');
                  }}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.toggleButtonText,
                      optimizePromptMode === 'standard' && styles.toggleButtonTextActive,
                    ]}
                  >
                    {t('modelParams.promptOptimizationQuality')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.toggleButton,
                    optimizePromptMode === 'fast' && styles.toggleButtonActive,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setOptimizePromptMode('fast');
                  }}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.toggleButtonText,
                      optimizePromptMode === 'fast' && styles.toggleButtonTextActive,
                    ]}
                  >
                    {t('modelParams.promptOptimizationSpeed')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  advancedSettingsModal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  advancedSettingsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  advancedSettingsModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  advancedSettingsModalClose: {
    fontSize: 24,
    color: '#999',
  },
  advancedSettingsModalScroll: {
    maxHeight: 500,
  },
  advancedSettingsModalScrollContent: {
    paddingBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  settingLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingDescription: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sizeButtonCompact: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 50,
    alignItems: 'center',
  },
  sizeButtonActive: {
    backgroundColor: '#007AFF',
  },
  sizeButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  sizeButtonTextActive: {
    color: '#fff',
  },
  toggleButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 80,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
  },
  toggleButtonText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: '#fff',
  },
  numberInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  numberButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  numberDisplay: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'center',
  },
});
