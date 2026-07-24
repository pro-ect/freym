/**
 * AuthModal - Onboarding modal
 *
 * For consumer/edit variant (coin system):
 *   Single step - Sign in with Apple only
 *
 * For BYOK/Lab variant:
 *   Step 1: Sign in with Apple
 *   Step 2: Add Fal.ai API key
 *
 * Shows contextually when user tries to generate without being set up.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Alert,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { aliasPostHogUser } from '../../lib/posthog';
import {
  X,
  Check,
  Key,
  Eye,
  EyeOff,
  ExternalLink,
  Shield,
  User,
  Sparkles,
} from 'lucide-react-native';

const doorImage = require('../../assets/empty states/door.png');
import { BlurView } from 'expo-blur';
import { useSettings } from '../../contexts/SettingsContext';
import { useBalance } from '../../contexts/BalanceContext';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

type Step = 1 | 2;

export default function AuthModal({ visible, onClose, onAuthenticated }: AuthModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Single step flow: Apple Sign-In only (BYOK API key is optional via settings)
  const isSingleStepFlow = true;

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Step 2: API Key state
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isKeyValid, setIsKeyValid] = useState<boolean | null>(null);

  const { checkApiKeyStatus, apiProvider, hasCustomApiKey } = useSettings();
  const { refresh: refreshBalance } = useBalance();

  // Reset state and check auth when modal opens
  useEffect(() => {
    if (visible) {
      // Reset form state
      setApiKey('');
      setShowApiKey(false);
      setIsValidating(false);
      setIsSaving(false);
      setIsKeyValid(null);
      setIsSigningIn(false);
      // Check current auth status
      checkAuthAndApiKey();
    }
  }, [visible]);

  const checkAuthAndApiKey = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const isGuest = session?.user?.email?.endsWith('@guest.local') ||
                    session?.user?.user_metadata?.kind === 'guest';
    if (session && !session.user?.is_anonymous && !isGuest) {
      // For single-step flow (consumer/edit variant), just close modal after auth
      if (isSingleStepFlow) {
        console.log('[AuthModal] Single-step flow - user authenticated, completing onboarding');
        onAuthenticated();
        return;
      }

      // User is authenticated, check for API keys (for BYOK variants)
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('fal_api_key_encrypted, replicate_api_key_encrypted')
          .eq('id', session.user.id)
          .single();

        const hasFalKey = !!profile?.fal_api_key_encrypted;
        const hasReplicateKey = !!profile?.replicate_api_key_encrypted;
        const hasApiKey = apiProvider === 'fal' ? hasFalKey : hasReplicateKey;
        console.log('[AuthModal] User authenticated, API keys:', { hasFalKey, hasReplicateKey, apiProvider, hasApiKey });

        if (hasApiKey) {
          // Already has API key for current provider, close modal
          onAuthenticated();
        } else {
          // Move to step 2 for API key setup
          setCurrentStep(2);
        }
      } catch (error) {
        console.error('[AuthModal] Error checking API key:', error);
        // On error, assume no key and show step 2
        setCurrentStep(2);
      }
    } else {
      setCurrentStep(1);
    }
  };

  // Provider config for API key step
  const providerConfig = {
    replicate: {
      name: 'Replicate',
      placeholder: 'r8_...',
      validateEndpoint: 'validate-replicate-key',
      getKeyUrl: 'https://replicate.com/account/api-tokens',
    },
    fal: {
      name: 'Fal.ai',
      placeholder: 'Enter Fal.ai API key...',
      validateEndpoint: 'validate-fal-key',
      getKeyUrl: 'https://funky-calliandra-0c0.notion.site/Get-your-Fal-ai-API-key-2c77de5fc1c980b98dccc0f11b1ccb5e',
    },
  };

  const currentProvider = providerConfig[apiProvider];

  const handleAppleSignIn = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert(t('auth.notAvailableTitle'), t('auth.appleOnlyIos'));
      return;
    }

    setIsSigningIn(true);
    try {
      // Capture current anonymous user ID before Apple sign-in replaces the session
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const wasAnonymous = currentSession?.user?.is_anonymous === true ||
                          currentSession?.user?.email?.endsWith('@guest.local') ||
                          currentSession?.user?.user_metadata?.kind === 'guest';
      const previousUserId = wasAnonymous ? currentSession?.user?.id : null;

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('No identityToken received from Apple');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });

      if (error) {
        const isInfraError = error.message?.includes('<html') ||
                            error.message?.includes('Parse error') ||
                            error.message?.includes('Unexpected character');
        const userMessage = isInfraError
          ? t('auth.serviceUnavailable')
          : error.message;
        Alert.alert(t('auth.signInFailedTitle'), userMessage);
        return;
      }

      if (!data.user || !data.session) {
        Alert.alert(t('auth.signInFailedTitle'), t('auth.noUserData'));
        return;
      }

      // Create profile if it doesn't exist
      await supabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          email: data.user.email,
          coin_balance: 0,
        }, {
          onConflict: 'id',
          ignoreDuplicates: true
        });

      // Migrate data from anonymous user to new Apple user
      if (wasAnonymous && previousUserId && previousUserId !== data.user.id) {
        console.log('[AuthModal] Migrating anonymous user data:', previousUserId, '→', data.user.id);
        // Merge the guest's PostHog person into the new real person. Sign-up mints
        // a NEW Supabase id, so without this the pre-signup guest activity would
        // stay under a separate (now-deleted) anon person. The new id is identified
        // by SubscriptionContext's SIGNED_IN handler.
        await aliasPostHogUser(previousUserId);
        try {
          const { error: migrateError } = await supabase.functions.invoke('migrate-anonymous-user', {
            body: { fromUserId: previousUserId, toUserId: data.user.id },
          });
          if (migrateError) {
            console.error('[AuthModal] Migration error:', migrateError);
          } else {
            console.log('[AuthModal] Migration complete');
          }
        } catch (migErr) {
          console.error('[AuthModal] Migration failed:', migErr);
        }
      }

      // Check if user already has API key, skip step 2 if so
      await checkAuthAndApiKey();

    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') {
        console.log('User canceled Apple Sign In');
      } else {
        const errorMsg = e.message || '';
        const isInfraError = errorMsg.includes('<html') ||
                            errorMsg.includes('Parse error') ||
                            errorMsg.includes('Network request failed');
        const userMessage = isInfraError
          ? t('auth.serviceUnavailable')
          : (e.message || t('auth.appleSignInFailed'));
        Alert.alert(t('common.error'), userMessage);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const validateKey = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke(currentProvider.validateEndpoint, {
        body: { api_key: apiKey }
      });
      if (error) throw error;
      return data?.valid === true;
    } catch (error) {
      console.error('Key validation error:', error);
      return false;
    }
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert(t('common.error'), t('auth.enterApiKey'));
      return;
    }

    setIsValidating(true);
    setIsKeyValid(null);

    const valid = await validateKey();
    setIsKeyValid(valid);
    setIsValidating(false);

    if (!valid) {
      Alert.alert(t('auth.invalidKeyTitle'), t('auth.invalidKeyTestMessage'));
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert(t('common.error'), t('auth.enterApiKey'));
      return;
    }

    setIsSaving(true);

    try {
      // Validate first if not already validated
      if (isKeyValid !== true) {
        const valid = await validateKey();
        if (!valid) {
          Alert.alert(t('auth.invalidKeyTitle'), t('auth.enterValidApiKey'));
          setIsSaving(false);
          return;
        }
      }

      // Save the key
      const { error } = await supabase.functions.invoke('save-api-key', {
        body: {
          api_key: apiKey,
          provider: apiProvider,
        }
      });

      if (error) throw error;

      // Refresh contexts
      await checkApiKeyStatus();
      await refreshBalance();

      // Done! Close modal
      onAuthenticated();

    } catch (error: any) {
      console.error('Save key error:', error);
      Alert.alert(t('common.error'), error.message || t('auth.saveApiKeyFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      <View style={styles.stepRow}>
        <View style={[styles.stepCircle, currentStep >= 1 && styles.stepCircleActive]}>
          {currentStep > 1 ? (
            <Check size={14} color="#fff" />
          ) : (
            <Text style={styles.stepNumber}>1</Text>
          )}
        </View>
        <View style={[styles.stepLine, currentStep > 1 && styles.stepLineActive]} />
        <View style={[styles.stepCircle, currentStep >= 2 && styles.stepCircleActive]}>
          <Text style={styles.stepNumber}>2</Text>
        </View>
      </View>
      <View style={styles.stepLabels}>
        <Text style={[styles.stepLabel, currentStep === 1 && styles.stepLabelActive]}>{t('auth.stepSignIn')}</Text>
        <Text style={[styles.stepLabel, currentStep === 2 && styles.stepLabelActive]}>{t('auth.stepAddApiKey')}</Text>
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={styles.heroImageContainer}>
        <Image source={doorImage} style={styles.heroImage} resizeMode="contain" />
      </View>

      <Text style={styles.signInTitle}>{t('auth.signInToGetStarted')}</Text>

      {Platform.OS === 'ios' ? (
        <View style={styles.buttonContainer}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={12}
            style={styles.appleButton}
            onPress={handleAppleSignIn}
          />
          {isSigningIn && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#000" />
            </View>
          )}
        </View>
      ) : (
        <Text style={styles.notAvailable}>{t('auth.appleOnlyIos')}</Text>
      )}

      <Text style={styles.signInSubtitle}>
        {t('auth.signInSubtitle')}
      </Text>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={styles.iconContainer}>
        <Key size={32} color="#fff" />
      </View>

      <Text style={styles.stepTitle}>{t('auth.connectProvider', { provider: currentProvider.name })}</Text>
      <Text style={styles.stepDescription}>
        {t('auth.connectProviderDescription')}
      </Text>

      {/* API Key Input */}
      <View style={styles.inputSection}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={(text) => {
              setApiKey(text);
              setIsKeyValid(null);
            }}
            placeholder={currentProvider.placeholder}
            placeholderTextColor="#666"
            secureTextEntry={!showApiKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? (
              <EyeOff size={20} color="#666" />
            ) : (
              <Eye size={20} color="#666" />
            )}
          </TouchableOpacity>
          {isKeyValid === true && (
            <View style={styles.validBadge}>
              <Check size={16} color="#10b981" />
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.testButton, isValidating && styles.buttonDisabled]}
            onPress={handleTestKey}
            disabled={isValidating || isSaving}
          >
            {isValidating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.testButtonText}>{t('auth.test')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.buttonDisabled]}
            onPress={handleSaveKey}
            disabled={isValidating || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.saveButtonText}>{t('auth.saveAndContinue')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Get Key Link */}
      <TouchableOpacity
        style={styles.getLinkButton}
        onPress={() => Linking.openURL(currentProvider.getKeyUrl)}
      >
        <ExternalLink size={16} color="#3b82f6" />
        <Text style={styles.getLinkText}>{t('auth.getYourApiKey', { provider: currentProvider.name })}</Text>
      </TouchableOpacity>

      {/* Security Note */}
      <View style={styles.securityNote}>
        <Shield size={14} color="#6b7280" />
        <Text style={styles.securityText}>
          {t('auth.securityNote')}
        </Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, isSingleStepFlow && styles.headerMinimal, { paddingTop: Platform.OS === 'android' ? insets.top + 16 : 16 }]}>
          <TouchableOpacity onPress={onClose}>
            <BlurView intensity={40} tint="dark" style={styles.glassButton}>
              <X size={18} color="#fff" />
            </BlurView>
          </TouchableOpacity>
          {!isSingleStepFlow && (
            <>
              <Text style={styles.title}>{t('auth.getStarted')}</Text>
              <View style={styles.headerSpacer} />
            </>
          )}
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.content, isSingleStepFlow && styles.contentCentered]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step Indicator - hidden for single-step flow */}
          {!isSingleStepFlow && renderStepIndicator()}

          {/* Current Step Content */}
          <View style={[styles.card, isSingleStepFlow && styles.cardMinimal]}>
            {currentStep === 1 ? renderStep1() : renderStep2()}
          </View>

          {/* Skip Button - only for multi-step flow */}
          {!isSingleStepFlow && (
            <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
              <Text style={styles.skipText}>{t('auth.maybeLater')}</Text>
            </TouchableOpacity>
          )}
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
  headerMinimal: {
    borderBottomWidth: 0,
    justifyContent: 'flex-start',
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
    fontFamily: 'Manrope-SemiBold',
  },
  headerSpacer: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  contentCentered: {
    flex: 1,
    justifyContent: 'center',
  },

  // Step Indicator
  stepIndicator: {
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#3b82f6',
  },
  stepNumber: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Manrope-SemiBold',
  },
  stepLine: {
    width: 60,
    height: 2,
    backgroundColor: '#333',
    marginHorizontal: 8,
  },
  stepLineActive: {
    backgroundColor: '#3b82f6',
  },
  stepLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 50,
  },
  stepLabel: {
    color: '#666',
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
  },
  stepLabelActive: {
    color: '#fff',
  },

  // Card
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardMinimal: {
    backgroundColor: 'transparent',
  },

  // Step Content
  stepContent: {
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconContainerLarge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  heroImageContainer: {
    width: 200,
    height: 295,
    overflow: 'visible',
    marginBottom: 16,
    marginTop: -24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: 200,
    height: 295,
  },
  signInTitle: {
    color: '#fff',
    fontSize: 24,
    fontFamily: 'Manrope-Bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  signInSubtitle: {
    color: '#888',
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 24,
    paddingHorizontal: 8,
  },
  signInText: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'Manrope-SemiBold',
    textAlign: 'center',
    marginBottom: 32,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'Manrope-Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  stepDescription: {
    color: '#9ca3af',
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },

  // Step 1
  buttonContainer: {
    width: '100%',
    position: 'relative',
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notAvailable: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
  bonusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 16,
  },
  bonusText: {
    color: '#FFD700',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },

  // Step 2
  inputSection: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
  },
  eyeButton: {
    padding: 8,
  },
  validBadge: {
    marginLeft: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  testButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#333',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Manrope-SemiBold',
  },
  saveButton: {
    flex: 2,
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#000',
    fontSize: 15,
    fontFamily: 'Manrope-SemiBold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  getLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  getLinkText: {
    color: '#3b82f6',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  securityText: {
    color: '#6b7280',
    fontSize: 12,
    fontFamily: 'Manrope-Regular',
  },

  // Skip
  skipButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipText: {
    color: '#666',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },
});
