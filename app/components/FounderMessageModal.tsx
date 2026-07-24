import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Send, Star } from 'lucide-react-native';
import * as StoreReview from 'expo-store-review';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { ensureAnonymousSession } from '../../lib/auth/ensureGuestSession';

interface FounderMessageModalProps {
  visible: boolean;
  onClose: () => void;
}

// TODO(freym): replace with the new App Store numeric id once the ASC app record exists.
const APP_STORE_REVIEW_URL = 'itms-apps://itunes.apple.com/app/id0000000000?action=write-review';
// market:// opens the Play app directly; the https form is the fallback when no
// Play client can handle the intent.
const PLAY_STORE_REVIEW_URL = 'market://details?id=genai.freym.studio';
const PLAY_STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=genai.freym.studio';
const MAX_LEN = 2000;

export default function FounderMessageModal({ visible, onClose }: FounderMessageModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Prefill the reply address for signed-in users; guests type theirs if they want a reply.
  useEffect(() => {
    if (!visible || replyEmail) return;
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email;
      if (email) setReplyEmail((prev) => prev || email);
    }).catch(() => {});
  }, [visible]);

  const handleClose = () => {
    onClose();
    // Reset after the slide-down animation so the user doesn't see the swap.
    setTimeout(() => { setSent(false); setMessage(''); }, 400);
  };

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await ensureAnonymousSession();
      const { data, error } = await supabase.functions.invoke('send-founder-message', {
        body: {
          message: text.slice(0, MAX_LEN),
          replyEmail: replyEmail.trim() || undefined,
        },
      });
      if (error || !data?.ok) throw error || new Error('send failed');
      setSent(true);
    } catch (e) {
      console.error('[founder-message] send failed', e);
      Alert.alert(t('common.error'), t('settings.founderError'));
    } finally {
      setSending(false);
    }
  };

  const handleRate = async () => {
    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
        return;
      }
    } catch { /* fall through to the store page */ }
    if (Platform.OS === 'android') {
      Linking.openURL(PLAY_STORE_REVIEW_URL)
        .catch(() => Linking.openURL(PLAY_STORE_WEB_URL))
        .catch(() => {});
      return;
    }
    Linking.openURL(APP_STORE_REVIEW_URL).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + 14 : 14 }]}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('settings.messageFounder')}</Text>
          <View style={styles.headerButton} />
        </View>

        {sent ? (
          <View style={styles.successContainer}>
            <View style={styles.successCheck}>
              <Text style={styles.successCheckMark}>✓</Text>
            </View>
            <Text style={styles.successTitle}>{t('settings.founderSentTitle')}</Text>
            <Text style={styles.successBody}>{t('settings.founderSentBody')}</Text>
            <TouchableOpacity style={styles.rateButton} onPress={handleRate} activeOpacity={0.8}>
              <Star size={18} color="#111" fill="#111" />
              <Text style={styles.rateButtonText}>{t('settings.founderRateCta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneButton} onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.doneButtonText}>{t('settings.founderDone')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.introTitle}>{t('settings.founderIntroTitle')}</Text>
            <Text style={styles.introBody}>{t('settings.founderIntroBody')}</Text>

            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder={t('settings.founderPlaceholder')}
              placeholderTextColor="#6b7280"
              multiline
              maxLength={MAX_LEN}
              autoFocus
              textAlignVertical="top"
            />

            <TextInput
              style={styles.emailInput}
              value={replyEmail}
              onChangeText={setReplyEmail}
              placeholder={t('settings.founderReplyEmailPlaceholder')}
              placeholderTextColor="#6b7280"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
            />

            <TouchableOpacity
              style={[styles.sendButton, (!message.trim() || sending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!message.trim() || sending}
              activeOpacity={0.8}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#111" />
              ) : (
                <>
                  <Send size={18} color="#111" />
                  <Text style={styles.sendButtonText}>{t('settings.founderSend')}</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerButton: {
    width: 32,
    alignItems: 'flex-start',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  introTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  introBody: {
    color: '#9ca3af',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    minHeight: 140,
    marginBottom: 12,
  },
  emailInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  successCheck: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#10b98122',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successCheckMark: {
    color: '#10b981',
    fontSize: 36,
    fontWeight: '700',
  },
  successTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  successBody: {
    color: '#9ca3af',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 28,
  },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
  },
  rateButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  doneButton: {
    paddingVertical: 16,
  },
  doneButtonText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '500',
  },
});
