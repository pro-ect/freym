/**
 * GlobalAgentFab — a sticky glass button that opens the Photo Agent (/agent) from
 * anywhere in the app. Mounted once at the root (above the tab navigator) so it
 * rides over every tab. Uses the same glass treatment as the coin/settings buttons.
 *
 * Stays MOUNTED at all times (just toggles opacity + pointerEvents) so it doesn't
 * pop back in a beat late when returning from the chat.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from 'react-native-reanimated';

const HAS_LIQUID_GLASS = (() => {
  try { return isLiquidGlassAvailable(); } catch { return false; }
})();

const SIZE = 56;

// Hidden on the agent chat itself, the editor + Copy Shot (imagine) tabs (their
// Generate button sits where the FAB would cover it), and recipe/fine-tune editors.
const HIDE_IF_INCLUDES = ['agent', 'editor', 'imagine', 'recipe', 'fine-tune', 'category'];

export default function GlobalAgentFab() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname() || '';
  const hidden = HIDE_IF_INCLUDES.some((seg) => pathname.includes(seg));

  // Same spin as the chat empty-state / banner: 2 quick turns, ~4.5s pause, loop.
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
  const icon = <Animated.Image source={require('../../assets/agent-persona.png')} style={[styles.mascot, mascotStyle]} />;

  // Fade opacity instead of hard-toggling so it settles in smoothly when
  // returning from /agent (pathname flips at the end of the pop transition —
  // an instant 0→1 reads as a jarring pop-in).
  const fade = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    fade.value = withTiming(hidden ? 0 : 1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [hidden]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[StyleSheet.absoluteFill, fadeStyle]}
    >
      <Pressable onPress={() => router.push('/agent' as any)} style={[styles.pos, { bottom: insets.bottom + 96 }]}>
        {HAS_LIQUID_GLASS ? (
          <GlassView isInteractive glassEffectStyle="clear" style={styles.glass}>
            {icon}
          </GlassView>
        ) : (
          <View style={styles.glass}>
            <BlurView intensity={60} tint="systemUltraThinMaterial" style={StyleSheet.absoluteFill} />
            {icon}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pos: { position: 'absolute', right: 28 },
  glass: {
    width: SIZE,
    height: SIZE,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascot: { width: 40, height: 40 },
});
