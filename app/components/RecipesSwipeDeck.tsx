import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Images } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { PublicRecipe } from '../../lib/recipes/supabaseRecipes';

const ROUNDED_FONT = 'SFRounded-Medium';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const LOG = true;
const t0 = Date.now();
function log(...args: any[]) {
  if (!LOG) return;
  const dt = String(Date.now() - t0).padStart(6, ' ');
  console.log(`[SwipeDeck +${dt}ms]`, ...args);
}

const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.86);
const DEFAULT_IMAGE_HEIGHT = Math.round(CARD_WIDTH * 4 / 3);
const MIN_IMAGE_HEIGHT = 220;
const MAX_IMAGE_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);
const CARD_RADIUS = 80;
const DISMISS_DISTANCE = SCREEN_WIDTH * 0.28;
const DISMISS_VELOCITY = 800;
const FLY_OUT_MS = 280;
const OFFSCREEN = SCREEN_WIDTH * 1.4;
const PEEK_REVEAL_DISTANCE = SCREEN_WIDTH * 0.32;
const FADE_OUT_DISTANCE = SCREEN_WIDTH * 0.55;

function clampImageHeight(h: number): number {
  return Math.round(Math.min(Math.max(h, MIN_IMAGE_HEIGHT), MAX_IMAGE_HEIGHT));
}

function imageHeightForRecipe(recipe: PublicRecipe): number {
  const aspect = recipe.recipe_data.steps?.[0]?.aspectRatio;
  if (aspect) {
    const [w, h] = aspect.split(':').map(Number);
    if (w && h) return clampImageHeight(CARD_WIDTH * (h / w));
  }
  return DEFAULT_IMAGE_HEIGHT;
}

interface Props {
  recipes: PublicRecipe[];
  topInset: number;
  bottomInset: number;
  onPressRecipe: (recipe: PublicRecipe) => void;
  onLongPressRecipe?: (recipe: PublicRecipe) => void;
}

