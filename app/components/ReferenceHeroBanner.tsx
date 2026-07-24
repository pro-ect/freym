/**
 * ReferenceHeroBanner — the main hero at the top of the Inspire tab.
 * Promotes "a photoshoot based on any reference photo", over an evening photo from
 * the inspiration feed, bleeding all the way to the top of the screen (behind the
 * floating header). Tapping it opens the Create flow.
 *
 * `topInset` is the Inspire header height; we pull the banner up by it (and add it
 * to the height) so the artwork reaches the very top edge under the status bar.
 * `scrollY` drives a parallax stretch when the user pulls down to refresh.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle, interpolate, Extrapolation, type SharedValue } from 'react-native-reanimated';

const ROUNDED_FONT = 'SFRounded-Medium';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BASE_HEIGHT = Math.round(SCREEN_WIDTH * 0.95);

// A dinner/evening portrait from the inspiration feed (small jpg → fast load).
// Exported so the Inspire tab can attach this exact cover to Copy Shot on "Try it".
export const HERO_IMAGE_URL =
  'https://lmuksetmkzssoewkzdlm.supabase.co/storage/v1/object/public/copy-shot-inspire/5ffdd2faa73ae9d59e1980a27ae9aff8.jpg';

export default function ReferenceHeroBanner({
  onPress,
  topInset = 0,
  scrollY,
}: {
  onPress: () => void;
  topInset?: number;
  scrollY?: SharedValue<number>;
}) {
  const { t } = useTranslation();
  const fullHeight = BASE_HEIGHT + topInset;

  // Parallax stretch: on pull-down (scrollY < 0) the photo grows from the top.
  const imgStyle = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.value : 0;
    const scale = interpolate(y, [-fullHeight, 0], [2, 1], {
      extrapolateLeft: Extrapolation.EXTEND,
      extrapolateRight: Extrapolation.CLAMP,
    });
    const translateY = interpolate(y, [-fullHeight, 0], [-fullHeight, 0], {
      extrapolateLeft: Extrapolation.EXTEND,
      extrapolateRight: Extrapolation.CLAMP,
    });
    return { transform: [{ translateY }, { scale }] };
  });

  // Keep the top scrim pinned to the screen top while the photo stretches under it,
  // so the header controls stay backed by the gradient during pull-to-refresh.
  const topScrimStyle = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.value : 0;
    return { transform: [{ translateY: Math.min(0, y) }] };
  });

  return (
    <Pressable onPress={onPress} style={[styles.wrap, { marginTop: -topInset, height: fullHeight }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.imgWrap, imgStyle]}>
        <Image
          source={{ uri: HERO_IMAGE_URL }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
        />
      </Animated.View>

      {/* top scrim — pinned to the screen top (doesn't pull with the photo) */}
      <Animated.View style={[styles.topScrim, { height: topInset + 60 }, topScrimStyle]} pointerEvents="none">
        <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {/* bottom scrim for the headline / CTA */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.content}>
        <Text style={styles.title}>{t('agent.heroTitle')}</Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{t('agent.heroTry')}</Text>
          <ArrowRight size={18} color="#000" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No overflow:hidden — the scaling image must be free to stretch beyond the
  // banner box on pull-to-refresh (mirrors the Home hero). At rest the image is
  // absoluteFill so it sits exactly within bounds.
  wrap: { width: SCREEN_WIDTH, justifyContent: 'flex-end', backgroundColor: '#0a0a0a' },
  imgWrap: { transformOrigin: 'top', overflow: 'hidden' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  content: { padding: 22, paddingBottom: 30, gap: 16, alignItems: 'center' },
  title: {
    color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 34, fontWeight: '600',
    lineHeight: 38, textAlign: 'center', maxWidth: '88%',
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center',
    backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999, borderCurve: 'continuous',
  },
  ctaText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 16, fontWeight: '600' },
});
