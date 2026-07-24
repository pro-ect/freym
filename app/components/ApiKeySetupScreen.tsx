/**
 * ApiKeySetupModal - Modal for API key setup (API variant)
 *
 * Shows when user tries to generate without an API key configured.
 * Uses pageSheet modal style like ImageDetailsModal.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  ScrollView,
  Platform,
} from 'react-native';
import { X, Key, Eye, EyeOff, ExternalLink, Check, Shield } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../contexts/SettingsContext';
import { useBalance } from '../../contexts/BalanceContext';

type ApiProvider = 'replicate' | 'fal';

interface ApiKeySetupModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ApiKeySetupModal({ visible, onClose, onSuccess }: ApiKeySetupModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isKeyValid, setIsKeyValid] = useState<boolean | null>(null);

  const { checkApiKeyStatus, apiProvider } = useSettings();
  const { refresh: refreshBalance } = useBalance();

  // Provider-specific config
  const providerConfig = {
    replicate: {
      name: 'Replicate',
      placeholder: 'r8_...',
      validateEndpoint: 'validate-replicate-key',
      getKeyUrl: 'https://replicate.com/account/api-tokens',
      steps: [
        t('byok.replicateStep1'),
        t('byok.replicateStep2'),
        t('byok.replicateStep3'),
        t('byok.replicateStep4'),
      ],
    },
    fal: {
      name: 'Fal.ai',
      placeholder: t('byok.enterProviderKeyPlaceholder', { provider: 'Fal.ai' }),
      validateEndpoint: 'validate-fal-key',
      getKeyUrl: 'https://funky-calliandra-0c0.notion.site/Get-your-Fal-ai-API-key-2c77de5fc1c980b98dccc0f11b1ccb5e',
      steps: [
        t('byok.falStep1'),
        t('byok.falStep2'),
        t('byok.falStep3'),
        t('byok.falStep4'),
      ],
    },
  };

  const currentProvider = providerConfig[apiProvider];

  const validateKey = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke(currentProvider.validateEndpoint, {
        body: { api_key: apiKey }
      });

      if (error) throw error;

      return data?.valid === true;
    } catch (error: any) {
      console.error('Key validation error:', error);
      return false;
    }
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert(t('common.error'), t('byok.enterApiKey'));
      return;
    }

    setIsValidating(true);
    setIsKeyValid(null);

    try {
      const valid = await validateKey();
      setIsKeyValid(valid);

      if (valid) {
        Alert.alert(t('byok.validTitle'), t('byok.validMessage'));
      } else {
        Alert.alert(t('byok.invalidKeyTitle'), t('byok.invalidKeyMessage'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('byok.validateFailed'));
      setIsKeyValid(false);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert(t('common.error'), t('byok.enterApiKey'));
      return;
    }

    setIsSaving(true);

    try {
      // First validate
      const valid = await validateKey();

      if (!valid) {
        Alert.alert(t('byok.invalidKeyTitle'), t('byok.enterValidProviderKey', { provider: currentProvider.name }));
        setIsKeyValid(false);
        setIsSaving(false);
        return;
      }

      // Then save with provider
      const { error: saveError } = await supabase.functions.invoke('save-api-key', {
        body: { api_key: apiKey, provider: apiProvider }
      });

      if (saveError) throw saveError;

      // Refresh states
      await checkApiKeyStatus();
      await refreshBalance();

      // Clear input and close
      setApiKey('');
      setIsKeyValid(null);

      Alert.alert(t('byok.successTitle'), t('byok.savedSuccess'), [
        { text: t('common.ok'), onPress: () => {
          onClose();
          onSuccess?.();
        }}
      ]);

    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('byok.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const openProviderTokens = () => {
    Linking.openURL(currentProvider.getKeyUrl);
  };

  const handleClose = () => {
    setApiKey('');
    setIsKeyValid(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={handleClose}>
            <BlurView intensity={40} tint="dark" style={styles.glassButton}>
              <X size={18} color="#fff" />
            </BlurView>
          </TouchableOpacity>
          <Text style={styles.title}>{t('byok.apiKeyRequired')}</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info Section */}
          <View style={styles.section}>
            <View style={styles.infoCard}>
              <View style={styles.iconContainer}>
                <Key size={28} color="#fff" strokeWidth={1.5} />
              </View>
              <Text style={styles.infoTitle}>Copy Shot</Text>
              <Text style={styles.infoText}>
                {t('byok.addKeyToGenerate', { provider: currentProvider.name })}
              </Text>
              <View style={styles.securityCard}>
                <Shield size={16} color="#10b981" />
                <View style={styles.securityCardContent}>
                  <Text style={styles.securityCardTitle}>{t('byok.keyProtected')}</Text>
                  <Text style={styles.securityCardText}>
                    {t('byok.keyProtectedDetail')}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Input Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('byok.providerApiKey', { provider: currentProvider.name })}</Text>
            <View style={styles.card}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={apiKey}
                  onChangeText={(text) => {
                    setApiKey(text);
                    setIsKeyValid(null);
                  }}
                  placeholder={currentProvider.placeholder}
                  placeholderTextColor="#6b7280"
                  secureTextEntry={!showApiKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                />
                <TouchableOpacity
                  style={styles.inputButton}
                  onPress={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff size={18} color="#6b7280" />
                  ) : (
                    <Eye size={18} color="#6b7280" />
                  )}
                </TouchableOpacity>
                {isKeyValid === true && (
                  <View style={styles.validIndicator}>
                    <Check size={18} color="#10b981" />
                  </View>
                )}
              </View>

              {/* Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, isValidating && styles.buttonDisabled]}
                  onPress={handleTestKey}
                  disabled={!apiKey.trim() || isValidating}
                >
                  {isValidating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>{t('byok.test')}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.buttonPrimary, isSaving && styles.buttonDisabled]}
                  onPress={handleSaveKey}
                  disabled={!apiKey.trim() || isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.buttonTextPrimary}>{t('byok.saveKey')}</Text>
                  )}
                </TouchableOpacity>
              </View>

            </View>
          </View>

          {/* Help Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('byok.howItWorks')}</Text>
            <View style={styles.card}>
              {currentProvider.steps.map((step, index) => (
                <View
                  key={index}
                  style={[
                    styles.helpRow,
                    index === currentProvider.steps.length - 1 && styles.helpRowLast,
                  ]}
                >
                  <Text style={styles.helpNumber}>{index + 1}</Text>
                  <Text style={styles.helpText}>{step}</Text>
                </View>
              ))}
              <TouchableOpacity
                style={styles.linkRow}
                onPress={openProviderTokens}
              >
                <ExternalLink size={16} color="#3b82f6" />
                <Text style={styles.linkText}>{t('byok.getApiKeyFrom', { provider: currentProvider.name })}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.footer} />
        </ScrollView>
      </View>
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
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
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 20,
    fontFamily: 'Manrope-Bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 14,
    fontFamily: 'Manrope-Regular',
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  securityCardContent: {
    flex: 1,
  },
  securityCardTitle: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Manrope-SemiBold',
    marginBottom: 3,
  },
  securityCardText: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'Manrope-Regular',
    lineHeight: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 12,
    fontFamily: 'Manrope-Regular',
  },
  inputButton: {
    padding: 8,
  },
  validIndicator: {
    marginLeft: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
  },
  button: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    borderRadius: 10,
  },
  buttonPrimary: {
    backgroundColor: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  linkText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '500',
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  helpRowLast: {
    borderBottomWidth: 0,
  },
  helpNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#333',
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
  },
  helpText: {
    flex: 1,
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    height: 40,
  },
});
