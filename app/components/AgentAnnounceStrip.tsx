/**
 * AgentAnnounceStrip — compact horizontal row announcing the AI photo agent.
 * Sits under the main hero on the Inspire tab; tapping opens the agent chat.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from 'react-native-reanimated';

const ROUNDED_FONT = 'SFRounded-Medium';

export default function AgentAnnounceStrip({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  // Same spin as the chat empty-state: 2 quick turns, then a ~4.5s pause, looping.
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(
      withSequence(
        withTiming(2, { duration: 400, easing: Easing.linear }),
        withDelay(4500, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, []);
  const mascotStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 360}deg` }] }));

  return (
    <Pressable onPress={onPress} style={styles.wrap}>
      <Animated.Image source={require('../../assets/agent-persona.png')} style={[styles.mascot, mascotStyle]} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{t('agent.bannerTitle')}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{t('agent.bannerSubtitle')}</Text>
      </View>
      <ChevronRight size={22} color="#777" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#161618',
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2e',
  },
  mascot: { width: 65, height: 65 },
  textWrap: { flex: 1 },
  title: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '600' },
  subtitle: { color: '#8e8e93', fontSize: 14, marginTop: 2 },
});
