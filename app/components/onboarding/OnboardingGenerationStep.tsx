import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, RefreshCw, Lock, Camera, LayoutGrid, Wand2, ZoomIn, Star } from 'lucide-react-native';
import type { OnboardingGenerationStatus } from '../../hooks/useOnboardingGeneration';
import { getScreenWidth } from '../../../lib/webLayout';

/**
 * Hard-paywall onboarding, step 3: the free generation.
 * Waiting: reference + selfie thumbnails with a pulsing "merging" treatment,
 * a library-style elapsed/ETA counter (Ns / ~Xs where X = etaSeconds, bar
 * idles at 95%, then "Almost done…"), and rotating status lines.
 * Reveal: 2x2 grid — the real result plus 3 blurred, locked teaser tiles
 * (same photo) hinting at what a subscription unlocks.
 * Failure: friendly error + retry.
 */

const SCREEN_WIDTH = getScreenWidth();
const ACCENT = '#FF2D95';
// Fallback ETA when the caller doesn't pass one (matches Copy Shot v2's 180s).
const DEFAULT_ETA_SECONDS = 180;
const STATUS_LINE_INTERVAL_MS = 6000;
const REVIEW_INTERVAL_MS = 5000;
const REVIEW_COUNT = 3;
// Horizontal positions for the 4 rising sparkles.
const SPARKLE_LEFTS = [{ left: '24%' }, { left: '40%' }, { left: '52%' }, { left: '46%' }] as const;

interface OnboardingGenerationStepProps {
  isActive: boolean;
  status: OnboardingGenerationStatus;
  resultUrl: string | null;
  error: string | null;
  canRetry: boolean;
  referenceUri: string | null;
  selfieUri: string | null;
  /** Displayed ETA for the "Ns / ~Xs" counter and progress bar fill. */
  etaSeconds?: number;
  onRetry: () => void;
  /** Tap on the unlocked result tile — opens the fullscreen zoom viewer. */
  onPhotoTap?: (uri: string) => void;
  /** Failure escape hatch: jump back to the choose-photo step. */
  onChangePhotos?: () => void;
}

