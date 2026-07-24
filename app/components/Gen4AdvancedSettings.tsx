import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

interface Gen4AdvancedSettingsProps {
  visible: boolean;
  onClose: () => void;
  disabled?: boolean;

  // Settings
  resolution: '720p' | '1080p';
  setResolution: (value: '720p' | '1080p') => void;

  aspectRatio: '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '21:9';
  setAspectRatio: (value: '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '21:9') => void;
}

export default function Gen4AdvancedSettings(props: Gen4AdvancedSettingsProps) {
  const { t } = useTranslation();
  const {
    visible,
    onClose,
    disabled = false,
    resolution,
    setResolution,
    aspectRatio,
    setAspectRatio,
  } = props;

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
            <Text style={styles.advancedSettingsModalTitle}>{t('gen4.title')}</Text>
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
            {/* Resolution Selector */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('gen4.resolution')}</Text>
                <Text style={styles.settingDescription}>
                  {t('gen4.resolutionHint')}
                </Text>
              </View>
              <View style={styles.sizeButtons}>
                {(['720p', '1080p'] as const).map((res) => (
                  <Pressable
                    key={res}
                    style={[
                      styles.sizeButtonCompact,
                      resolution === res && styles.sizeButtonActive,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setResolution(res);
                    }}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.sizeButtonText,
                        resolution === res && styles.sizeButtonTextActive,
                      ]}
                    >
                      {res}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Aspect Ratio Selector */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('gen4.aspectRatio')}</Text>
                <Text style={styles.settingDescription}>
                  {t('gen4.aspectRatioHint')}
                </Text>
              </View>
              <View style={styles.aspectRatioGrid}>
                {(['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'] as const).map((ratio) => (
                  <Pressable
                    key={ratio}
                    style={[
                      styles.aspectRatioButton,
                      aspectRatio === ratio && styles.aspectRatioButtonActive,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setAspectRatio(ratio);
                    }}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.aspectRatioButtonText,
                        aspectRatio === ratio && styles.aspectRatioButtonTextActive,
                      ]}
                    >
                      {ratio}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Info Box */}
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                <Text style={styles.infoTextBold}>{t('gen4.tipLabel')}</Text> {t('gen4.tipBody')}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.advancedSettingsModalFooter}>
            <Pressable
              style={styles.doneButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
            >
              <Text style={styles.doneButtonText}>{t('common.done')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  advancedSettingsModal: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  advancedSettingsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  advancedSettingsModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  advancedSettingsModalClose: {
    fontSize: 24,
    color: '#9ca3af',
    paddingHorizontal: 8,
  },
  advancedSettingsModalScroll: {
    maxHeight: 500,
  },
  advancedSettingsModalScrollContent: {
    padding: 20,
    gap: 24,
  },
  settingRow: {
    gap: 12,
  },
  settingInfo: {
    gap: 4,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  settingDescription: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sizeButtonCompact: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
  },
  sizeButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: '#3b82f6',
  },
  sizeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  sizeButtonTextActive: {
    color: '#3b82f6',
  },
  aspectRatioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  aspectRatioButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#334155',
    minWidth: 80,
    alignItems: 'center',
  },
  aspectRatioButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: '#3b82f6',
  },
  aspectRatioButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  aspectRatioButtonTextActive: {
    color: '#3b82f6',
  },
  infoBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  infoText: {
    fontSize: 13,
    color: '#93c5fd',
    lineHeight: 18,
  },
  infoTextBold: {
    fontWeight: '700',
    color: '#60a5fa',
  },
  advancedSettingsModalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  doneButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  doneButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
