import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Sparkles, Send, ChevronDown, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAIPromptEdit } from '../hooks/useAIPromptEdit';

// This should match the SYSTEM_PROMPT in supabase/functions/ai-prompt-edit/prompts.ts
const CURRENT_SYSTEM_PROMPT = `empty`;

interface AIPromptEditModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  currentPrompt: string;
}

export default function AIPromptEditModal({
  visible,
  onClose,
  onApply,
  currentPrompt,
}: AIPromptEditModalProps) {
  const [instruction, setInstruction] = useState('');
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { editPrompt, isLoading, error, streamingText, reset } = useAIPromptEdit();

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setInstruction('');
      reset();
      // Trigger autoFocus after a short delay
      setShouldAutoFocus(false);
      setTimeout(() => {
        setShouldAutoFocus(true);
      }, 300);
    }
  }, [visible, reset]);

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim()) {
      Alert.alert(t('common.error'), t('promptEdit.enterChangeError'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();

    try {
      await editPrompt(currentPrompt, instruction.trim());
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('promptEdit.editFailed'));
    }
  }, [instruction, currentPrompt, editPrompt]);

  const handleApply = useCallback(() => {
    if (streamingText) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onApply(streamingText);
      onClose();
    }
  }, [streamingText, onApply, onClose]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const placeholderText = currentPrompt.trim()
    ? t('promptEdit.placeholderEdit')
    : t('promptEdit.placeholderCreate');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <BlurView intensity={90} tint="dark" style={styles.blurContainer}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
              <TouchableOpacity onPress={handleClose}>
                <BlurView intensity={40} tint="dark" style={styles.glassButton}>
                  <X size={18} color="#fff" />
                </BlurView>
              </TouchableOpacity>
              <View style={styles.titleRow}>
                <Sparkles size={18} color="#a78bfa" />
                <Text style={styles.title}>{t('promptEdit.title')}</Text>
              </View>
              <View style={styles.headerSpacer} />
            </View>

            {/* Content */}
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              {/* System prompt toggle */}
              <TouchableOpacity
                style={styles.systemPromptToggle}
                onPress={() => setShowSystemPrompt(!showSystemPrompt)}
              >
                <Text style={styles.systemPromptToggleText}>{t('promptEdit.systemPrompt')}</Text>
                {showSystemPrompt ? (
                  <ChevronUp size={16} color="#6b7280" />
                ) : (
                  <ChevronDown size={16} color="#6b7280" />
                )}
              </TouchableOpacity>
              {showSystemPrompt && (
                <View style={styles.systemPromptCard}>
                  <Text style={styles.systemPromptText}>{CURRENT_SYSTEM_PROMPT}</Text>
                </View>
              )}

              {/* Current prompt preview */}
              {currentPrompt.trim() ? (
                <View style={styles.currentPromptSection}>
                  <Text style={styles.sectionLabel}>{t('promptEdit.currentPrompt')}</Text>
                  <View style={styles.currentPromptCard}>
                    <Text style={styles.currentPromptText} numberOfLines={3}>
                      {currentPrompt}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.emptyPromptSection}>
                  <Text style={styles.emptyPromptText}>
                    {t('promptEdit.noPromptYet')}
                  </Text>
                </View>
              )}

              {/* Input section */}
              <View style={styles.inputSection}>
                <Text style={styles.sectionLabel}>
                  {currentPrompt.trim() ? t('promptEdit.whatToChange') : t('promptEdit.describeImage')}
                </Text>
                <View style={styles.inputContainer}>
                  <TextInput
                    key={shouldAutoFocus ? 'focused' : 'unfocused'}
                    style={styles.input}
                    placeholder={placeholderText}
                    placeholderTextColor="#6b7280"
                    value={instruction}
                    onChangeText={setInstruction}
                    multiline
                    textAlignVertical="top"
                    editable={!isLoading}
                    autoFocus={shouldAutoFocus}
                  />
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      (!instruction.trim() || isLoading) && styles.sendButtonDisabled,
                    ]}
                    onPress={handleSubmit}
                    disabled={!instruction.trim() || isLoading}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Send size={18} color="#fff" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Result section */}
              {(isLoading || streamingText) && (
                <View style={styles.resultSection}>
                  <Text style={styles.sectionLabel}>
                    {isLoading ? t('promptEdit.generating') : t('promptEdit.newPrompt')}
                  </Text>
                  <View style={styles.resultCard}>
                    {streamingText ? (
                      <Text style={styles.resultText}>{streamingText}</Text>
                    ) : (
                      <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color="#a78bfa" />
                        <Text style={styles.loadingText}>{t('promptEdit.thinking')}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorCard}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Footer with Apply button */}
            {streamingText && !isLoading && (
              <View style={styles.footer}>
                <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
                  <Sparkles size={18} color="#000" />
                  <Text style={styles.applyButtonText}>{t('promptEdit.usePrompt')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </BlurView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  blurContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  glassButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 24,
  },
  systemPromptToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    marginBottom: -16,
  },
  systemPromptToggleText: {
    fontSize: 12,
    color: '#6b7280',
  },
  systemPromptCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  systemPromptText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
    marginBottom: 8,
  },
  currentPromptSection: {
    gap: 0,
  },
  currentPromptCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  currentPromptText: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  emptyPromptSection: {
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.2)',
  },
  emptyPromptText: {
    fontSize: 14,
    color: '#a78bfa',
    textAlign: 'center',
  },
  inputSection: {
    gap: 0,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    minHeight: 80,
    maxHeight: 150,
    padding: 14,
    fontSize: 15,
    color: '#fff',
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 44,
    height: 44,
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 22,
    backgroundColor: '#a78bfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(167, 139, 250, 0.3)',
  },
  resultSection: {
    gap: 0,
  },
  resultCard: {
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    minHeight: 80,
  },
  resultText: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 22,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#a78bfa',
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    fontSize: 14,
    color: '#ef4444',
  },
  footer: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#a78bfa',
    paddingVertical: 16,
    borderRadius: 12,
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
});
