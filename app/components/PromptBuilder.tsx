import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate as fmtDate } from '../../lib/i18n/format';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Plus, Trash2, BookmarkCheck, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  getSavedPrompts,
  createSavedPrompt,
  deleteSavedPrompt,
  type SavedPrompt,
} from '../../lib/prompts/savedPrompts';
import { useAuth } from '../../contexts/AuthModalContext';

const ICON_COLOR = '#9ca3af';

interface PromptBuilderProps {
  visible: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  currentPrompt?: string;
}

export default function PromptBuilder({
  visible,
  onClose,
  onApply,
  currentPrompt,
}: PromptBuilderProps) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [saving, setSaving] = useState(false);
  const { isAuthenticated, requireAuth } = useAuth();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Load prompts when modal opens
  useEffect(() => {
    if (visible) {
      loadPrompts();
    }
  }, [visible]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const data = await getSavedPrompts();
      setPrompts(data);
    } catch (error) {
      console.error('Error loading prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPrompt = useCallback(
    (prompt: SavedPrompt) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onApply(prompt.prompt);
      onClose();
    },
    [onApply, onClose]
  );

  const handleDeletePrompt = useCallback(async (promptId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(t('promptBuilder.deletePromptTitle'), t('promptBuilder.deletePromptMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSavedPrompt(promptId);
            setPrompts((prev) => prev.filter((p) => p.id !== promptId));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (error) {
            console.error('Error deleting prompt:', error);
            Alert.alert(t('common.error'), t('promptBuilder.deleteFailed'));
          }
        },
      },
    ]);
  }, []);

  const handleSaveCurrentPrompt = useCallback(async () => {
    if (!newPromptName.trim()) {
      Alert.alert(t('common.error'), t('promptBuilder.enterNamePrompt'));
      return;
    }
    if (!currentPrompt?.trim()) {
      Alert.alert(t('common.error'), t('promptBuilder.noPromptToSave'));
      return;
    }

    setSaving(true);
    try {
      const newPrompt = await createSavedPrompt({
        name: newPromptName.trim(),
        prompt: currentPrompt.trim(),
      });
      setPrompts((prev) => [newPrompt, ...prev]);
      setNewPromptName('');
      setShowSaveModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error saving prompt:', error);
      Alert.alert(t('common.error'), t('promptBuilder.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [newPromptName, currentPrompt]);

  const formatDate = (dateStr: string) =>
    fmtDate(dateStr, { month: 'short', day: 'numeric' });

  // Check auth before showing save modal
  const handleOpenSaveModal = useCallback(() => {
    if (!requireAuth()) {
      // User not logged in, auth modal was shown
      return;
    }
    setShowSaveModal(true);
  }, [requireAuth]);

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
          <TouchableOpacity onPress={onClose}>
            <BlurView intensity={40} tint="dark" style={styles.glassButton}>
              <X size={18} color="#fff" />
            </BlurView>
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>{t('promptBuilder.title')}</Text>
            {prompts.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{prompts.length}</Text>
              </View>
            )}
          </View>
          <View style={styles.headerButton} />
        </View>

        {/* Save Current Prompt Button */}
        {currentPrompt?.trim() && (
          <TouchableOpacity
            style={styles.saveCurrentButton}
            onPress={handleOpenSaveModal}
          >
            <Plus size={18} color="#F4D58D" />
            <Text style={styles.saveCurrentButtonText}>{t('promptBuilder.saveCurrentPrompt')}</Text>
          </TouchableOpacity>
        )}

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#F4D58D" />
              <Text style={styles.loadingText}>{t('promptBuilder.loadingPrompts')}</Text>
            </View>
          ) : prompts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <BookmarkCheck size={48} color="#333" />
              <Text style={styles.emptyTitle}>{t('promptBuilder.noSavedPrompts')}</Text>
              <Text style={styles.emptyText}>
                {t('promptBuilder.emptyDescription')}
              </Text>
            </View>
          ) : (
            prompts.map((prompt) => (
              <TouchableOpacity
                key={prompt.id}
                style={styles.promptCard}
                onPress={() => handleSelectPrompt(prompt)}
                activeOpacity={0.7}
              >
                <View style={styles.promptCardContent}>
                  <View style={styles.promptHeader}>
                    <Text style={styles.promptName} numberOfLines={1}>
                      {prompt.name}
                    </Text>
                    <Text style={styles.promptDate}>
                      {formatDate(prompt.created_at)}
                    </Text>
                  </View>
                  <Text style={styles.promptText} numberOfLines={3}>
                    {prompt.prompt}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeletePrompt(prompt.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Trash2 size={18} color="#ef4444" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
          <View style={styles.footer} />
        </ScrollView>
      </View>

      {/* Save Modal */}
      <Modal
        visible={showSaveModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setShowSaveModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.saveModalKeyboardView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.saveModalOverlay}>
              <TouchableOpacity
                activeOpacity={1}
                style={styles.saveModalContent}
                onPress={() => {}} // Prevent dismiss when tapping content
              >
                <View style={styles.saveModalHeader}>
                  <Text style={styles.saveModalTitle}>{t('promptBuilder.savePromptTitle')}</Text>
                  <TouchableOpacity
                    style={styles.dismissKeyboardButton}
                    onPress={() => Keyboard.dismiss()}
                  >
                    <ChevronDown size={20} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.saveModalLabel}>{t('promptBuilder.nameLabel')}</Text>
                <TextInput
                  style={styles.saveModalInput}
                  value={newPromptName}
                  onChangeText={setNewPromptName}
                  placeholder={t('promptBuilder.namePlaceholder')}
                  placeholderTextColor="#666"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                <Text style={styles.saveModalPreviewLabel}>{t('promptBuilder.previewLabel')}</Text>
                <Text style={styles.saveModalPreview} numberOfLines={4}>
                  {currentPrompt}
                </Text>
                <View style={styles.saveModalButtons}>
                  <TouchableOpacity
                    style={styles.saveModalCancelButton}
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowSaveModal(false);
                    }}
                  >
                    <Text style={styles.saveModalCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.saveModalSaveButton,
                      (!newPromptName.trim() || saving) &&
                        styles.saveModalSaveButtonDisabled,
                    ]}
                    onPress={() => {
                      Keyboard.dismiss();
                      handleSaveCurrentPrompt();
                    }}
                    disabled={!newPromptName.trim() || saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#0a0a0a" />
                    ) : (
                      <Text style={styles.saveModalSaveText}>{t('common.save')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
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
    width: 36,
    height: 36,
  },
  glassButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#F4D58D',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0a0a0a',
  },
  saveCurrentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(244, 213, 141, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 213, 141, 0.3)',
  },
  saveCurrentButtonText: {
    color: '#F4D58D',
    fontSize: 15,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  promptCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  promptCardContent: {
    flex: 1,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  promptName: {
    color: '#F4D58D',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  promptDate: {
    color: '#666',
    fontSize: 12,
  },
  promptText: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
    marginTop: -4,
  },
  footer: {
    height: 40,
  },
  // Save Modal
  saveModalKeyboardView: {
    flex: 1,
  },
  saveModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  saveModalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  saveModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  saveModalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  dismissKeyboardButton: {
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  saveModalLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  saveModalInput: {
    backgroundColor: '#222',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  saveModalPreviewLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  saveModalPreview: {
    color: '#666',
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  saveModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  saveModalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  saveModalCancelText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '600',
  },
  saveModalSaveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F4D58D',
    alignItems: 'center',
  },
  saveModalSaveButtonDisabled: {
    backgroundColor: '#333',
  },
  saveModalSaveText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '600',
  },
});
