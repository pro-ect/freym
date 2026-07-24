/**
 * GrantCoinsPopup — celebratory modal shown once when a user receives the agent
 * welcome coin grant (server-side, geo-gated). Also previewable by admins from
 * Settings → "Preview agent grant popup".
 */
import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ROUNDED_FONT = 'SFRounded-Medium';

export default function GrantCoinsPopup({
  visible,
  amount,
  onClose,
}: {
  visible: boolean;
  amount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <BlurView tint="systemChromeMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
          <Image source={require('../../assets/agent-persona.png')} style={styles.mascot} contentFit="contain" />
          <Text style={styles.title}>{t('agent.grantTitle', { count: amount })}</Text>
          <Text style={styles.body}>{t('agent.grantBody', { count: amount })}</Text>
          <Pressable style={styles.cta} onPress={onClose}>
            <Text style={styles.ctaText}>{t('agent.grantCta')}</Text>
          </Pressable>
        </Pressable>
        <View style={{ height: insets.bottom }} />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: {
    width: '100%', maxWidth: 360, overflow: 'hidden',
    borderRadius: 28, borderCurve: 'continuous',
    backgroundColor: 'rgba(20,20,22,0.6)',
    alignItems: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 22, gap: 12,
  },
  mascot: { width: 96, height: 96, marginBottom: 2 },
  title: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { color: '#cfcfd2', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: { marginTop: 10, alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 999, borderCurve: 'continuous', paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '600' },
});