export default function RecipesSwipeDeck({
  recipes,
  topInset,
  bottomInset,
  onPressRecipe,
  onLongPressRecipe,
}: Props) {
  const [index, setIndex] = useState(0);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  useEffect(() => {
    setIndex(0);
    tx.value = 0;
    ty.value = 0;
  }, [recipes.length, tx, ty]);

  const current = recipes[index % Math.max(recipes.length, 1)];

  const currentRef = useRef<PublicRecipe | null>(current ?? null);
  useEffect(() => { currentRef.current = current ?? null; }, [current]);

  useLayoutEffect(() => {
    if (!current) return;
    log('useLayoutEffect — current=', current.id.slice(0, 8), 'tx=', tx.value.toFixed(0), 'ty=', ty.value.toFixed(0));
    if (tx.value === 0 && ty.value === 0) return;
    tx.value = 0;
    ty.value = 0;
  }, [current?.id, tx, ty]);

  const advance = useCallback(() => {
    if (recipes.length === 0) return;
    log('advance() called');
    setIndex((i) => {
      const next = (i + 1) % recipes.length;
      log('advance: index', i, '->', next);
      return next;
    });
  }, [recipes.length]);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onPressRecipeRef = useRef(onPressRecipe);
  useEffect(() => { onPressRecipeRef.current = onPressRecipe; }, [onPressRecipe]);
  const onLongPressRecipeRef = useRef(onLongPressRecipe);
  useEffect(() => { onLongPressRecipeRef.current = onLongPressRecipe; }, [onLongPressRecipe]);

  const handlePressActive = useCallback(() => {
    const r = currentRef.current;
    if (r) onPressRecipeRef.current(r);
  }, []);

  const handleLongPressActive = useCallback(() => {
    const r = currentRef.current;
    if (r && onLongPressRecipeRef.current) onLongPressRecipeRef.current(r);
  }, []);

  // Pre-warm the cache for upcoming recipes.
  useEffect(() => {
    if (recipes.length === 0) return;
    const urls = [
      recipes[(index + 1) % recipes.length]?.example_result_url,
      recipes[(index + 2) % recipes.length]?.example_result_url,
      recipes[(index + 3) % recipes.length]?.example_result_url,
    ].filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length > 0) Image.prefetch(urls).catch(() => {});
  }, [index, recipes]);

  const dist = useDerivedValue(() => Math.sqrt(tx.value * tx.value + ty.value * ty.value));

  // ── Composed stage-level gestures (built ONCE, stable across renders) ──────

  const composedGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(8)
      .onBegin(() => runOnJS(log)('pan onBegin'))
      .onStart(() => runOnJS(log)('pan onStart'))
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = e.translationY;
      })
      .onEnd((e) => {
        const dx = e.translationX;
        const dy = e.translationY;
        const d = Math.sqrt(dx * dx + dy * dy);
        const fast = Math.abs(e.velocityX) > DISMISS_VELOCITY || Math.abs(e.velocityY) > DISMISS_VELOCITY;

        if (d > DISMISS_DISTANCE || fast) {
          const angle = d > 1 ? Math.atan2(dy, dx) : (dx >= 0 ? 0 : Math.PI);
          const targetX = Math.cos(angle) * OFFSCREEN;
          const targetY = Math.sin(angle) * OFFSCREEN;
          const opts = { duration: FLY_OUT_MS, easing: Easing.out(Easing.cubic) };
          runOnJS(triggerHaptic)();
          runOnJS(log)('pan onEnd — DISMISS, dist=', d.toFixed(0));
          tx.value = withTiming(targetX, opts, (done) => {
            if (done) {
              runOnJS(log)('  withTiming(tx) complete — calling advance');
              runOnJS(advance)();
            }
          });
          ty.value = withTiming(targetY, opts);
        } else {
          runOnJS(log)('pan onEnd — RECOVER, dist=', d.toFixed(0));
          tx.value = withSpring(0, { damping: 18, stiffness: 220 });
          ty.value = withSpring(0, { damping: 18, stiffness: 220 });
        }
      })
      .onFinalize(() => runOnJS(log)('pan onFinalize'));

    const tap = Gesture.Tap()
      .maxDuration(250)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) runOnJS(handlePressActive)();
      });

    const longPress = Gesture.LongPress()
      .minDuration(500)
      .maxDistance(10)
      .onStart(() => runOnJS(handleLongPressActive)());

    return Gesture.Race(pan, longPress, tap);
    // No deps: gesture references are stable refs (shared values, refs, useCallback with empty deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute the visible card stack: active (slot 0), peek (slot 1), preload (slot 2).
  const visibleSlots = useMemo(() => {
    if (recipes.length === 0) return [] as { recipe: PublicRecipe; slot: number }[];
    const slots: { recipe: PublicRecipe; slot: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = recipes[(index + i) % recipes.length];
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      slots.push({ recipe: r, slot: i });
    }
    return slots;
  }, [recipes, index]);

  if (recipes.length === 0 || !current) return null;

  // Render order: highest slot (preload) first (bottom), slot 0 (active) last (top).
  const renderOrder = [...visibleSlots].sort((a, b) => b.slot - a.slot);

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={[styles.stage, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        {renderOrder.map(({ recipe, slot }) => (
          <CardSlot
            key={recipe.id}
            recipe={recipe}
            slot={slot}
            tx={tx}
            ty={ty}
            dist={dist}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

// ── A single card. Each owns its OWN useAnimatedStyle (no cross-component
//    style sharing — that was breaking gesture/style binding on slot moves). ─

const CardSlot = memo(function CardSlot({
  recipe,
  slot,
  tx,
  ty,
  dist,
}: {
  recipe: PublicRecipe;
  slot: number;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  dist: SharedValue<number>;
}) {
  useEffect(() => {
    log(`CardSlot MOUNT  slot=${slot} recipe=${recipe.id.slice(0, 8)}`);
    return () => log(`CardSlot UNMOUNT recipe=${recipe.id.slice(0, 8)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    log(`CardSlot ROLE slot=${slot} recipe=${recipe.id.slice(0, 8)} title="${recipe.recipe_data.name?.slice(0, 30)}"`);
  }, [slot, recipe.id, recipe.recipe_data.name]);

  // slot is read inside the worklet via deps array so the style re-binds when
  // a card moves to a different slot.
  const animatedStyle = useAnimatedStyle(() => {
    if (slot === 0) {
      const rotZ = (tx.value / SCREEN_WIDTH) * 12;
      const opacity = interpolate(
        dist.value,
        [0, FADE_OUT_DISTANCE, OFFSCREEN],
        [1, 0.5, 0],
        Extrapolation.CLAMP,
      );
      return {
        opacity,
        transform: [
          { translateX: tx.value },
          { translateY: ty.value },
          { rotateZ: `${rotZ}deg` },
        ],
      };
    }
    if (slot === 1) {
      const progress = interpolate(
        dist.value,
        [0, PEEK_REVEAL_DISTANCE],
        [0, 1],
        Extrapolation.CLAMP,
      );
      return {
        transform: [{ scale: 0.92 + progress * 0.08 }],
        opacity: 0.15 + progress * 0.85,
      };
    }
    // slot 2 (preload): invisible but its Image is still mounted/decoded.
    return { opacity: 0 };
  }, [slot]);

  return (
    <Animated.View style={[styles.cardCentered, animatedStyle]} pointerEvents="none">
      <DeckCard recipe={recipe} showTitle={slot === 0} />
    </Animated.View>
  );
});

// ── DeckCard: pure visual. Image source is bound to this card's recipe and
//    never changes (each card is keyed by recipe.id in the parent). ─────────

const DeckCard = memo(function DeckCard({
  recipe,
  showTitle,
}: {
  recipe: PublicRecipe;
  showTitle: boolean;
}) {
  const role = showTitle ? 'active' : 'peek  ';

  const handleImageLoad = useCallback((event: any) => {
    const { width, height } = event.source ?? {};
    log(`Image onLoad ${role} recipe=${recipe.id.slice(0, 8)} dims=${width}x${height}`);
  }, [recipe.id, role]);

  const totalImages = recipe.recipe_data.steps.reduce((total, step) => {
    const numImages = step.numImages || 1;
    const numPrompts = step.prompts?.length || 1;
    const modelIds = step.modelIds || (step.modelId ? [step.modelId] : []);
    const numModels = modelIds.length || 1;
    return total + numImages * numPrompts * numModels;
  }, 0);

  const imageHeight = imageHeightForRecipe(recipe);

  return (
    <View style={styles.card}>
      <View style={[styles.imageWrap, { height: imageHeight }]}>
        {recipe.example_result_url ? (
          <Image
            source={{ uri: recipe.example_result_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            onLoad={handleImageLoad}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        {totalImages > 1 ? (
          <View style={styles.imageCountBadge}>
            <Text style={styles.imageCountText}>{totalImages}</Text>
            <Images size={12} color="#fff" strokeWidth={2} />
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.title, !showTitle && styles.titleHidden]}
        numberOfLines={2}
      >
        {recipe.recipe_data.name}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCentered: {
    position: 'absolute',
    left: (SCREEN_WIDTH - CARD_WIDTH) / 2,
    top: 0,
    bottom: 0,
    width: CARD_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: CARD_WIDTH,
    alignItems: 'center',
  },
  imageWrap: {
    width: CARD_WIDTH,
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  placeholder: { backgroundColor: '#0d0d0d' },
  title: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 22,
    fontWeight: '500',
    lineHeight: 26,
    height: 52,
    marginTop: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  titleHidden: {
    opacity: 0,
  },
  imageCountBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  imageCountText: {
    fontSize: 12,
    fontFamily: 'Manrope-Bold',
    color: '#fff',
  },
});