export default function OnboardingGenerationStep({
  isActive,
  status,
  resultUrl,
  error,
  canRetry,
  referenceUri,
  selfieUri,
  etaSeconds,
  onRetry,
  onPhotoTap,
  onChangePhotos,
}: OnboardingGenerationStepProps) {
  const { t } = useTranslation();
  const etaTotal = etaSeconds && etaSeconds > 0 ? etaSeconds : DEFAULT_ETA_SECONDS;
  const [statusLineIndex, setStatusLineIndex] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [dots, setDots] = useState(1);
  const startedAtRef = useRef<number | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const reviewOpacity = useRef(new Animated.Value(1)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0.92)).current;
  // Pink loader motion: breathing glow on the bar + sparkles rising off it.
  const glow = useRef(new Animated.Value(0.35)).current;
  const sparkles = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;

  const isWorking = status === 'uploading' || status === 'generating';

  const statusLines = [
    t('onboarding.hpf.generating.line1'),
    t('onboarding.hpf.generating.line2'),
    t('onboarding.hpf.generating.line3'),
    t('onboarding.hpf.generating.line4'),
  ];

  // Library-style counter: seconds elapsed since work started, driving both
  // the "Ns / ~180s" readout and the progress bar (capped at 95% until the
  // real result lands).
  useEffect(() => {
    if (!isWorking) {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isWorking]);

  const overEstimate = isWorking && elapsed >= etaTotal;
  const fillRatio = isWorking ? Math.min(0.95, elapsed / etaTotal) : 0;

  // Pulsing thumbnails while working.
  useEffect(() => {
    if (!isWorking) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isWorking, pulse]);

  // Breathing pink glow around the progress bar.
  useEffect(() => {
    if (!isWorking) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.8, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isWorking, glow]);

  // Sparkles rising off the bar, staggered.
  useEffect(() => {
    if (!isWorking) return;
    const loops = sparkles.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 400),
          Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [isWorking, sparkles]);

  // Animated dots after the stage text: cycle 0 → 3.
  useEffect(() => {
    if (!isWorking) return;
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 450);
    return () => clearInterval(id);
  }, [isWorking]);

  // Rotating status lines.
  useEffect(() => {
    if (!isWorking) return;
    const timer = setInterval(
      () => setStatusLineIndex((i) => (i + 1) % statusLines.length),
      STATUS_LINE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [isWorking, statusLines.length]);

  // Rotating text reviews (fade out → swap → fade in).
  useEffect(() => {
    if (!isWorking) return;
    const timer = setInterval(() => {
      Animated.timing(reviewOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setReviewIndex((i) => (i + 1) % REVIEW_COUNT);
        Animated.timing(reviewOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      });
    }, REVIEW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isWorking, reviewOpacity]);

  // Result reveal animation.
  useEffect(() => {
    if (status !== 'completed' || !resultUrl) return;
    revealOpacity.setValue(0);
    revealScale.setValue(0.92);
    Animated.parallel([
      Animated.timing(revealOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(revealScale, { toValue: 1, friction: 7, useNativeDriver: true }),
    ]).start();
  }, [status, resultUrl, revealOpacity, revealScale]);

  if (status === 'completed' && resultUrl) {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.resultContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View
          style={[styles.resultGrid, { opacity: revealOpacity, transform: [{ scale: revealScale }] }]}
        >
          {/* Tile 0: the real result. Tiles 1-3: same photo, blurred + locked
              — teasers for what a subscription unlocks. */}
          {[0, 1, 2, 3].map((i) => (
            <Pressable
              key={i}
              style={styles.resultTile}
              onPress={i === 0 && onPhotoTap ? () => onPhotoTap(resultUrl) : undefined}
              disabled={i !== 0}
            >
              <Image
                source={{ uri: resultUrl }}
                style={styles.resultTileImage}
                contentFit="cover"
                transition={i === 0 ? 200 : 0}
                blurRadius={i === 0 ? 0 : 60}
              />
              {i !== 0 && (
                <View style={styles.lockOverlay}>
                  <View style={styles.lockBadge}>
                    <Lock size={16} color="#fff" strokeWidth={2.5} />
                  </View>
                </View>
              )}
            </Pressable>
          ))}
        </Animated.View>
        <Text style={styles.readyTitle}>{t('onboarding.hpf.result.title')}</Text>
      </ScrollView>
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.root}>
        <View style={styles.failWrap}>
          <Sparkles size={32} color="#888" />
          <Text style={styles.failTitle}>{t('onboarding.hpf.failed.title')}</Text>
          <Text style={styles.failSubtitle}>
            {canRetry ? t('onboarding.hpf.failed.subtitle') : t('onboarding.hpf.failed.subtitleFinal')}
          </Text>
          {canRetry && (
            <Pressable style={styles.retryButton} onPress={onRetry}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.retryText}>{t('onboarding.hpf.failed.retry')}</Text>
            </Pressable>
          )}
          {/* Failures are often photo-specific (moderation, bad crop) —
              going back to re-pick is a better fix than blind retries. */}
          {onChangePhotos && (
            <Pressable style={styles.changePhotosButton} onPress={onChangePhotos}>
              <Text style={styles.changePhotosText}>{t('onboarding.hpf.failed.changePhotos')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // Waiting / idle state — reviews + Pro features fill the ~3 min wait.
  const reviews = [
    { quote: t('onboarding.hpf.reviews.q1'), name: t('onboarding.hpf.reviews.n1') },
    { quote: t('onboarding.hpf.reviews.q2'), name: t('onboarding.hpf.reviews.n2') },
    { quote: t('onboarding.hpf.reviews.q3'), name: t('onboarding.hpf.reviews.n3') },
  ];
  const features = [
    { Icon: Camera, label: t('onboarding.hpf.features.f1') },
    { Icon: LayoutGrid, label: t('onboarding.hpf.features.f2') },
    { Icon: Sparkles, label: t('onboarding.hpf.features.f3') },
    { Icon: Wand2, label: t('onboarding.hpf.features.f4') },
    { Icon: ZoomIn, label: t('onboarding.hpf.features.f5') },
  ];
  const review = reviews[reviewIndex];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.waitContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <Text style={styles.waitTitle}>{t('onboarding.hpf.generating.title')}</Text>

      <View style={styles.mergeRow}>
        {referenceUri ? (
          <Animated.View style={[styles.thumbWrap, { transform: [{ scale: pulse }, { rotate: '-4deg' }] }]}>
            <Image source={{ uri: referenceUri }} style={styles.thumb} contentFit="cover" />
          </Animated.View>
        ) : null}
        <Image
          source={require('../../../assets/agent-persona.png')}
          style={styles.mergeMascot}
          contentFit="contain"
        />
        {selfieUri ? (
          <Animated.View style={[styles.thumbWrap, { transform: [{ scale: pulse }, { rotate: '4deg' }] }]}>
            <Image source={{ uri: selfieUri }} style={styles.thumb} contentFit="cover" />
          </Animated.View>
        ) : null}
      </View>

      {/* Loader pill overlaps the bottom of the photos. Pink gradient fill
          with a breathing glow + sparkles rising off it, so the wait clearly
          reads as "actively working" rather than a frozen grey bar. */}
      <View style={styles.progressWrap}>
        <Animated.View
          style={[
            styles.progressTrack,
            { shadowOpacity: glow, shadowColor: ACCENT, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
          ]}
        >
          <LinearGradient
            colors={['#b81a69', ACCENT, '#ff6cb5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.round(fillRatio * 100)}%` }]}
          />
          <View style={styles.progressInner}>
            <View style={styles.statusLeft}>
              <ActivityIndicator size="small" color={ACCENT} />
              <Text style={styles.statusText} numberOfLines={1}>
                {/* Strip the line's own trailing ellipsis/dots, then append
                    0–3 animated dots so it reads as one live indicator. */}
                {(status === 'uploading'
                  ? t('onboarding.hpf.generating.uploading')
                  : overEstimate
                    ? t('onboarding.hpf.generating.almostDone')
                    : statusLines[statusLineIndex]
                ).replace(/[.…\s]+$/, '') + '.'.repeat(dots)}
              </Text>
            </View>
            {isWorking && !overEstimate && (
              <Text style={styles.counterText}>{`${elapsed}s / ${etaTotal}s`}</Text>
            )}
          </View>
        </Animated.View>
        {/* Sparkles rise OUT of the bar — kept outside the overflow-hidden
            track so they aren't clipped. */}
        {isWorking && sparkles.map((v, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.sparkle,
              SPARKLE_LEFTS[i],
              {
                opacity: v.interpolate({ inputRange: [0, 0.25, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -38] }) }],
              },
            ]}
          />
        ))}
      </View>

      {/* Rotating text-only reviews */}
      <Animated.View style={[styles.reviewBox, { opacity: reviewOpacity }]}>
        <View style={styles.starsRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={12} color="#ffc83d" fill="#ffc83d" />
          ))}
        </View>
        <Text style={styles.reviewQuote} numberOfLines={2}>{review.quote}</Text>
        <Text style={styles.reviewName}>{review.name}</Text>
      </Animated.View>

      {/* What Pro gets you — simple static list */}
      <Text style={styles.proEyebrow}>{t('onboarding.hpf.proEyebrow')}</Text>
      <View style={styles.featuresList}>
        {features.map(({ Icon, label }, i) => (
          <View key={i} style={styles.featRow}>
            <View style={styles.featIcon}>
              <Icon size={16} color="#bbb" />
            </View>
            <Text style={styles.featLabel} numberOfLines={2}>{label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const THUMB_W = Math.min(136, Math.round(SCREEN_WIDTH * 0.34));
const THUMB_H = Math.round(THUMB_W * 1.33);
const GRID_GUTTER = 8;
const GRID_H_PAD = 24;
const TILE_W = Math.floor((SCREEN_WIDTH - GRID_H_PAD * 2 - GRID_GUTTER) / 2);
const TILE_H = Math.round(TILE_W * 1.33);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scroll: {
    flex: 1,
  },
  // Content grows to fill short screens (layout unchanged) and scrolls on
  // small ones; the modal's CTA bar stays fixed below the slide.
  waitContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 22,
  },
  resultContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  waitTitle: {
    color: '#fff',
    fontSize: 24,
    fontFamily: 'SFRounded-Medium',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  mergeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2a2a2a',
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
  },
  mergeMascot: {
    width: 60,
    height: 60,
    marginHorizontal: -18,
    zIndex: 2,
  },
  // Unclipped wrapper so the rising sparkles + glow aren't cut off by the
  // track's overflow:hidden. Rides over the bottom of the photos.
  progressWrap: {
    alignSelf: 'stretch',
    marginTop: -34,
    zIndex: 3,
  },
  progressTrack: {
    height: 44,
    borderRadius: 22,
    backgroundColor: '#17171c',
    borderWidth: 1,
    borderColor: '#26262c',
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 22,
  },
  sparkle: {
    position: 'absolute',
    bottom: 12,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ffd9ec',
  },
  progressInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
  },
  counterText: {
    color: '#ffb3d9',
    fontSize: 13.5,
    fontFamily: 'SFRounded-Medium',
    fontVariant: ['tabular-nums'],
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flexShrink: 1,
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SFRounded-Medium',
    flexShrink: 1,
  },
  reviewBox: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 22,
    paddingHorizontal: 8,
    alignSelf: 'stretch',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  reviewQuote: {
    color: '#f2f2f2',
    fontSize: 21,
    fontFamily: 'SFRounded-Medium',
    textAlign: 'center',
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  reviewName: {
    color: '#777',
    fontSize: 13.5,
    fontFamily: 'SFRounded-Regular',
  },
  proEyebrow: {
    color: '#FF2D95',
    fontSize: 10.5,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  featuresList: {
    alignSelf: 'stretch',
    paddingHorizontal: 6,
  },
  featRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  featIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#26262c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featLabel: {
    color: '#ddd',
    fontSize: 15,
    fontFamily: 'SFRounded-Regular',
    lineHeight: 20,
    flexShrink: 1,
  },
  resultGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: GRID_GUTTER,
    width: TILE_W * 2 + GRID_GUTTER,
  },
  resultTile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#161616',
  },
  resultTileImage: {
    width: '100%',
    height: '100%',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  readyTitle: {
    marginTop: 18,
    color: '#fff',
    fontSize: 24,
    fontFamily: 'SFRounded-Medium',
    textAlign: 'center',
  },
  failWrap: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  failTitle: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'SFRounded-Medium',
    textAlign: 'center',
  },
  failSubtitle: {
    color: '#888',
    fontSize: 15,
    fontFamily: 'SFRounded-Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryText: {
    color: '#000',
    fontSize: 15,
    fontFamily: 'SFRounded-Medium',
  },
  changePhotosButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  changePhotosText: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'SFRounded-Medium',
    textDecorationLine: 'underline',
  },
});
