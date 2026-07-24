/**
 * AgentHeroBanner — full-bleed promo banner at the top of Home for the in-app
 * Photo Agent. Tapping it opens the chat page (/agent). Styled to sit above the
 * existing model HeroCarousel.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, ArrowRight } from 'lucide-react-native';

const ROUNDED_FONT = 'SFRounded-Medium';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_HEIGHT = Math.round(SCREEN_WIDTH * 0.62);

export default function AgentHeroBanner({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.wrap}>
      <LinearGradient
        colors={['#3a0d5c', '#7b1f6e', '#ff2d87']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <View style={styles.badge}>
          <Sparkles size={13} color="#fff" />
          <Text style={styles.badgeText}>NEW</Text>
        </View>
        <Text style={styles.title}>Your AI photo agent</Text>
        <Text style={styles.subtitle}>
          Send a photo, chat your idea — it suggests edits and makes them. You confirm every cost.
        </Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Try the Agent</Text>
          <ArrowRight size={18} color="#000" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SCREEN_WIDTH,
    height: BANNER_HEIGHT,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  content: { padding: 22, gap: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 34, fontWeight: '600', lineHeight: 38 },
  subtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 21, maxWidth: '92%' },
  cta: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  ctaText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 16, fontWeight: '600' },
});
