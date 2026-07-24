/**
 * LabOnboardingModal - Premium onboarding experience for Lab variant
 *
 * Award-winning design inspired by Linear, Notion, Arc
 * Features: Full-screen paged slides, elegant animations
 * Color scheme: Yellow accent (#FF2D95) + greyscale
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  Image,
  ActivityIndicator,
  InteractionManager,
  Alert,
  Linking,
  Platform,
  AppState,
  AppStateStatus,
  useWindowDimensions,
} from 'react-native';

import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as StoreReview from 'expo-store-review';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Aya uses RevenueCat, not Adapty — swap CS's inline Adapty paywall for Aya's
// RevenueCat OnboardingPaywallModal (identical visible/onClose props).
import OnboardingPaywallModal from './OnboardingPaywallModal';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { getATTStatus, requestATT } from '../../lib/att';
import { setFBAdvertiserTracking } from '../../lib/facebook';
import { getScreenWidth, WEB_MAX_WIDTH } from '../../lib/webLayout';
import { showAlert as showWebAlert, showConfirm } from '../../lib/utils/webAlert';
import { promptAIConsentDialog, persistAIConsent } from '../../lib/ai/aiConsent';

import {
  ChevronRight,
  ArrowRight,
  Cloud,
  Heart,
  Share2,
  Briefcase,
  Sparkles,
  PenTool,
  Compass,
  Images,
  Check,
  Star,
  Flame,
  Sun,
  Smile,
  User,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Carousel from 'react-native-reanimated-carousel';
import { useVideoPlayer, VideoView } from 'expo-video';
import { capturePH } from '../../lib/posthog';
import { getAppConfigBool } from '../../lib/remoteConfig';
import { setCreatorAccess } from '../../lib/creatorAccess';
import * as Haptics from 'expo-haptics';
import { getLocales } from 'expo-localization';
import {
  getHardPaywallFlowConfig,
  getHardPaywallAdminOverride,
  DEFAULT_HARD_PAYWALL_FLOW_CONFIG,
  HARD_PAYWALL_PENDING_KEY,
  HARD_PAYWALL_PREVIEW_KEY,
  type HardPaywallFlowConfig,
} from '../../lib/hardPaywallFlow/config';
import ChoosePhotoStep, { type ChosenReferencePhoto } from './onboarding/ChoosePhotoStep';
import OnboardingGenerationStep from './onboarding/OnboardingGenerationStep';
import { useOnboardingGeneration } from '../hooks/useOnboardingGeneration';
import { browsePublicRecipes, type PublicRecipe } from '../../lib/recipes/supabaseRecipes';
import { queueManager } from '../../lib/queue/queueManager';
import { convertImageToBase64 } from '../../lib/replicate/client';
import { downloadMediaToCache } from '../../lib/utils/imageDownloader';
import { useSouls } from '../../contexts/SoulsContext';
import { useSelfieValidation, type ValidationResult } from '../hooks/useSelfieValidation';
import { ensureAssetsLocal } from '../../lib/picker/pickWithProcessing';
import { useGeneration } from '../hooks/useGeneration';
import { useLibrary, type LibraryImage } from '../../contexts/LibraryContext';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';

// Width is capped to a phone-like column on web (lib/webLayout) — all slide,
// paging, and grid math derives from it, so the cap propagates everywhere.
const SCREEN_WIDTH = getScreenWidth();
const SCREEN_HEIGHT = Dimensions.get('window').height;
// 75% on tall phones, but leave at least 260pt for text + controls
const GALLERY_HEIGHT = Math.round(Math.min(SCREEN_HEIGHT * 0.75, SCREEN_HEIGHT - 260));
// NOTE: SCREEN_HEIGHT above is frozen at bundle load. On web the window can
// resize after load (toolbars, user resizing), so anything that adapts to
// viewport height must read useWindowDimensions().height instead.

// ── Gallery style toggle ──
// false = original 2-row horizontal scroll grid
// true  = card stack / fan carousel (center card + peeking side cards)
const USE_CARD_STACK_GALLERY = true;

// App accent color
const YELLOW = '#FF2D95';
const YELLOW_DIM = 'rgba(255, 45, 149, 0.15)';

interface LabOnboardingModalProps {
  visible: boolean;
  onComplete: () => void;
}

interface OnboardingSlide {
  id: string;
  // i18n keys resolved with t() at render time. subtitleKey is empty for
  // slides without a subtitle.
  titleKey: string;
  subtitleKey: string;
  visualHint: string;
}

// Character images for soul grid (with transparent backgrounds)
const CHARACTER_IMAGES = [
  { image: require('../../assets/onboarding/characters/IMG_8691.png'), delay: 0 },
  { image: require('../../assets/onboarding/characters/IMG_8692.png'), delay: 80 },
  { image: require('../../assets/onboarding/characters/IMG_8693.png'), delay: 160 },
  { image: require('../../assets/onboarding/characters/IMG_8694.png'), delay: 240 },
  { image: require('../../assets/onboarding/characters/IMG_8695.png'), delay: 320 },
];

// Recipe slideshow images with dimensions and display size based on orientation
const RECIPE_IMAGES = [
  { name: 'Mixed-media style', image: require('../../assets/onboarding/community/mixed-media.jpg'), width: 448, height: 600, displayHeight: 240 },
  { name: 'Fisheye selfies', image: require('../../assets/onboarding/community/fisheye-selfies.jpg'), width: 600, height: 600, displayHeight: 200 },
  { name: 'MacBook Selfie', image: require('../../assets/onboarding/community/macbook-selfie.jpg'), width: 330, height: 600, displayHeight: 260 },
  { name: 'ASCII energy', image: require('../../assets/onboarding/community/ascii-energy.jpg'), width: 446, height: 600, displayHeight: 240 },
  { name: 'Iridescent icons', image: require('../../assets/onboarding/community/iridescent-icons.jpg'), width: 893, height: 600, displayHeight: 180 },
];

function RecipeSlideshow() {
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');
  const [slotAIndex, setSlotAIndex] = useState(0);
  const [slotBIndex, setSlotBIndex] = useState(1);
  const opacityA = useRef(new Animated.Value(1)).current;
  const opacityB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeSlot === 'A') {
        // Fade to B
        const nextIdx = (slotAIndex + 1) % RECIPE_IMAGES.length;
        setSlotBIndex(nextIdx);

        Animated.parallel([
          Animated.timing(opacityA, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(opacityB, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start(() => {
          setActiveSlot('B');
        });
      } else {
        // Fade to A
        const nextIdx = (slotBIndex + 1) % RECIPE_IMAGES.length;
        setSlotAIndex(nextIdx);

        Animated.parallel([
          Animated.timing(opacityB, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(opacityA, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start(() => {
          setActiveSlot('A');
        });
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeSlot, slotAIndex, slotBIndex, opacityA, opacityB]);

  const recipeA = RECIPE_IMAGES[slotAIndex];
  const recipeB = RECIPE_IMAGES[slotBIndex];

  const aspectRatioA = recipeA.width / recipeA.height;
  const displayWidthA = recipeA.displayHeight * aspectRatioA;

  const aspectRatioB = recipeB.width / recipeB.height;
  const displayWidthB = recipeB.displayHeight * aspectRatioB;

  return (
    <View style={styles.recipeSlideshowContainer}>
      {/* Slot A */}
      <Animated.View style={[styles.recipeSlideshowCard, { opacity: opacityA }]}>
        <Image
          source={recipeA.image}
          style={[styles.recipeSlideshowImage, { width: displayWidthA, height: recipeA.displayHeight }]}
          resizeMode="cover"
        />
        <Text style={styles.recipeSlideshowLabel}>{recipeA.name}</Text>
      </Animated.View>

      {/* Slot B */}
      <Animated.View style={[styles.recipeSlideshowCard, styles.recipeSlideshowOverlay, { opacity: opacityB }]}>
        <Image
          source={recipeB.image}
          style={[styles.recipeSlideshowImage, { width: displayWidthB, height: recipeB.displayHeight }]}
          resizeMode="cover"
        />
        <Text style={styles.recipeSlideshowLabel}>{recipeB.name}</Text>
      </Animated.View>
    </View>
  );
}

// Gallery: 2 rows of 8 vertical portrait images from community covers
// Resized to 360px wide (~698KB total for 16 images)
const TILE_WIDTH = 150;
const TILE_GAP = 10;

type GalleryTile = { source: any; height: number };

// Row 1: 8 diverse portrait images (height scaled for 150px tile width)
const GALLERY_ROW_1: GalleryTile[] = [
  { source: require('../../assets/onboarding/gallery/dior-editorial.jpg'), height: 225 },
  { source: require('../../assets/onboarding/gallery/night-out.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/pixel-art-selfie.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/puffer-jacket.jpg'), height: 225 },
  { source: require('../../assets/onboarding/gallery/fur-coat-film-portrait.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/sporty.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/mixed-media-style.jpg'), height: 269 },
  { source: require('../../assets/onboarding/gallery/tokyo-payphone.jpg'), height: 225 },
];
// Row 2: 8 different portrait images
const GALLERY_ROW_2: GalleryTile[] = [
  { source: require('../../assets/onboarding/gallery/bw-chair-photoshoot.jpg'), height: 225 },
  { source: require('../../assets/onboarding/gallery/res-halo-portrait.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/tulip-fashion.jpg'), height: 225 },
  { source: require('../../assets/onboarding/gallery/soft-studio-portrait.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/editorial-on-stool.jpg'), height: 244 },
  { source: require('../../assets/onboarding/gallery/high-contrast-portrait.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/outdoor-portrait.jpg'), height: 266 },
  { source: require('../../assets/onboarding/gallery/soft-turn.jpg'), height: 269 },
];

// Width of one full set of 8 tiles + gaps
const ROW_SET_WIDTH = (TILE_WIDTH + TILE_GAP) * 8;

function GalleryRow({ tiles, startOffset, align, speed, reverse }: {
  tiles: GalleryTile[];
  startOffset: number;
  align: 'flex-start' | 'flex-end';
  speed: number; // pixels per second
  reverse: boolean;
}) {
  const translateX = useSharedValue(0);

  useFrameCallback((frameInfo) => {
    const dt = (frameInfo.timeSincePreviousFrame ?? 16) / 1000;
    if (reverse) {
      translateX.value += speed * dt;
      if (translateX.value >= 0) {
        translateX.value -= ROW_SET_WIDTH;
      }
    } else {
      translateX.value -= speed * dt;
      if (translateX.value <= -ROW_SET_WIDTH) {
        translateX.value += ROW_SET_WIDTH;
      }
    }
  });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Reanimated.View style={[styles.imageGalleryRow, { marginLeft: startOffset, alignItems: align }, rowStyle]}>
      {[...tiles, ...tiles].map((tile, i) => (
        <View key={i} style={[styles.imageGalleryCard, { height: tile.height }]}>
          <Image
            source={tile.source}
            style={styles.imageGalleryCardImage}
            resizeMode="cover"
          />
        </View>
      ))}
    </Reanimated.View>
  );
}

function ImageGalleryGrid({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const containerOpacity = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      containerOpacity.value = 0;
      containerOpacity.value = withTiming(1, { duration: 800 });
    }
  }, [isActive]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Reanimated.View style={[styles.imageGalleryContainer, containerStyle]}>
      <View style={styles.imageGalleryInner}>
        <GalleryRow tiles={GALLERY_ROW_1} startOffset={-60} align="flex-end" speed={32} reverse={false} />
        <GalleryRow tiles={GALLERY_ROW_2} startOffset={-100} align="flex-start" speed={36} reverse={true} />
      </View>
      <LinearGradient
        colors={['#0a0a0a', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.imageGalleryEdgeTop}
      />
      <View style={styles.socialProofBadge}>
        <Text style={styles.socialProofText}>{t('onboarding.lab.socialProofGenerations')}</Text>
      </View>
      <LinearGradient
        colors={['transparent', '#0a0a0a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.imageGalleryEdgeBottom}
      />
    </Reanimated.View>
  );
}

// ── Card Stack / Fan gallery (center card + peeking side cards) ──
const STACK_IMAGES = [
  ...GALLERY_ROW_1.map(t => t.source),
  ...GALLERY_ROW_2.map(t => t.source),
];
const STACK_N = STACK_IMAGES.length;
const STACK_CARD_W = Math.round(SCREEN_WIDTH * 0.68);
const STACK_CARD_H = Math.round(STACK_CARD_W * 1.42);
const STACK_SIDE_OFFSET = STACK_CARD_W * 0.62;
const STACK_INTERVAL = 1600;
const STACK_TRANSITION = 350;

// Slot positions: -2 (far left) → 0 (center) → +2 (far right)
const SLOT_X     = [-SCREEN_WIDTH * 0.72, -STACK_SIDE_OFFSET, 0, STACK_SIDE_OFFSET, SCREEN_WIDTH * 0.72];
const SLOT_ROT   = [12, 6, 0, -6, -12];
const SLOT_SCALE = [0.75, 0.9, 1, 0.9, 0.75];

// Each card permanently owns one image. Position is computed entirely
// on the UI thread from a continuous offset — no snap-back, no blink.
function StackCard({ imageIndex, source, offset }: {
  imageIndex: number;
  source: any;
  offset: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    let slot = imageIndex - offset.value;
    // Wrap into -N/2 … +N/2 for ring behavior
    if (slot > STACK_N / 2) slot -= STACK_N;
    if (slot < -STACK_N / 2) slot += STACK_N;

    const idx = slot + 2;
    const tx = interpolate(idx, [0, 1, 2, 3, 4], SLOT_X, Extrapolation.CLAMP);
    const rot = interpolate(idx, [0, 1, 2, 3, 4], SLOT_ROT, Extrapolation.CLAMP);
    const sc = interpolate(idx, [0, 1, 2, 3, 4], SLOT_SCALE, Extrapolation.CLAMP);

    // Asymmetric z-index: incoming cards (right / positive slot) always stay
    // above outgoing cards (left / negative slot). This prevents z-fighting
    // at the midpoint where both cards would otherwise share the same z.
    const z = slot >= 0
      ? Math.round(100 - slot * 20)   // center=100, right peek=80, far right=60
      : Math.round(50 + slot * 10);   // left peek=40, far left=30

    // Smooth fade at edges instead of hard cutoff — no pop when cards enter/exit
    const cardOpacity = interpolate(
      Math.abs(slot),
      [2, 2.8],
      [1, 0],
      Extrapolation.CLAMP,
    );

    return {
      transform: [
        { translateX: tx },
        { rotate: `${rot}deg` },
        { scale: sc },
      ],
      zIndex: z,
      opacity: cardOpacity,
    };
  });

  return (
    <Reanimated.View style={[styles.stackCard, style]}>
      <Image source={source} style={styles.stackCardImage} resizeMode="cover" />
    </Reanimated.View>
  );
}

function CardStackGallery({ isActive }: { isActive: boolean }) {
  const offset = useSharedValue(0); // continuously increments: 0 → 1 → 2 → …
  const containerOpacity = useSharedValue(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isActive) {
      containerOpacity.value = 0;
      containerOpacity.value = withTiming(1, { duration: 600 });
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    let step = 0;
    intervalRef.current = setInterval(() => {
      step += 1;
      offset.value = withTiming(step, {
        duration: STACK_TRANSITION,
        easing: Easing.out(Easing.cubic),
      });
    }, STACK_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive]);

  const outerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Reanimated.View style={[styles.stackContainer, outerStyle]}>
      {STACK_IMAGES.map((source, i) => (
        <StackCard key={i} imageIndex={i} source={source} offset={offset} />
      ))}
    </Reanimated.View>
  );
}

// Model cards with staggered animation and geometric logos
const MODEL_CARDS = [
  { name: 'NanoBanana Pro', price: '$0.15', shape: 'circle', color: '#FF2D95', delay: 100 },
  { name: 'Flux 2 Pro', price: '$0.05', shape: 'square', color: '#8B5CF6', delay: 200 },
  { name: 'Seedream 4.5', price: '$0.03', shape: 'diamond', color: '#10B981', delay: 300 },
  { name: 'REVE', price: '$0.04', shape: 'triangle', color: '#F43F5E', delay: 400 },
  { name: 'Recraft V3', price: '$0.08', shape: 'hexagon', color: '#3B82F6', delay: 500 },
  { name: 'Kling 2.6', price: '$0.10', shape: 'circle', color: '#F97316', delay: 600 },
];

function GeometricLogo({ shape, color, size }: { shape: string; color: string; size: number }) {
  const halfSize = size / 2;

  switch (shape) {
    case 'circle':
      return (
        <View style={[styles.geoLogo, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
      );
    case 'square':
      return (
        <View style={[styles.geoLogo, { width: size * 0.8, height: size * 0.8, borderRadius: 4, backgroundColor: color }]} />
      );
    case 'diamond':
      return (
        <View style={[styles.geoLogo, { width: size * 0.7, height: size * 0.7, backgroundColor: color, transform: [{ rotate: '45deg' }], borderRadius: 4 }]} />
      );
    case 'triangle':
      return (
        <View style={[styles.geoLogoTriangle, {
          borderLeftWidth: halfSize * 0.8,
          borderRightWidth: halfSize * 0.8,
          borderBottomWidth: size * 0.8,
          borderBottomColor: color,
        }]} />
      );
    case 'hexagon':
      return (
        <View style={[styles.geoLogo, { width: size * 0.85, height: size * 0.75, backgroundColor: color, borderRadius: 6 }]} />
      );
    default:
      return (
        <View style={[styles.geoLogo, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
      );
  }
}

function ModelCardsAnimation({ isActive }: { isActive: boolean }) {
  const cardAnimations = useRef(MODEL_CARDS.map(() => new Animated.Value(0))).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const interactionRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    interactionRef.current?.cancel();

    if (isActive) {
      // Reset animations
      cardAnimations.forEach(anim => anim.setValue(0));

      // Wait for interactions (app init, navigation, etc.) to complete before animating
      interactionRef.current = InteractionManager.runAfterInteractions(() => {
        // Staggered card appearance
        MODEL_CARDS.forEach((model, index) => {
          const timeout = setTimeout(() => {
            Animated.spring(cardAnimations[index], {
              toValue: 1,
              tension: 100,
              friction: 8,
              useNativeDriver: true,
            }).start();
          }, model.delay);
          timeoutsRef.current.push(timeout);
        });
      });
    }

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      interactionRef.current?.cancel();
    };
  }, [isActive, cardAnimations]);

  const topRow = MODEL_CARDS.slice(0, 3);
  const bottomRow = MODEL_CARDS.slice(3);

  const renderCard = (model: typeof MODEL_CARDS[0], index: number, verticalOffset: number) => (
    <Animated.View
      key={model.name}
      style={[
        styles.mockCard,
        {
          transform: [
            { translateY: verticalOffset },
            { scale: cardAnimations[index] },
          ],
          opacity: cardAnimations[index],
        },
      ]}
    >
      <View style={styles.mockCardImageContainer}>
        <GeometricLogo shape={model.shape} color={model.color} size={34} />
      </View>
      <Text style={styles.mockCardText}>{model.name}</Text>
      {/* Coin price hidden — may re-enable later
      <View style={styles.mockCardPrice}>
        <Text style={styles.mockCardPriceText}>{model.price}</Text>
      </View>
      */}
    </Animated.View>
  );

  return (
    <View>
      <View style={styles.mockCardsContainer}>
        {topRow.map((model, i) => renderCard(model, i, i % 2 === 1 ? 8 : 0))}
      </View>
      <View style={styles.mockCardsRow2}>
        {bottomRow.map((model, i) => renderCard(model, i + 3, i % 2 === 0 ? 6 : 0))}
      </View>
    </View>
  );
}

// Model comparison gallery with loading animation
const COMPARE_MODELS = [
  { name: 'Flux2 Pro', image: require('../../assets/onboarding/flux-new.jpg'), delay: 800 },
  { name: 'Seedream 4.5', image: require('../../assets/onboarding/cdream-4.5.jpg'), delay: 1200 },
  { name: 'Nano Banana Pro', image: require('../../assets/onboarding/flux2-pro.jpg'), delay: 1600 },
  { name: 'Reva Create', image: require('../../assets/onboarding/reva-create.jpg'), delay: 2000 },
];

function ModelCompareGallery({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const blurAnimations = useRef(COMPARE_MODELS.map(() => new Animated.Value(1))).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    // Clear any existing timeouts
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    if (isActive) {
      // Reset state
      setLoadedImages(new Set());
      blurAnimations.forEach(anim => anim.setValue(1));

      // Start staggered loading animations
      COMPARE_MODELS.forEach((model, index) => {
        const timeout = setTimeout(() => {
          // Fade out blur
          Animated.timing(blurAnimations[index], {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            setLoadedImages(prev => new Set([...prev, index]));
          });
        }, model.delay);
        timeoutsRef.current.push(timeout);
      });
    }

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [isActive, blurAnimations]);

  const leftColumn = [COMPARE_MODELS[0], COMPARE_MODELS[2]];
  const rightColumn = [COMPARE_MODELS[1], COMPARE_MODELS[3]];
  const leftIndices = [0, 2];
  const rightIndices = [1, 3];

  const renderImage = (model: typeof COMPARE_MODELS[0], index: number) => {
    const isLoaded = loadedImages.has(index);

    return (
      <View key={model.name} style={styles.galleryGridItem}>
        <View style={styles.galleryImageContainer}>
          <Image source={model.image} style={styles.galleryGridImage} blurRadius={isLoaded ? 0 : 20} />
          <Animated.View
            style={[
              styles.galleryLoadingOverlay,
              { opacity: blurAnimations[index] }
            ]}
          >
            <ActivityIndicator size="small" color={YELLOW} />
          </Animated.View>
        </View>
        <View style={styles.galleryLabel}>
          <Text style={styles.galleryLabelText}>{model.name}</Text>
        </View>
      </View>
    );
  };

  return (
    <View>
      <View style={styles.promptBubble}>
        <Text style={styles.promptText} numberOfLines={2}>{t('onboarding.lab.comparePrompt')}</Text>
      </View>
      <View style={styles.galleryGrid}>
        <View style={styles.galleryColumn}>
          {leftColumn.map((model, i) => renderImage(model, leftIndices[i]))}
        </View>
        <View style={[styles.galleryColumn, { transform: [{ translateY: 8 }] }]}>
          {rightColumn.map((model, i) => renderImage(model, rightIndices[i]))}
        </View>
      </View>
    </View>
  );
}

// Cloud sync history items with loading animation
const CLOUD_HISTORY = [
  { title: 'gym girl', prompt: 'selfie of young girl 28 years in hi end minimalistic gym, reformers...', delay: 600 },
  { title: 'girl in elevator', prompt: 'cinematic portrait, mirror selfie in luxury elevator...', delay: 1000 },
  { title: '3d letters', prompt: 'glossy 3d typography, floating chrome letters...', delay: 1400 },
  { title: 'realistic selfie', prompt: 'realistic iphone selfie in a mirror, berlin apartment...', delay: 1800 },
];

function CloudSyncAnimation({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [syncedItems, setSyncedItems] = useState<Set<number>>(new Set());
  // Animation value: 0 = skeleton, 1 = text visible
  const contentAnimations = useRef(CLOUD_HISTORY.map(() => new Animated.Value(0))).current;
  const syncAnimations = useRef(CLOUD_HISTORY.map(() => new Animated.Value(0))).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    // Clear any existing timeouts
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    if (isActive) {
      // Reset state
      setSyncedItems(new Set());
      contentAnimations.forEach(anim => anim.setValue(0));
      syncAnimations.forEach(anim => anim.setValue(0));

      // Start staggered loading animations
      CLOUD_HISTORY.forEach((item, index) => {
        // Crossfade from skeleton to text
        const textTimeout = setTimeout(() => {
          Animated.timing(contentAnimations[index], {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }).start();
        }, item.delay);
        timeoutsRef.current.push(textTimeout);

        // Then: sync to cloud (after text loads)
        const syncTimeout = setTimeout(() => {
          Animated.timing(syncAnimations[index], {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            setSyncedItems(prev => new Set([...prev, index]));
          });
        }, item.delay + 500);
        timeoutsRef.current.push(syncTimeout);
      });
    }

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [isActive, contentAnimations, syncAnimations]);

  return (
    <View style={styles.historyContainer}>
      {CLOUD_HISTORY.map((item, i) => {
        const isSynced = syncedItems.has(i);

        // Interpolate for crossfade effect
        const skeletonOpacity = contentAnimations[i].interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        });
        const textOpacity = contentAnimations[i];
        const isLoading = !isSynced;

        return (
          <View key={i} style={styles.historyCard}>
            <View style={styles.historyContent}>
              {/* Skeleton - fades out */}
              <Animated.View style={[styles.skeletonContainer, { opacity: skeletonOpacity }]}>
                <View style={styles.skeletonTitle} />
                <View style={styles.skeletonPrompt} />
              </Animated.View>
              {/* Text content - fades in */}
              <Animated.View style={[styles.textContainer, { opacity: textOpacity }]}>
                <Text style={styles.historyTitle}>{t(`onboarding.lab.cloudHistory.${i}.title`)}</Text>
                <Text style={styles.historyPrompt} numberOfLines={1}>{t(`onboarding.lab.cloudHistory.${i}.prompt`)}</Text>
              </Animated.View>
            </View>
            {/* Sync status indicator */}
            <View style={styles.syncedBadge}>
              {isLoading ? (
                <ActivityIndicator size="small" color={YELLOW} style={{ transform: [{ scale: 0.6 }] }} />
              ) : (
                <Animated.View style={{ opacity: syncAnimations[i] }}>
                  <Cloud size={10} color={YELLOW} strokeWidth={2} />
                </Animated.View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Style/recipe picker — 3-column grid with iPhone-style checkmarks
const STYLE_GALLERY = [
  { id: 'dior-editorial', name: 'Dior Editorial', source: require('../../assets/onboarding/gallery/dior-editorial.jpg') },
  { id: 'night-out', name: 'Night Out', source: require('../../assets/onboarding/gallery/night-out.jpg') },
  { id: 'pixel-art', name: 'Pixel Art Selfie', source: require('../../assets/onboarding/gallery/pixel-art-selfie.jpg') },
  { id: 'puffer-jacket', name: 'Puffer Jacket', source: require('../../assets/onboarding/gallery/puffer-jacket.jpg') },
  { id: 'fur-coat', name: 'Fur Coat Film', source: require('../../assets/onboarding/gallery/fur-coat-film-portrait.jpg') },
  { id: 'sporty', name: 'Sporty', source: require('../../assets/onboarding/gallery/sporty.jpg') },
  { id: 'mixed-media', name: 'Mixed Media', source: require('../../assets/onboarding/gallery/mixed-media-style.jpg') },
  { id: 'tokyo-payphone', name: 'Tokyo Payphone', source: require('../../assets/onboarding/gallery/tokyo-payphone.jpg') },
  { id: 'bw-chair', name: 'B&W Photoshoot', source: require('../../assets/onboarding/gallery/bw-chair-photoshoot.jpg') },
  { id: 'halo-portrait', name: 'Halo Portrait', source: require('../../assets/onboarding/gallery/res-halo-portrait.jpg') },
  { id: 'tulip-fashion', name: 'Tulip Fashion', source: require('../../assets/onboarding/gallery/tulip-fashion.jpg') },
  { id: 'soft-studio', name: 'Soft Studio', source: require('../../assets/onboarding/gallery/soft-studio-portrait.jpg') },
  { id: 'editorial-stool', name: 'Editorial', source: require('../../assets/onboarding/gallery/editorial-on-stool.jpg') },
  { id: 'high-contrast', name: 'High Contrast', source: require('../../assets/onboarding/gallery/high-contrast-portrait.jpg') },
  { id: 'outdoor', name: 'Outdoor Portrait', source: require('../../assets/onboarding/gallery/outdoor-portrait.jpg') },
];

const STYLE_GRID_GAP = 6;
const STYLE_GRID_PADDING = 20;
const STYLE_COL_COUNT = 3;
const STYLE_ITEM_WIDTH = Math.floor(
  (SCREEN_WIDTH - STYLE_GRID_PADDING * 2 - STYLE_GRID_GAP * (STYLE_COL_COUNT - 1)) / STYLE_COL_COUNT
);
const STYLE_ITEM_HEIGHT = Math.round(STYLE_ITEM_WIDTH * 1.4);

function StylePickerStep({
  selectedStyles,
  onToggleStyle,
  recipes,
  loading,
}: {
  selectedStyles: Set<string>;
  onToggleStyle: (id: string) => void;
  recipes: PublicRecipe[];
  loading: boolean;
}) {
  // Use real recipes if available, fall back to local gallery
  const useRecipes = recipes.length > 0;

  return (
    <View style={styles.stylePickerWrapper}>
      <ScrollView
        style={styles.stylePickerScroll}
        contentContainerStyle={styles.stylePickerContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        <View style={styles.stylePickerGrid}>
          {loading ? (
            // Skeleton placeholders while loading
            Array.from({ length: 9 }).map((_, i) => (
              <View key={`skel-${i}`} style={styles.stylePickerItem}>
                <View style={styles.stylePickerSkeleton}>
                  <ActivityIndicator size="small" color="#444" />
                </View>
              </View>
            ))
          ) : useRecipes ? (
            // Real recipes from Supabase
            recipes.map((recipe) => {
              const isSelected = selectedStyles.has(recipe.id);
              return (
                <TouchableOpacity
                  key={recipe.id}
                  style={styles.stylePickerItem}
                  onPress={() => onToggleStyle(recipe.id)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: recipe.example_result_url! }}
                    style={styles.stylePickerImage}
                    resizeMode="cover"
                  />
                  {/* Checkmark overlay */}
                  {isSelected && (
                    <View style={styles.stylePickerOverlay}>
                      <View style={styles.stylePickerCheckCircle}>
                        <Check size={14} color="#fff" strokeWidth={3} />
                      </View>
                    </View>
                  )}
                  {/* Unselected empty circle */}
                  {!isSelected && (
                    <View style={styles.stylePickerEmptyCircle} />
                  )}
                </TouchableOpacity>
              );
            })
          ) : (
            // Fallback to local gallery images
            STYLE_GALLERY.map((item) => {
              const isSelected = selectedStyles.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.stylePickerItem}
                  onPress={() => onToggleStyle(item.id)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={item.source}
                    style={styles.stylePickerImage}
                    resizeMode="cover"
                  />
                  {isSelected && (
                    <View style={styles.stylePickerOverlay}>
                      <View style={styles.stylePickerCheckCircle}>
                        <Check size={14} color="#fff" strokeWidth={3} />
                      </View>
                    </View>
                  )}
                  {!isSelected && (
                    <View style={styles.stylePickerEmptyCircle} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
      {/* Bottom gradient to show content continues */}
      <LinearGradient
        colors={['transparent', '#0a0a0a']}
        style={styles.stylePickerBottomGradient}
        pointerEvents="none"
      />
    </View>
  );
}

// Generation results step — stacked overlapping cards, blur → reveal after 5s
// Stack is 1.54 × card height; cap card size so the whole stack fits the
// space left after the header text and bottom CTA bar on short screens.
const GEN_STACK_MAX_H = Math.max(270, SCREEN_HEIGHT - 390);
const GEN_CARD_W = Math.min(
  Math.round(SCREEN_WIDTH * 0.52),
  Math.round(GEN_STACK_MAX_H / (1.45 * 1.54)),
);
const GEN_CARD_H = Math.round(GEN_CARD_W * 1.45);

// Center offset so the card stack is horizontally centered in the container
const GEN_CENTER_LEFT = (SCREEN_WIDTH - 40 - GEN_CARD_W) / 2;

// Stacked positions: front-center, back-left, back-right
const GENERATION_STATUS_MESSAGE_KEYS = [
  'onboarding.lab.genStatus.analyzingStyle',
  'onboarding.lab.genStatus.designingLayout',
  'onboarding.lab.genStatus.generatingStructure',
  'onboarding.lab.genStatus.preservingIdentity',
  'onboarding.lab.genStatus.mappingFeatures',
  'onboarding.lab.genStatus.buildingFoundation',
  'onboarding.lab.genStatus.developingDetails',
  'onboarding.lab.genStatus.refiningSkin',
  'onboarding.lab.genStatus.calibratingLight',
  'onboarding.lab.genStatus.adjustingShadows',
  'onboarding.lab.genStatus.enhancingBackground',
  'onboarding.lab.genStatus.composingColor',
  'onboarding.lab.genStatus.balancingContrast',
  'onboarding.lab.genStatus.sharpeningDetails',
  'onboarding.lab.genStatus.applyingStyle',
  'onboarding.lab.genStatus.reconstructingHighRes',
  'onboarding.lab.genStatus.addingHair',
  'onboarding.lab.genStatus.refiningEdges',
  'onboarding.lab.genStatus.blendingLighting',
  'onboarding.lab.genStatus.enhancingEyes',
  'onboarding.lab.genStatus.finalizingPortrait',
  'onboarding.lab.genStatus.upscaling',
  'onboarding.lab.genStatus.polishing',
  'onboarding.lab.genStatus.almostThere',
  'onboarding.lab.genStatus.momentMore',
];
const PROGRESS_BAR_WIDTH = 200;

const GEN_CARD_POSITIONS = [
  { left: GEN_CENTER_LEFT + GEN_CARD_W * 0.08,  top: -GEN_CARD_H * 0.08, rotate: '3deg',   zIndex: 2 },
  { left: GEN_CENTER_LEFT - GEN_CARD_W * 0.18,  top: GEN_CARD_H * 0.18,  rotate: '-7deg',  zIndex: 1 },
  { left: GEN_CENTER_LEFT + GEN_CARD_W * 0.28,  top: GEN_CARD_H * 0.38,  rotate: '2deg',   zIndex: 3 },
];

function GenerationResultsStep({
  selectedStyles,
  isActive,
  onGenerationDone,
  onFirstResult,
  onPhotoTap,
  recipes,
  uploadedPhotos,
  onStartGeneration,
  generationLibraryIds,
  libraryImages,
}: {
  selectedStyles: Set<string>;
  isActive: boolean;
  onGenerationDone: () => void;
  onFirstResult: () => void;
  onPhotoTap: (source: any) => void;
  recipes: PublicRecipe[];
  uploadedPhotos: string[];
  onStartGeneration: () => void;
  generationLibraryIds: Map<string, { libraryId: string; jobId: string }>;
  libraryImages: LibraryImage[];
}) {
  const reviewRequestedRef = useRef(false);
  const generationDoneRef = useRef(false);
  const generationStartedRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(true);
  // Per-card overlay opacity for progressive reveal
  const cardOverlays = useRef<Record<string, Animated.Value>>({});
  const revealedCardsRef = useRef<Set<string>>(new Set());
  // Cache resolved image URIs — survives library ID replacement
  const resolvedUrisRef = useRef<Record<string, string>>({});

  // Reset refs when generationLibraryIds is empty (new onboarding session)
  useEffect(() => {
    if (generationLibraryIds.size === 0 && uploadedPhotos.length === 0) {
      generationStartedRef.current = false;
      generationDoneRef.current = false;
      reviewRequestedRef.current = false;
      revealedCardsRef.current = new Set();
      cardOverlays.current = {};
      resolvedUrisRef.current = {};
      setIsGenerating(true);
    }
  }, [generationLibraryIds, uploadedPhotos]);

  // Helper: get or create per-card overlay Animated.Value
  const getCardOverlay = useCallback((cardId: string): Animated.Value => {
    if (!cardOverlays.current[cardId]) {
      cardOverlays.current[cardId] = new Animated.Value(1);
    }
    return cardOverlays.current[cardId];
  }, []);

  // Get selected recipes to display (up to 3)
  const recipeItems = React.useMemo(() => {
    const selected = recipes.filter(r => selectedStyles.has(r.id));
    if (selected.length >= 3) return selected.slice(0, 3);
    if (selected.length > 0) return selected;
    return recipes.slice(0, 3);
  }, [selectedStyles, recipes]);

  // Trigger generation when step becomes active
  useEffect(() => {
    if (isActive && uploadedPhotos.length > 0 && !generationStartedRef.current) {
      generationStartedRef.current = true;
      onStartGeneration();
    }
  }, [isActive, uploadedPhotos, onStartGeneration]);

  // Helper: find library image by jobId (stable across ID replacement)
  const findImageByJobId = useCallback((jobId: string): LibraryImage | undefined => {
    return libraryImages.find(img => img.metadata?.queueJobId === jobId);
  }, [libraryImages]);

  // Helper: resolve a generation entry to its current library image
  const resolveImage = useCallback((entry: { libraryId: string; jobId: string }): LibraryImage | undefined => {
    const direct = libraryImages.find(img => img.id === entry.libraryId);
    if (direct) return direct;
    return findImageByJobId(entry.jobId);
  }, [libraryImages, findImageByJobId]);

  // Progressive reveal — fade each card as its image completes
  useEffect(() => {
    if (!isActive) return;

    const allEntries = Array.from(generationLibraryIds.entries());
    if (allEntries.length === 0) return;

    let newlyRevealed = false;

    for (const [recipeId, entry] of allEntries) {
      if (revealedCardsRef.current.has(recipeId)) continue;

      const img = resolveImage(entry);
      if (!img) continue;

      const isReady = img.status === 'failed' || (img.status === 'completed' && !!img.transformedImageUrl);
      if (!isReady) continue;

      // Reveal this card — cache the URI so it survives ID replacement
      revealedCardsRef.current.add(recipeId);
      if (img.transformedImageUrl) {
        resolvedUrisRef.current[recipeId] = img.transformedImageUrl;
      }
      newlyRevealed = true;
      onFirstResult();

      const overlay = getCardOverlay(recipeId);
      Animated.timing(overlay, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }

    // Fire onGenerationDone + rate prompt only when ALL cards are revealed
    const allRevealed = revealedCardsRef.current.size >= allEntries.length;
    if (newlyRevealed && !generationDoneRef.current && allRevealed) {
      generationDoneRef.current = true;
      setIsGenerating(false);
      onGenerationDone();

      if (!reviewRequestedRef.current) {
        reviewRequestedRef.current = true;
        setTimeout(async () => {
          try {
            if (await StoreReview.hasAction()) {
              await StoreReview.requestReview();
            }
          } catch {}
        }, 5500);
      }
    }
  }, [isActive, generationLibraryIds, libraryImages, onGenerationDone, onFirstResult, resolveImage, getCardOverlay]);

  // 120-second fallback timeout — reveal whatever is ready, unblock Continue
  useEffect(() => {
    if (!isActive || generationDoneRef.current) return;
    if (generationLibraryIds.size === 0) return;

    const timer = setTimeout(() => {
      if (!generationDoneRef.current) {
        generationDoneRef.current = true;
        for (const [recipeId, entry] of generationLibraryIds.entries()) {
          if (!revealedCardsRef.current.has(recipeId)) {
            // Cache real image URI if available before revealing
            const img = resolveImage(entry);
            if (img?.transformedImageUrl) {
              resolvedUrisRef.current[recipeId] = img.transformedImageUrl;
            }
            revealedCardsRef.current.add(recipeId);
            const overlay = getCardOverlay(recipeId);
            Animated.timing(overlay, { toValue: 0, duration: 600, useNativeDriver: true }).start();
          }
        }
        setIsGenerating(false);
        onGenerationDone();
      }
    }, 120000);
    return () => clearTimeout(timer);
  }, [isActive, generationLibraryIds, onGenerationDone, getCardOverlay, resolveImage]);

  // Helper: get image source for a card (cached URI or live lookup)
  const getCardImage = (recipeId: string, coverUrl: string): { source: any; isReal: boolean } => {
    const cachedUri = resolvedUrisRef.current[recipeId];
    if (cachedUri) {
      return { source: { uri: cachedUri }, isReal: true };
    }

    const entry = generationLibraryIds.get(recipeId);
    if (entry) {
      const libImage = resolveImage(entry);
      if (libImage?.status === 'completed' && libImage.transformedImageUrl) {
        resolvedUrisRef.current[recipeId] = libImage.transformedImageUrl;
        return { source: { uri: libImage.transformedImageUrl }, isReal: true };
      }
    }
    return { source: { uri: coverUrl }, isReal: false };
  };

  return (
    <View style={genResultsStyles.container}>
      {recipeItems.map((recipe, i) => {
        // When only 1 card, center it perfectly (no offset, no rotation)
        const pos = recipeItems.length === 1
          ? { left: GEN_CENTER_LEFT, top: (GEN_CARD_H * 0.54) / 2 - GEN_CARD_H * 0.08, rotate: '0deg', zIndex: 2 }
          : (GEN_CARD_POSITIONS[i] || GEN_CARD_POSITIONS[0]);
        const { source, isReal } = getCardImage(recipe.id, recipe.example_result_url!);
        const cardOverlay = getCardOverlay(recipe.id);
        const cardTappable = isReal || !isGenerating;

        return (
          <TouchableOpacity
            key={recipe.id}
            activeOpacity={cardTappable ? 0.85 : 1}
            onPress={cardTappable ? () => onPhotoTap(source) : undefined}
            disabled={!cardTappable}
            style={[
              genResultsStyles.card,
              {
                width: GEN_CARD_W,
                height: GEN_CARD_H,
                left: pos.left,
                top: pos.top,
                zIndex: isReal ? 10 : pos.zIndex,
                transform: [{ rotate: pos.rotate }],
              },
            ]}
          >
            <Image
              source={source}
              style={genResultsStyles.image}
              resizeMode="cover"
            />
            {/* Blur + spinner overlay — fades out per-card as each image completes */}
            <Animated.View style={[genResultsStyles.overlay, { opacity: isReal ? 0 : cardOverlay }]}>
              <Image
                source={{ uri: recipe.example_result_url! }}
                style={genResultsStyles.image}
                resizeMode="cover"
                blurRadius={25}
              />
              <View style={genResultsStyles.spinnerWrap}>
                <ActivityIndicator size="small" color={YELLOW} />
              </View>
            </Animated.View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const genResultsStyles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH - 40,
    height: GEN_CARD_H + GEN_CARD_H * 0.54,
    position: 'relative',
  },
  card: {
    position: 'absolute',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    overflow: 'hidden',
  },
  spinnerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 10, 0.3)',
  },
  label: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    alignItems: 'center',
  },
  labelText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontFamily: 'Manrope-SemiBold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

// ── Generation progress overlay (cycling status text + progress bar) ──
function GenerationProgressOverlay({ isActive, generationDone }: { isActive: boolean; generationDone: boolean }) {
  const { t } = useTranslation();
  const [messageIndex, setMessageIndex] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const textOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const startTimeRef = useRef<number>(0);
  const startedRef = useRef(false);

  // Start tracking when slide becomes active
  useEffect(() => {
    if (isActive && !startedRef.current) {
      startedRef.current = true;
      startTimeRef.current = Date.now();
    }
  }, [isActive]);

  // Cycle messages every 4.5 seconds with fade
  useEffect(() => {
    if (!isActive || generationDone) return;

    const interval = setInterval(() => {
      Animated.timing(textOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setMessageIndex(prev => (prev < GENERATION_STATUS_MESSAGE_KEYS.length - 1 ? prev + 1 : prev));
        Animated.timing(textOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [isActive, generationDone, textOpacity]);

  // Mock progress: 0% → 99% over ~90 seconds (ease-out curve)
  useEffect(() => {
    if (!isActive || generationDone) return;
    if (!startTimeRef.current) startTimeRef.current = Date.now();

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const t = Math.min(elapsed / 90, 1);
      // Ease-out quadratic: progresses fast initially, slows toward 99%
      const p = Math.round(99 * (1 - Math.pow(1 - t, 2)));
      setDisplayProgress(p);
      Animated.timing(progressAnim, { toValue: p, duration: 400, useNativeDriver: false }).start();
    }, 500);

    return () => clearInterval(interval);
  }, [isActive, generationDone, progressAnim]);

  // When generation completes → animate to 100%
  useEffect(() => {
    if (generationDone) {
      setDisplayProgress(100);
      Animated.timing(progressAnim, { toValue: 100, duration: 600, useNativeDriver: false }).start();
    }
  }, [generationDone, progressAnim]);

  const barWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: [0, PROGRESS_BAR_WIDTH],
    extrapolate: 'clamp',
  });

  return (
    <View style={genProgressStyles.container}>
      <Animated.Text style={[genProgressStyles.statusText, { opacity: textOpacity }]}>
        {t(GENERATION_STATUS_MESSAGE_KEYS[messageIndex])}
      </Animated.Text>
      <View style={genProgressStyles.barRow}>
        <View style={genProgressStyles.barOuter}>
          <Animated.View style={[genProgressStyles.barInner, { width: barWidth }]} />
        </View>
        <Text style={genProgressStyles.percentText}>{displayProgress}%</Text>
      </View>
    </View>
  );
}

const genProgressStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 14,
  },
  statusText: {
    fontSize: 15,
    fontFamily: 'Manrope-Regular',
    color: '#999',
    textAlign: 'center',
    height: 20,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barOuter: {
    width: PROGRESS_BAR_WIDTH,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barInner: {
    height: '100%',
    backgroundColor: YELLOW,
    borderRadius: 2,
  },
  percentText: {
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
    color: '#555',
    width: 36,
  },
});

// Animated character grid for souls slide
function CharacterGridAnimation({ isActive }: { isActive: boolean }) {
  const animations = useRef(CHARACTER_IMAGES.map(() => new Animated.Value(0))).current;
  const floatAnimations = useRef(CHARACTER_IMAGES.map(() => new Animated.Value(0))).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const floatAnimationsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    floatAnimationsRef.current.forEach(anim => anim.stop());
    floatAnimationsRef.current = [];

    if (isActive) {
      // Reset animations
      animations.forEach(anim => anim.setValue(0));
      floatAnimations.forEach(anim => anim.setValue(0));

      // Staggered appearance - fast, one by one
      CHARACTER_IMAGES.forEach((char, index) => {
        const timeout = setTimeout(() => {
          Animated.spring(animations[index], {
            toValue: 1,
            tension: 120,
            friction: 8,
            useNativeDriver: true,
          }).start(() => {
            // Start floating animation after appear animation completes
            const floatAnim = Animated.loop(
              Animated.sequence([
                Animated.timing(floatAnimations[index], {
                  toValue: 1,
                  duration: 1500 + index * 200, // Slightly different timing for each
                  useNativeDriver: true,
                }),
                Animated.timing(floatAnimations[index], {
                  toValue: 0,
                  duration: 1500 + index * 200,
                  useNativeDriver: true,
                }),
              ])
            );
            floatAnimationsRef.current.push(floatAnim);
            floatAnim.start();
          });
        }, char.delay);
        timeoutsRef.current.push(timeout);
      });
    }

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      floatAnimationsRef.current.forEach(anim => anim.stop());
    };
  }, [isActive, animations, floatAnimations]);

  // Layout: 3 on top row, 2 on bottom row (centered)
  const topRow = CHARACTER_IMAGES.slice(0, 3);
  const bottomRow = CHARACTER_IMAGES.slice(3);

  // Create float interpolations for subtle up-down movement
  const floatInterpolations = floatAnimations.map((anim, i) =>
    anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -4 - (i % 2) * 2], // Vary float height slightly
    })
  );

  // Positions and rotations for overlapping scattered look
  // Container is 320px, images are 140px, so center = (320-140)/2 = 90
  // IMG_8693 (index 2) should be on top - positioned at bottom center
  const CENTER = 90; // (containerWidth - imageWidth) / 2
  const cardStyles = [
    { left: CENTER - 70, top: -30, rotate: '-10deg', zIndex: 1 },   // top left
    { left: CENTER + 70, top: -20, rotate: '8deg', zIndex: 2 },     // top right
    { left: CENTER, top: 120, rotate: '2deg', zIndex: 5 },          // IMG_8693 - bottom center, on top
    { left: CENTER - 65, top: 70, rotate: '-6deg', zIndex: 3 },     // middle left
    { left: CENTER + 65, top: 60, rotate: '6deg', zIndex: 4 },      // middle right
  ];

  return (
    <View style={styles.characterStackContainer}>
      {CHARACTER_IMAGES.map((char, i) => (
        <Animated.View
          key={i}
          style={[
            styles.characterCard,
            {
              left: cardStyles[i].left,
              top: cardStyles[i].top,
              zIndex: cardStyles[i].zIndex,
              transform: [
                { scale: animations[i] },
                { rotate: cardStyles[i].rotate },
                { translateY: floatInterpolations[i] },
              ],
              opacity: animations[i],
            },
          ]}
        >
          <Image
            source={char.image}
            style={styles.characterCardImage}
            resizeMode="cover"
          />
        </Animated.View>
      ))}
    </View>
  );
}

// Editing animation - shows drawing on image then transformation
// Animates two brush strokes on either side of the face (matching the hair area)
function EditingAnimation({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const leftStrokeScale = useRef(new Animated.Value(0)).current;
  const rightStrokeScale = useRef(new Animated.Value(0)).current;
  const transformOpacity = useRef(new Animated.Value(0)).current;
  const strokeOpacity = useRef(new Animated.Value(0)).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    if (isActive) {
      // Reset animations
      leftStrokeScale.setValue(0);
      rightStrokeScale.setValue(0);
      transformOpacity.setValue(0);
      strokeOpacity.setValue(0);

      // Phase 1: Draw left stroke (starts after 500ms)
      const drawLeftTimeout = setTimeout(() => {
        strokeOpacity.setValue(1);
        Animated.timing(leftStrokeScale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }, 500);
      timeoutsRef.current.push(drawLeftTimeout);

      // Phase 1b: Draw right stroke (starts shortly after left)
      const drawRightTimeout = setTimeout(() => {
        Animated.timing(rightStrokeScale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }, 800);
      timeoutsRef.current.push(drawRightTimeout);

      // Phase 2: Transform image (starts after strokes)
      const transformTimeout = setTimeout(() => {
        Animated.timing(transformOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }, 1800);
      timeoutsRef.current.push(transformTimeout);

      // Phase 3: Fade out strokes
      const fadeStrokeTimeout = setTimeout(() => {
        Animated.timing(strokeOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 2600);
      timeoutsRef.current.push(fadeStrokeTimeout);

      // Phase 4: Loop - reset everything
      const resetTimeout = setTimeout(() => {
        leftStrokeScale.setValue(0);
        rightStrokeScale.setValue(0);
        transformOpacity.setValue(0);
        strokeOpacity.setValue(0);
        setLoopKey(k => k + 1);
      }, 4000);
      timeoutsRef.current.push(resetTimeout);
    }

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [isActive, loopKey, leftStrokeScale, rightStrokeScale, transformOpacity, strokeOpacity]);

  return (
    <View style={styles.editingContainer}>
      {/* Before image */}
      <View style={styles.editingImageContainer}>
        <Image
          source={require('../../assets/onboarding/editor-before.jpg')}
          style={styles.editingImage}
          resizeMode="cover"
        />
        {/* Left red stroke - on left side of face/hair */}
        <Animated.View
          style={[
            styles.editingStrokeLeft,
            {
              opacity: strokeOpacity,
              transform: [{ scaleX: leftStrokeScale }],
            },
          ]}
        />
        {/* Right red stroke - on right side of face/hair */}
        <Animated.View
          style={[
            styles.editingStrokeRight,
            {
              opacity: strokeOpacity,
              transform: [{ scaleX: rightStrokeScale }],
            },
          ]}
        />
        {/* Transformation overlay */}
        <Animated.View
          style={[
            styles.editingOverlay,
            { opacity: transformOpacity },
          ]}
        >
          <Image
            source={require('../../assets/onboarding/editor-result.jpg')}
            style={styles.editingImage}
            resizeMode="cover"
          />
        </Animated.View>
      </View>
      {/* Label */}
      <View style={styles.editingLabel}>
        <View style={styles.editingBrushIcon}>
          <View style={styles.editingBrushDot} />
        </View>
        <Text style={styles.editingLabelText}>{t('onboarding.lab.drawToTransform')}</Text>
      </View>
    </View>
  );
}

// Intent picker options
// `label` is the stable identity (stored in state + persisted to AsyncStorage);
// `labelKey` is the localized display string.
const INTENT_OPTIONS = [
  { label: 'Dating profile', labelKey: 'onboarding.lab.intent.datingProfile', icon: Heart },
  { label: 'Social media', labelKey: 'onboarding.lab.intent.socialMedia', icon: Share2 },
  { label: 'Professional headshot', labelKey: 'onboarding.lab.intent.professionalHeadshot', icon: Briefcase },
  { label: 'Creative project', labelKey: 'onboarding.lab.intent.creativeProject', icon: Sparkles },
  { label: 'Edit photos mostly', labelKey: 'onboarding.lab.intent.editPhotos', icon: PenTool },
  { label: 'Just exploring', labelKey: 'onboarding.lab.intent.justExploring', icon: Compass },
];

// How it works - slideshow images
const HOWTO_IMAGES = [
  require('../../assets/community-covers/howto-1.png'),
  require('../../assets/community-covers/howto-2.png'),
  require('../../assets/community-covers/howto-3.png'),
  require('../../assets/community-covers/howto-4.png'),
];

// How it works - crossfade slideshow of before/after images
function HowItWorksSlideshow() {
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');
  const [slotAIndex, setSlotAIndex] = useState(0);
  const [slotBIndex, setSlotBIndex] = useState(1);
  const opacityA = useRef(new Animated.Value(1)).current;
  const opacityB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeSlot === 'A') {
        const nextIdx = (slotAIndex + 1) % HOWTO_IMAGES.length;
        setSlotBIndex(nextIdx);
        Animated.parallel([
          Animated.timing(opacityA, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(opacityB, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]).start(() => setActiveSlot('B'));
      } else {
        const nextIdx = (slotBIndex + 1) % HOWTO_IMAGES.length;
        setSlotAIndex(nextIdx);
        Animated.parallel([
          Animated.timing(opacityB, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(opacityA, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]).start(() => setActiveSlot('A'));
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeSlot, slotAIndex, slotBIndex, opacityA, opacityB]);

  return (
    <>
      <Animated.Image
        source={HOWTO_IMAGES[slotAIndex]}
        style={[styles.howItWorksComposedImage, { opacity: opacityA }]}
        resizeMode="contain"
      />
      <Animated.Image
        source={HOWTO_IMAGES[slotBIndex]}
        style={[styles.howItWorksComposedImage, { opacity: opacityB }]}
        resizeMode="contain"
      />
    </>
  );
}

function IntentPicker({ selectedIntents, onSelect }: { selectedIntents: Set<string>; onSelect: (intent: string) => void }) {
  const { t } = useTranslation();
  const animations = useRef(INTENT_OPTIONS.map(() => new Animated.Value(0))).current;
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    // Staggered appearance
    INTENT_OPTIONS.forEach((_, index) => {
      const timeout = setTimeout(() => {
        Animated.spring(animations[index], {
          toValue: 1,
          tension: 100,
          friction: 10,
          useNativeDriver: true,
        }).start();
      }, index * 60);
      timeoutsRef.current.push(timeout);
    });

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [animations]);

  // Build rows of 2
  const rows: typeof INTENT_OPTIONS[] = [];
  for (let i = 0; i < INTENT_OPTIONS.length; i += 2) {
    rows.push(INTENT_OPTIONS.slice(i, i + 2));
  }

  return (
    <ScrollView
      style={styles.intentScroll}
      contentContainerStyle={styles.intentScrollContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.intentRow}>
          {row.map((option, colIndex) => {
            const index = rowIndex * 2 + colIndex;
            const isSelected = selectedIntents.has(option.label);
            const IconComponent = option.icon;
            return (
              <Animated.View
                key={option.label}
                style={[
                  styles.intentCardWrapper,
                  {
                    transform: [{ scale: animations[index] }],
                    opacity: animations[index],
                  },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.intentCard,
                    isSelected && styles.intentCardSelected,
                  ]}
                  onPress={() => onSelect(option.label)}
                  activeOpacity={0.7}
                >
                  <IconComponent
                    size={22}
                    color={isSelected ? YELLOW : '#555'}
                    strokeWidth={1.5}
                  />
                  <Text style={[
                    styles.intentCardText,
                    isSelected && styles.intentCardTextSelected,
                  ]}>
                    {t(option.labelKey)}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

// Upload selfies step — requests gallery permission, shows upload area
// Character selfie previews shown above upload area until user uploads their own
const UPLOAD_PREVIEW_IMAGE = require('../../assets/upload-illustration.png');
// Curated "good selfie" examples — shared with CreateSoulModal to keep the
// guidance consistent between onboarding and the in-app soul creator.
const SELFIE_EXAMPLES = [
  require('../../assets/selfie-example-1.jpg'),
  require('../../assets/selfie-example-2.jpg'),
  require('../../assets/selfie-example-3.jpg'),
];

function UploadSelfiesStep({
  photos,
  onPickPhotos,
  onRemovePhoto,
  validationResults,
  isValidating,
  validatingIndices,
  onDismissResult,
  pickerProcessingCount,
  onSecretSkip,
}: {
  photos: string[];
  onPickPhotos: () => void;
  onRemovePhoto: (index: number) => void;
  validationResults: Map<number, ValidationResult>;
  isValidating: boolean;
  validatingIndices: Set<number>;
  onDismissResult: (index: number) => void;
  pickerProcessingCount: number;
  /** Hidden creator gesture: 7 quick taps on the selfie examples. */
  onSecretSkip?: () => void;
}) {
  const { t } = useTranslation();
  // Live height (not the frozen module-level SCREEN_HEIGHT): only compact the
  // layout when the window is genuinely short right now.
  const { height: windowHeight } = useWindowDimensions();
  const isShortScreen = windowHeight < 700;
  const dropzoneHeight = Math.min(230, Math.max(150, windowHeight - 500));
  const showPreviews = photos.length === 0 && pickerProcessingCount === 0 && !isShortScreen;
  const isPickerProcessing = pickerProcessingCount > 0;

  // Hidden creator skip: 7 quick taps on the example thumbnails (within 1.5s
  // of each other). Fires onSecretSkip, which marks the account a creator and
  // skips generation + all onboarding paywalls.
  const exampleTapCountRef = React.useRef(0);
  const lastExampleTapRef = React.useRef(0);
  const handleExampleTap = React.useCallback(() => {
    const now = Date.now();
    if (now - lastExampleTapRef.current > 1500) exampleTapCountRef.current = 0;
    lastExampleTapRef.current = now;
    exampleTapCountRef.current += 1;
    if (exampleTapCountRef.current >= 7) {
      exampleTapCountRef.current = 0;
      onSecretSkip?.();
    }
  }, [onSecretSkip]);
  const handledAlertsRef = React.useRef(new Set<number>());

  const photoLabel = (index: number) => t('onboarding.lab.upload.photoLabel', { n: index + 1 });

  // Auto-remove critical photos via Alert
  const handleCriticalPhoto = (index: number, summary: string) => {
    const title = t('onboarding.lab.upload.cantBeUsedTitle', { label: photoLabel(index) });
    const message = summary || t('onboarding.lab.upload.notSuitable');
    // Alert.alert is a no-op on react-native-web — in-app dialog instead.
    if (Platform.OS === 'web') {
      showWebAlert(title, message);
      handledAlertsRef.current.delete(index);
      onRemovePhoto(index);
      return;
    }
    Alert.alert(
      title,
      message,
      [{ text: t('onboarding.lab.upload.removeAndUploadNew'), onPress: () => {
        handledAlertsRef.current.delete(index);
        onRemovePhoto(index);
      }}],
    );
  };

  // Important photos: keep or change (soft recommendation)
  const handleImportantPhoto = (index: number, summary: string) => {
    const title = t('onboarding.lab.upload.goodToGoTitle', { label: photoLabel(index) });
    const message = (summary || t('onboarding.lab.upload.willWork')) + '\n\n' + t('onboarding.lab.upload.clearerHint');
    if (Platform.OS === 'web') {
      showConfirm(title, message, { confirmText: t('onboarding.lab.upload.keep'), cancelText: t('onboarding.lab.upload.change') }).then((keep) => {
        handledAlertsRef.current.delete(index);
        if (keep) onDismissResult(index);
        else onRemovePhoto(index);
      });
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: t('onboarding.lab.upload.keep'), style: 'cancel', onPress: () => {
          handledAlertsRef.current.delete(index);
          onDismissResult(index);
        }},
        { text: t('onboarding.lab.upload.change'), onPress: () => {
          handledAlertsRef.current.delete(index);
          onRemovePhoto(index);
        }},
      ],
    );
  };

  // Check for critical/important results that need action — only show each alert once
  React.useEffect(() => {
    validationResults.forEach((result, index) => {
      if (handledAlertsRef.current.has(index)) return;
      if (result.status === 'critical') {
        handledAlertsRef.current.add(index);
        handleCriticalPhoto(index, result.summary);
      } else if (result.status === 'important') {
        handledAlertsRef.current.add(index);
        handleImportantPhoto(index, result.summary);
      }
    });
  }, [validationResults]);

  const getBorderStyle = (index: number) => {
    const v = validationResults.get(index);
    if (!v) return undefined;
    if (v.status === 'critical') return styles.uploadStepCardCriticalBorder;
    if (v.status === 'important') return styles.uploadStepCardWarningBorder;
    return undefined;
  };

  const renderBadge = (index: number) => {
    if (validatingIndices.has(index)) {
      return (
        <View style={styles.uploadStepValidatingBadge}>
          <ActivityIndicator size={10} color="#f59e0b" />
        </View>
      );
    }
    return null;
  };

  return (
    <View style={styles.uploadStepContainer}>
      {/* Good-selfie examples + rules — replaces the plain illustration and
          teaches quality before upload. Auto-hidden once a photo is added
          (showPreviews gates on photos.length === 0). */}
      {showPreviews && (
        <View style={styles.uploadGuide}>
          {/* Tapping the examples 7x is the hidden creator-skip gesture. */}
          <TouchableOpacity
            style={styles.uploadExamplesRow}
            activeOpacity={1}
            onPress={handleExampleTap}
          >
            {SELFIE_EXAMPLES.map((src, i) => (
              <View key={i} style={styles.uploadExampleCard}>
                <Image source={src} style={styles.uploadExampleImg} resizeMode="cover" />
                <View style={styles.uploadExampleCheck}>
                  <Check size={10} color="#fff" strokeWidth={3} />
                </View>
              </View>
            ))}
          </TouchableOpacity>
          <View style={styles.uploadTips}>
            <View style={styles.uploadTipRow}>
              <Sun size={15} color="#4ade80" strokeWidth={2.2} />
              <Text style={styles.uploadTipText}>{t('souls.tipLight')}</Text>
            </View>
            <View style={styles.uploadTipRow}>
              <Smile size={15} color="#4ade80" strokeWidth={2.2} />
              <Text style={styles.uploadTipText}>{t('souls.tipFace')}</Text>
            </View>
            <View style={styles.uploadTipRow}>
              <User size={15} color="#4ade80" strokeWidth={2.2} />
              <Text style={styles.uploadTipText}>{t('souls.tipAlone')}</Text>
            </View>
          </View>
        </View>
      )}

      {isPickerProcessing ? (
        <View style={[styles.uploadStepArea, { height: dropzoneHeight }, showPreviews && styles.uploadStepAreaWithPreviews]}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.uploadStepAreaTitle}>{t('onboarding.lab.upload.processing')}</Text>
          <Text style={styles.uploadStepAreaHint}>{t('onboarding.lab.upload.downloadingPhoto')}</Text>
        </View>
      ) : photos.length === 0 ? (
        <TouchableOpacity
          style={[styles.uploadStepArea, { height: dropzoneHeight }, showPreviews && styles.uploadStepAreaWithPreviews]}
          onPress={onPickPhotos}
          activeOpacity={0.7}
        >
          <Text style={styles.uploadStepAreaTitle}>{t('onboarding.lab.upload.tapToUpload')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.uploadStepCardsContainer}
          onPress={onPickPhotos}
          activeOpacity={0.85}
        >
          <View style={styles.uploadStepStackedCards}>
            {(() => {
              const renderPhotoCard = (photoIndex: number, slotStyle: any, badgeNumber: number) => (
                <View key={`p${photoIndex}`} style={[slotStyle, getBorderStyle(photoIndex)]}>
                  <Image source={{ uri: photos[photoIndex] }} style={styles.uploadStepCardImage} resizeMode="cover" />
                  <View style={styles.uploadStepNumberBadge}>
                    <Text style={styles.uploadStepNumberText}>{badgeNumber}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.uploadStepCardDelete}
                    onPress={() => onRemovePhoto(photoIndex)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.uploadStepThumbDeleteText}>✕</Text>
                  </TouchableOpacity>
                  {renderBadge(photoIndex)}
                </View>
              );
              const addMore = (slotStyle: any, key: string) => (
                <TouchableOpacity
                  key={key}
                  style={[slotStyle, styles.uploadStepAddMoreOverlay]}
                  onPress={onPickPhotos}
                  activeOpacity={0.7}
                >
                  <Text style={styles.uploadStepAddMoreText}>{t('onboarding.lab.upload.addOneMore')}</Text>
                </TouchableOpacity>
              );

              if (photos.length === 1) {
                return [
                  addMore(styles.uploadStepBackCard, 'add'),
                  renderPhotoCard(0, styles.uploadStepFrontCard, 1),
                ];
              }
              if (photos.length === 2) {
                return [
                  renderPhotoCard(1, styles.uploadStepBackCard, 2),
                  addMore(styles.uploadStepMiddleCard, 'add'),
                  renderPhotoCard(0, styles.uploadStepFrontCard, 1),
                ];
              }
              return [
                renderPhotoCard(2, styles.uploadStepBackCard, 3),
                renderPhotoCard(1, styles.uploadStepMiddleCard, 2),
                renderPhotoCard(0, styles.uploadStepFrontCard, 1),
              ];
            })()}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Wait for the native iOS rating dialog (SKStoreReviewController) to be
// dismissed. The dialog has no completion callback, so we use AppState:
// when the system UI appears, the app transitions to `inactive`/`background`;
// when dismissed, it returns to `active`.
//
// IMPORTANT: this must be called BEFORE StoreReview.requestReview so the
// listener is attached when iOS fires the `inactive` transition. If we set
// it up after, we miss the appear event and time out.
//
// - detectAppearTimeoutMs: if AppState never leaves `active` within this
//   window, assume the rating UI never appeared (Apple throttles to ~3
//   prompts per year) and resolve immediately.
// - maxWaitMs: hard ceiling in case the AppState transition is missed.
function waitForRatingDismissal(
  detectAppearTimeoutMs = 4000,
  maxWaitMs = 60000,
): Promise<void> {
  return new Promise((resolve) => {
    let phase: 'awaitingAppear' | 'awaitingReturn' | 'done' = 'awaitingAppear';
    const cleanup = () => {
      if (phase === 'done') return;
      phase = 'done';
      try { sub.remove(); } catch {}
      clearTimeout(detectTimer);
      clearTimeout(maxTimer);
      resolve();
    };

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      console.log('[Onboarding] AppState change during rating wait:', state, 'phase:', phase);
      if (phase === 'awaitingAppear' && state !== 'active') {
        phase = 'awaitingReturn';
        clearTimeout(detectTimer);
      } else if (phase === 'awaitingReturn' && state === 'active') {
        // Brief grace period for the dismiss animation to complete
        // before we surface the paywall on top.
        setTimeout(cleanup, 500);
      }
    });

    const detectTimer = setTimeout(() => {
      if (phase === 'awaitingAppear') {
        console.log('[Onboarding] Rating UI did not change AppState within', detectAppearTimeoutMs, 'ms — assuming throttled/no-op');
        cleanup();
      }
    }, detectAppearTimeoutMs);

    const maxTimer = setTimeout(cleanup, maxWaitMs);
  });
}

function RateUsStep() {
  const { t } = useTranslation();
  const sparkle = useSharedValue(0);
  React.useEffect(() => {
    sparkle.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [sparkle]);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(sparkle.value, [0, 1], [0.6, 1], Extrapolation.CLAMP) },
    ],
    opacity: sparkle.value,
  }));

  return (
    <View style={styles.rateUsContainer}>
      <Reanimated.View style={[styles.rateUsStarsRow, scaleStyle]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={44} color="#FF2D95" fill="#FF2D95" strokeWidth={1.5} />
        ))}
      </Reanimated.View>
      <Text style={styles.rateUsCopy}>
        {t('onboarding.lab.rateUsCopy')}
      </Text>
    </View>
  );
}

// AI data-sharing consent (dialog text, persistence, privacy URL) lives in
// lib/ai/aiConsent.ts so onboarding and the generation tabs show one identical
// disclosure. See promptAIConsentDialog / persistAIConsent.

// ── Hero video for the first onboarding slide ──
// The .mov originals are HEVC, which Chrome/Android browsers can't decode —
// web gets H.264 mp4 transcodes of the same clips.
const IS_WEB = Platform.OS === 'web';
const HERO_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-hero-web.mp4')
  : require('../../assets/copy_009F1ECB-DF34-4CFD-9CC5-B77491BE7A2D.mov');
const PHOTOSHOOT_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-photoshoot-web.mp4')
  : require('../../assets/8photos_onb.mov');
const UPSCALE_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-upscale-web.mp4')
  : require('../../assets/upscale_onb.mov');
const EDIT_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-edit-web.mp4')
  : require('../../assets/edit_onb.mov');
const EFFECTS_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-effects-web.mp4')
  : require('../../assets/effects_onb.mov');
const AGENT_VIDEO_SOURCE = IS_WEB
  ? require('../../assets/onboarding-agent-web.mp4')
  : require('../../assets/agent_onb.mov');

// ── Full-screen auto carousel for the first onboarding slide ──
const HERO_CAROUSEL_SOURCES = [
  require('../../assets/onboarding/hero-carousel/1.jpg'),
  require('../../assets/onboarding/hero-carousel/2.jpg'),
  require('../../assets/onboarding/hero-carousel/3.jpg'),
  require('../../assets/onboarding/hero-carousel/4.jpg'),
  require('../../assets/onboarding/hero-carousel/5.jpg'),
];
const HERO_CAROUSEL_INTERVAL = 3200; // ms each photo stays before sliding
const HERO_CAROUSEL_SLIDE_MS = 700; // ms slide transition (matches home hero feel)

function HeroVideoSlide({ isActive, source = HERO_VIDEO_SOURCE }: { isActive: boolean; source?: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);

  // Live height: on web the window resizes after load (toolbars, user
  // resizing) — the frozen module-level SCREEN_HEIGHT would leave the video
  // tiny on a grown window or oversized on a shrunken one.
  const { height: windowHeight } = useWindowDimensions();
  const videoHeight = Math.round(windowHeight * 0.6);
  const fadeHeight = Math.round(videoHeight * 0.35);
  // Lock the phone's inner aspect to the recorded video aspect (590 x 1280)
  // so the bezel hugs the video with no letterbox gap on any side.
  const VIDEO_ASPECT = 590 / 1280;
  const phoneHeight = Math.round(videoHeight * 1.08);
  const bezel = 5;
  const innerHeight = phoneHeight - bezel * 2;
  const innerWidth = Math.round(innerHeight * VIDEO_ASPECT);
  const phoneWidth = innerWidth + bezel * 2;
  const phoneRadius = 48;
  const innerRadius = phoneRadius - bezel;

  return (
    <View style={{ width: SCREEN_WIDTH, height: videoHeight, alignItems: 'center', overflow: 'hidden' }}>
      <View
        style={{
          width: phoneWidth,
          height: phoneHeight,
          borderRadius: phoneRadius,
          backgroundColor: '#2a2a2a',
          padding: bezel,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: innerRadius,
            overflow: 'hidden',
            backgroundColor: '#0a0a0a',
          }}
        >
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            nativeControls={false}
            // iOS WebKit auto-fullscreens non-inline videos on play() —
            // without this, changing slides kicks the video fullscreen.
            playsInline
          />
        </View>
      </View>
      <LinearGradient
        colors={['rgba(10,10,10,0)', '#0a0a0a']}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: fadeHeight,
        }}
        pointerEvents="none"
      />
    </View>
  );
}

// A social-proof stat bracketed by plain parentheses (no graphic flourish).
const LAUREL_SOURCE = require('../../assets/laurel.png');

function StatBadge({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.statBadge}>
      <Image source={LAUREL_SOURCE} style={styles.laurel} resizeMode="contain" />
      <View style={styles.statContent}>{children}</View>
      <Image source={LAUREL_SOURCE} style={[styles.laurel, styles.laurelFlip]} resizeMode="contain" />
    </View>
  );
}

// Full-screen auto carousel + top gradient + title + social proof.
// Used only for the very first onboarding slide (id 'hero-video').
// Reuses the home-tab hero carousel (react-native-reanimated-carousel) so the
// transition slides smoothly instead of the previous opacity blink.
function HeroPhotoCarousel({ isActive, title, topInset }: { isActive: boolean; title: string; topInset: number }) {
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Push the photo down a touch so subjects' faces clear the title band; the
  // exposed strip up top is hidden under the dark gradient anyway.
  const DOWN_SHIFT = Math.round(windowHeight * 0.08);

  return (
    <View style={styles.heroCarouselRoot}>
      <View style={{ position: 'absolute', top: DOWN_SHIFT, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <Carousel
          width={windowWidth}
          height={windowHeight}
          data={HERO_CAROUSEL_SOURCES}
          loop
          autoPlay={isActive}
          autoPlayInterval={HERO_CAROUSEL_INTERVAL}
          scrollAnimationDuration={HERO_CAROUSEL_SLIDE_MS}
          enabled={false}
          renderItem={({ item }) => (
            <Image source={item} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          )}
        />
      </View>

      {/* Top gradient — covers ~top 25% so the title reads and faces stay clear */}
      <LinearGradient
        colors={['rgba(8,8,8,0.95)', 'rgba(8,8,8,0.85)', 'rgba(8,8,8,0)']}
        locations={[0, 0.55, 1]}
        style={styles.heroCarouselTopGradient}
        pointerEvents="none"
      />

      {/* Title + social proof, anchored in the top gradient band */}
      <View style={[styles.heroCarouselTextWrap, { paddingTop: topInset + 24 }]} pointerEvents="none">
        <Text style={styles.title}>{title}</Text>
        <View style={styles.statRow}>
          <StatBadge>
            <Text style={[styles.statText, styles.statTextWrap]}>{t('onboarding.lab.statPhotosGenerated')}</Text>
          </StatBadge>
          <StatBadge>
            <Text style={styles.statRating}>4.9</Text>
            <View style={styles.statStars}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={11} color="#fff" fill="#fff" />
              ))}
            </View>
          </StatBadge>
        </View>
      </View>

      {/* Bottom gradient + Aya agent tagline */}
      <LinearGradient
        colors={['rgba(8,8,8,0)', 'rgba(8,8,8,0.92)']}
        style={styles.heroCarouselBottomGradient}
        pointerEvents="none"
      />
      <View style={styles.heroAgentCardWrap} pointerEvents="none">
        <View style={styles.heroAgentCard}>
          {/* Glass is a background layer; the mascot + text sit ON TOP as siblings
              (not blur children) so they never get dimmed to grey. */}
          <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
          <View style={styles.heroAgentScrim} />
          <View style={styles.heroAgentRow}>
            <Image source={require('../../assets/agent-persona.png')} style={styles.heroAgentMascot} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroAgentTitle}>{t('onboarding.lab.agentPromoTitle')}</Text>
              <Text style={styles.heroAgentSub}>{t('onboarding.lab.agentPromoSubtitle')}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── "How did you hear about us?" picker ──
const HEAR_ILLUSTRATION_SOURCE = require('../../assets/hear-illustration.png');

const HEAR_OPTIONS: { id: string; label: string }[] = [
  { id: 'app_store', label: 'App Store' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'advertisement', label: 'Advertisement' },
  { id: 'friend', label: 'Friend' },
  { id: 'other', label: 'Other' },
];

function HowDidYouHearPicker({
  title,
  topInset,
  bottomInset,
  selected,
  onToggle,
}: {
  title: string;
  topInset: number;
  bottomInset: number;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const illoSize = Math.min(200, Math.round(height * 0.24));
  return (
    // Full-screen native scroll: illustration + title + options all scroll as
    // one page; the Continue button stays fixed (bottomContainer overlay).
    <ScrollView
      style={styles.hearFullScroll}
      contentContainerStyle={[
        styles.hearFullContent,
        { paddingTop: topInset + 28, paddingBottom: bottomInset + 150 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={HEAR_ILLUSTRATION_SOURCE}
        style={{ width: illoSize, height: illoSize, alignSelf: 'center', marginBottom: 8 }}
        resizeMode="contain"
      />
      <Text style={styles.title}>{title}</Text>
      <View style={{ gap: 8, marginTop: 4 }}>
        {HEAR_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <TouchableOpacity
              key={opt.id}
              activeOpacity={0.8}
              onPress={() => onToggle(opt.id)}
              style={[styles.hearOption, isSelected && styles.hearOptionSelected]}
            >
              <Text
                style={[
                  styles.hearOptionText,
                  isSelected && styles.hearOptionTextSelected,
                ]}
              >
                {t(`onboarding.lab.hear.${opt.id}`)}
              </Text>
              {isSelected && <Check size={18} color="#000" />}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

// Slides intentionally hidden from the active onboarding flow.
// Component code (gallery, intent picker, rate-us, pick-styles, generation
// results) is retained because it's referenced by render helpers — easy to
// re-enable by adding the id back to BASE_SLIDES.
const HIDDEN_SLIDE_IDS = new Set<string>([
  'gallery',
  'how-it-works',
  'intent',
  'rate-us',
  'pick-styles',
  'generation-results',
]);

const BASE_SLIDES: OnboardingSlide[] = [
  {
    id: 'hero-video',
    titleKey: 'onboarding.lab.slide.heroVideo.title',
    subtitleKey: '',
    visualHint: 'hero-video',
  },
  {
    id: 'how-did-you-hear',
    titleKey: 'onboarding.lab.slide.howDidYouHear.title',
    subtitleKey: '',
    visualHint: 'how-did-you-hear',
  },
  {
    id: 'feature-photoshoot',
    titleKey: 'onboarding.lab.slide.featurePhotoshoot.title',
    subtitleKey: 'onboarding.lab.slide.featurePhotoshoot.subtitle',
    visualHint: 'feature-photoshoot',
  },
  {
    id: 'feature-agent',
    titleKey: 'onboarding.lab.slide.featureAgent.title',
    subtitleKey: 'onboarding.lab.slide.featureAgent.subtitle',
    visualHint: 'feature-agent',
  },
  {
    id: 'feature-upscale',
    titleKey: 'onboarding.lab.slide.featureUpscale.title',
    subtitleKey: 'onboarding.lab.slide.featureUpscale.subtitle',
    visualHint: 'feature-upscale',
  },
  {
    id: 'feature-effects',
    titleKey: 'onboarding.lab.slide.featureEffects.title',
    subtitleKey: 'onboarding.lab.slide.featureEffects.subtitle',
    visualHint: 'feature-effects',
  },
  {
    id: 'feature-edit',
    titleKey: 'onboarding.lab.slide.featureEdit.title',
    subtitleKey: 'onboarding.lab.slide.featureEdit.subtitle',
    visualHint: 'feature-edit',
  },
  {
    id: 'upload-selfies',
    titleKey: 'onboarding.lab.slide.uploadSelfies.title',
    subtitleKey: 'onboarding.lab.slide.uploadSelfies.subtitle',
    visualHint: 'upload-selfies',
  },
];

// Hard-paywall flow v2 slides (app_config.hard_paywall_flow_v2). Inserted
// around `upload-selfies` when the flow is enabled: the selfie step stays put,
// choose-photo comes right after it, and onboarding-generation last.
const HPF_CHOOSE_PHOTO_SLIDE: OnboardingSlide = {
  id: 'choose-photo',
  titleKey: 'onboarding.hpf.choosePhoto.title',
  subtitleKey: '',
  visualHint: 'choose-photo',
};
const HPF_GENERATION_SLIDE: OnboardingSlide = {
  id: 'onboarding-generation',
  titleKey: 'onboarding.hpf.generating.title',
  subtitleKey: '',
  visualHint: 'onboarding-generation',
};

function getPickStylesTitleKey(count: number): string {
  if (count === 0) return 'onboarding.lab.pickStyles.title0';
  if (count === 1) return 'onboarding.lab.pickStyles.title1';
  if (count === 2) return 'onboarding.lab.pickStyles.title2';
  return 'onboarding.lab.pickStyles.title3';
}

export default function LabOnboardingModal({ visible, onComplete }: LabOnboardingModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { subscriptionStatus, refresh: refreshSubscription } = useSubscription();
  // Live viewport height — the module-level SCREEN_HEIGHT is frozen at bundle
  // load and goes stale when the web window resizes.
  const { height: windowHeight } = useWindowDimensions();
  const hearIllustrationSize = Math.min(200, Math.round(windowHeight * 0.24));

  // Remote kill-switch for the selfie-upload step (Supabase app_config key
  // `onboarding_selfie_step_enabled`). Default = enabled, i.e. current behavior;
  // it stays enabled while loading and on any fetch error. Set the key to
  // `false` in app_config to skip the upload step and send users straight to the
  // paywall — no app release needed.
  // Web ad funnel: skip the selfie-upload step entirely — onboarding → paywall →
  // app (no pre-paywall generation). Shorter funnel = more ad traffic reaches the
  // paywall, which we optimize for. iOS keeps the remote-config flag.
  const [selfieStepEnabled, setSelfieStepEnabled] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    getAppConfigBool('onboarding_selfie_step_enabled', true).then((enabled) => {
      if (!cancelled) setSelfieStepEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hard-paywall flow v2 (app_config.hard_paywall_flow_v2): choose photo →
  // selfie → free generation → hard paywall after onboarding. Defaults to
  // disabled (legacy onboarding) while loading and on any config failure.
  const [hpfConfig, setHpfConfig] = useState<HardPaywallFlowConfig>(
    DEFAULT_HARD_PAYWALL_FLOW_CONFIG,
  );
  // Re-fetch each time onboarding opens so an admin flipping the local override
  // (Settings → Admin: Hard Paywall Onboarding) then re-opening onboarding picks
  // it up without an app restart.
  useEffect(() => {
    if (Platform.OS === 'web' || !visible) return;
    let cancelled = false;
    getHardPaywallFlowConfig().then((cfg) => {
      if (!cancelled) setHpfConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const hpfCountryAllowed = useMemo(() => {
    const region = getLocales()[0]?.regionCode?.toUpperCase();
    // Blocklist wins: excluded countries (e.g. IN) always get the legacy
    // onboarding, even with a null allowlist.
    if (hpfConfig.excludedCountries && region && hpfConfig.excludedCountries.includes(region)) {
      return false;
    }
    if (!hpfConfig.countries) return true;
    return !!region && hpfConfig.countries.includes(region);
  }, [hpfConfig]);

  // The flow needs all three steps: a reference photo to recreate, selfies to
  // recreate it with, and the generation itself. Partial combinations are
  // incoherent, so any disabled step falls back to the legacy onboarding.
  // Deliberately INDEPENDENT of the v1 `onboarding_selfie_step_enabled` kill
  // switch — that key stays false for the OLD shipped app; v2 owns its own
  // selfie step via steps.selfie.
  const hpfFlowRuns =
    Platform.OS !== 'web' &&
    hpfConfig.enabled &&
    hpfCountryAllowed &&
    hpfConfig.steps.choosePhoto &&
    hpfConfig.steps.selfie &&
    hpfConfig.steps.generation;

  const slides = useMemo(() => {
    const base = BASE_SLIDES.filter((s) => {
      if (HIDDEN_SLIDE_IDS.has(s.id)) return false;
      // v2 flow re-includes the selfie step even when the v1 kill switch is off.
      if (s.id === 'upload-selfies' && !selfieStepEnabled && !hpfFlowRuns) return false;
      return true;
    });
    if (!hpfFlowRuns) return base;
    const uploadIdx = base.findIndex((s) => s.id === 'upload-selfies');
    if (uploadIdx === -1) return base;
    // Selfie FIRST, then choose-a-look, then the generation. Collecting the
    // user's own face up front makes the "recreate this look with your face"
    // framing on the choose-photo step read clearly.
    return [
      ...base.slice(0, uploadIdx),
      base[uploadIdx],
      HPF_CHOOSE_PHOTO_SLIDE,
      HPF_GENERATION_SLIDE,
      ...base.slice(uploadIdx + 1),
    ];
  }, [selfieStepEnabled, hpfFlowRuns]);
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [isClosing, setIsClosing] = useState(false);
  const [selectedIntents, setSelectedIntents] = useState<Set<string>>(new Set());
  const [hearSources, setHearSources] = useState<string[]>([]);
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [pickerProcessingCount, setPickerProcessingCount] = useState(0);
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set());
  const [showLocalPaywall, setShowLocalPaywall] = useState(false);
  const [generationDone, setGenerationDone] = useState(false);
  const [generationTimedOut, setGenerationTimedOut] = useState(false);
  const [hasAnyGenerationResult, setHasAnyGenerationResult] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<any>(null);

  // Selfie validation
  const {
    validateImages,
    validationResults,
    isValidating,
    validatingIndices,
    clearResults: clearValidationResults,
    removeResultAtIndex,
    dismissResult,
  } = useSelfieValidation();

  // Validation countdown timer
  const [validationCountdown, setValidationCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isValidating) {
      setValidationCountdown(6);
      countdownRef.current = setInterval(() => {
        setValidationCountdown(prev => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setValidationCountdown(0);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isValidating]);

  // Souls
  const { souls, addSoul, updateSoul } = useSouls();
  const isSavingSoulRef = useRef(false);
  const bgRemovedPhotosRef = useRef<Map<number, string>>(new Map());

  // Real recipe + generation state
  const { generate } = useGeneration();
  const { images: libraryImages } = useLibrary();
  const [publicRecipes, setPublicRecipes] = useState<PublicRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [generationLibraryIds, setGenerationLibraryIds] = useState<Map<string, { libraryId: string; jobId: string }>>(new Map());
  const [realGenerationStarted, setRealGenerationStarted] = useState(false);

  const handleRemovePhoto = useCallback((index: number) => {
    setUploadedPhotos(prev => {
      removeResultAtIndex(index, prev.length);
      return prev.filter((_, i) => i !== index);
    });
    // Rebuild bg-removed map with shifted indices
    const newMap = new Map<number, string>();
    bgRemovedPhotosRef.current.forEach((uri, i) => {
      if (i < index) newMap.set(i, uri);
      else if (i > index) newMap.set(i - 1, uri);
    });
    bgRemovedPhotosRef.current = newMap;
  }, [removeResultAtIndex]);

  const processBackgroundRemoval = useCallback(async (uri: string, index: number) => {
    try {
      const base64Image = await convertImageToBase64(uri);
      const response = await queueManager.startPrediction({
        model: 'background-remover',
        prompt: 'Background removal',
        parameters: { image: base64Image },
      });

      const jobId = response.job_id;

      const outputUrl = await new Promise<string>((resolve, reject) => {
        const unsubscribe = queueManager.subscribe((jobs) => {
          const job = jobs.find(j => j.id === jobId);
          if (!job) return;
          if (job.status === 'completed' && job.resultUrl) {
            unsubscribe();
            resolve(job.resultUrl);
          } else if (job.status === 'failed') {
            unsubscribe();
            reject(new Error(job.errorMessage || 'Background removal failed'));
          }
        });
        setTimeout(() => { unsubscribe(); reject(new Error('Timed out')); }, 120000);
      });

      // Download to local cache so it can be used for generation
      const localUri = await downloadMediaToCache(outputUrl);
      bgRemovedPhotosRef.current.set(index, localUri);
      console.log(`[Onboarding] Background removal done for image ${index}, cached locally`);
    } catch (error) {
      console.warn(`[Onboarding] Background removal failed for image ${index}:`, error);
    }
  }, []);

  const pickPhotosFromLibrary = useCallback(async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(
        t('onboarding.lab.permissionRequiredTitle'),
        t('onboarding.lab.photoLibraryPermissionMessage'),
      );
      return;
    }

    const remaining = 3 - uploadedPhotos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
      quality: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      const newPhotos = result.assets.map(a => a.uri);
      const currentLength = uploadedPhotos.length;

      setPickerProcessingCount(newPhotos.length);
      try {
        await ensureAssetsLocal(newPhotos);
      } finally {
        setPickerProcessingCount(0);
      }

      setUploadedPhotos(prev => [...prev, ...newPhotos].slice(0, 3));

      // Start background removal for each new photo
      newPhotos.forEach((uri, i) => {
        processBackgroundRemoval(uri, currentLength + i);
      });

      // Run selfie quality validation in parallel (non-blocking)
      console.log(`[Onboarding] Firing selfie validation for ${newPhotos.length} new photos starting at index ${currentLength}`);
      validateImages(newPhotos, currentLength);
    }
  }, [uploadedPhotos, processBackgroundRemoval, validateImages]);

  const takePhotoWithCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('onboarding.lab.permissionRequiredTitle'), t('onboarding.lab.cameraPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    const currentLength = uploadedPhotos.length;

    setPickerProcessingCount(1);
    try {
      await ensureAssetsLocal([uri]);
    } finally {
      setPickerProcessingCount(0);
    }

    setUploadedPhotos((prev) => [...prev, uri].slice(0, 3));
    processBackgroundRemoval(uri, currentLength);
    validateImages([uri], currentLength);
  }, [uploadedPhotos, processBackgroundRemoval, validateImages]);

  const handlePickPhotos = useCallback(async () => {
    if (uploadedPhotos.length >= 3) return;
    // No camera action sheet on web (Alert is a no-op there) — the picker
    // opens the browser file dialog directly.
    if (Platform.OS === 'web') {
      await pickPhotosFromLibrary();
      return;
    }
    Alert.alert(
      t('onboarding.lab.addSelfie'),
      undefined,
      [
        { text: t('onboarding.lab.takePhoto'), onPress: takePhotoWithCamera },
        { text: t('onboarding.lab.chooseFromLibrary'), onPress: pickPhotosFromLibrary },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  }, [uploadedPhotos.length, takePhotoWithCamera, pickPhotosFromLibrary]);

  const handleIntentSelect = useCallback((intent: string) => {
    setSelectedIntents(prev => {
      const next = new Set(prev);
      if (next.has(intent)) {
        next.delete(intent);
      } else {
        next.add(intent);
      }
      AsyncStorage.setItem('@user_intent', JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, []);

  const handleGenerationDone = useCallback(() => {
    setGenerationDone(true);
  }, []);

  const handleStartGeneration = useCallback(async () => {
    console.log('[Onboarding] handleStartGeneration called', {
      realGenerationStarted,
      uploadedPhotosCount: uploadedPhotos.length,
      publicRecipesCount: publicRecipes.length,
      selectedStylesCount: selectedStyles.size,
      selectedStyleIds: Array.from(selectedStyles),
    });

    if (realGenerationStarted || uploadedPhotos.length === 0) {
      console.log('[Onboarding] Skipping generation:', { realGenerationStarted, photos: uploadedPhotos.length });
      return;
    }
    setRealGenerationStarted(true);

    // Get selected recipes (up to 3)
    const selectedRecipes = publicRecipes.filter(r => selectedStyles.has(r.id)).slice(0, 3);
    console.log('[Onboarding] Selected recipes for generation:', selectedRecipes.length,
      selectedRecipes.map(r => ({ id: r.id, name: r.recipe_data?.name, model: r.recipe_data?.steps?.[0]?.modelIds?.[0] })));

    if (selectedRecipes.length === 0) {
      console.warn('[Onboarding] No selected recipes found! publicRecipes:', publicRecipes.length,
        'selectedStyles:', Array.from(selectedStyles));
      return;
    }

    const newIds = new Map<string, { libraryId: string; jobId: string }>();

    for (const recipe of selectedRecipes) {
      const modelId = recipe.recipe_data.steps[0]?.modelIds?.[0];
      const prompt = recipe.recipe_data.steps[0]?.prompts?.[0];
      console.log('[Onboarding] Recipe:', recipe.id, { modelId, promptLength: prompt?.length, hasPrompt: !!prompt });

      if (!modelId || !prompt) {
        console.warn('[Onboarding] Skipping recipe - missing modelId or prompt:', recipe.id);
        continue;
      }

      try {
        // Use bg-removed photos if available, otherwise originals
        const photosForGeneration = uploadedPhotos.map((uri, i) => bgRemovedPhotosRef.current.get(i) || uri);
        console.log('[Onboarding] Calling generate() for recipe:', recipe.id, 'model:', modelId, 'photos:', photosForGeneration.length);
        const result = await generate({
          prompt,
          model: modelId,
          modelName: modelId,
          inputImages: photosForGeneration,
          metadata: { source: 'onboarding' },
          showStartNotification: false,
          showCompletionNotification: false,
          useAlertForErrors: false,
        });

        console.log('[Onboarding] generate() result for recipe:', recipe.id, result ? { libraryId: result.libraryId, jobId: result.jobId } : 'NULL');

        if (result && result.jobId) {
          newIds.set(recipe.id, { libraryId: result.libraryId, jobId: result.jobId });
        }
      } catch (err) {
        console.warn('[Onboarding] Generation failed for recipe:', recipe.id, err);
      }
    }

    console.log('[Onboarding] All generations done. generationLibraryIds:', newIds.size, Array.from(newIds.entries()));
    setGenerationLibraryIds(newIds);
  }, [realGenerationStarted, uploadedPhotos, publicRecipes, selectedStyles, generate]);

  const handleToggleStyle = useCallback((id: string) => {
    setSelectedStyles(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ── Hard-paywall flow v2 state ──────────────────────────────────────────
  const [chosenRefPhoto, setChosenRefPhoto] = useState<ChosenReferencePhoto | null>(null);
  const onbGen = useOnboardingGeneration(hpfConfig);
  // One generation per onboarding session — the retry button, not slide
  // re-activation, is the only way to fire again.
  const hpfGenStartedRef = useRef(false);
  const hpfFlowStartedRef = useRef(false);
  const hpfResultRevealedRef = useRef(false);

  const handleChoosePhoto = useCallback((photo: ChosenReferencePhoto | null) => {
    setChosenRefPhoto(photo);
    if (photo) capturePH('hpf_photo_selected', { source: photo.source });
  }, []);

  const handleHpfRetry = useCallback(() => {
    if (!chosenRefPhoto || uploadedPhotos.length === 0) return;
    onbGen.generate(chosenRefPhoto.uri, uploadedPhotos);
  }, [chosenRefPhoto, uploadedPhotos, onbGen]);

  // Displayed ETA for the generation waiting screen. Explicit config override
  // wins; otherwise it tracks quality (medium ≈ 60s, low ≈ 45s, else 180s) so
  // dropping to a faster tier also shortens the "Ns / ~Xs" readout.
  const hpfEtaSeconds =
    hpfConfig.generation.etaSeconds ??
    (hpfConfig.generation.quality === 'medium'
      ? 60
      : hpfConfig.generation.quality === 'low'
        ? 45
        : 180);

  // Funnel: flow started when the choose-photo slide first becomes visible.
  useEffect(() => {
    if (!hpfFlowRuns || hpfFlowStartedRef.current) return;
    if (slides[currentIndex]?.id !== 'choose-photo') return;
    hpfFlowStartedRef.current = true;
    capturePH('hpf_flow_started');
  }, [hpfFlowRuns, slides, currentIndex]);

  // Kick off the free generation when the generation slide becomes active.
  useEffect(() => {
    if (!hpfFlowRuns || hpfGenStartedRef.current) return;
    if (slides[currentIndex]?.id !== 'onboarding-generation') return;
    if (!chosenRefPhoto || uploadedPhotos.length === 0) return;
    hpfGenStartedRef.current = true;
    onbGen.generate(chosenRefPhoto.uri, uploadedPhotos);
  }, [hpfFlowRuns, slides, currentIndex, chosenRefPhoto, uploadedPhotos, onbGen]);

  // Funnel: result revealed (fires once when the generation completes).
  useEffect(() => {
    if (onbGen.status !== 'completed' || !onbGen.resultUrl) return;
    if (hpfResultRevealedRef.current) return;
    hpfResultRevealedRef.current = true;
    capturePH('hpf_result_revealed');
  }, [onbGen.status, onbGen.resultUrl]);
  // ────────────────────────────────────────────────────────────────────────

  const finishOnboarding = useCallback(() => {
    setIsClosing(true);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      onComplete();
    });
  }, [onComplete, fadeAnim]);

  // Skip the free generation (config gate `generation.allow_skip`). Hands the
  // still-running job to the Library as a normal "processing" tile that
  // completes in the background, then finishes onboarding WITHOUT arming the
  // hard paywall — the user saw no result here, so they fall through to the
  // soft post-onboarding paywall (PostOnboardingFlow).
  const handleSkipHpfGeneration = useCallback(async () => {
    capturePH('hpf_generation_skipped');
    await onbGen.handoffToLibrary();
    if (Platform.OS !== 'web') await MediaLibrary.requestPermissionsAsync();
    finishOnboarding();
  }, [onbGen, finishOnboarding]);

  // Hidden creator gesture (7 taps on the selfie examples): mark the account a
  // creator and skip the initial generation + all onboarding paywalls, landing
  // straight in the app. Coins are granted by hand in Supabase. Remote-killable
  // via app_config.creator_access_enabled.
  const handleCreatorSkip = useCallback(async () => {
    try {
      const enabled = await getAppConfigBool('creator_access_enabled', true);
      if (!enabled) return;
    } catch {
      // config unreachable — allow the skip (fail-open for the creator)
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await setCreatorAccess();
    if (Platform.OS !== 'web') MediaLibrary.requestPermissionsAsync().catch(() => {});
    finishOnboarding();
  }, [finishOnboarding]);

  // Request ATT permission when the first (gallery) slide becomes visible.
  // Runs once per modal session; safe to call multiple times because the system
  // only shows the prompt while status is `undetermined`.
  const attRequestedRef = useRef(false);
  useEffect(() => {
    if (!visible || attRequestedRef.current) return;
    const firstSlideId = slides[0]?.id;
    if (slides[currentIndex]?.id !== firstSlideId) return;
    attRequestedRef.current = true;
    (async () => {
      try {
        const status = await getATTStatus();
        if (status !== 'undetermined') return;
        const next = await requestATT();
        if (next === 'granted' && Platform.OS === 'ios') {
          try {
            await setFBAdvertiserTracking(true);
          } catch {}
        }
      } catch (err) {
        console.warn('[Onboarding] ATT request failed:', err);
      }
    })();
  }, [visible, currentIndex, slides]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      attRequestedRef.current = false;
      fadeAnim.setValue(1);
      setIsClosing(false);
      setCurrentIndex(0);
      setSelectedIntents(new Set());
      setHearSources([]);
      setUploadedPhotos([]);
      setSelectedStyles(new Set());
      setShowLocalPaywall(false);
      setGenerationDone(false);
      setGenerationTimedOut(false);
      setHasAnyGenerationResult(false);
      setFullscreenPhoto(null);
      setPublicRecipes([]);
      setRecipesLoading(false);
      setGenerationLibraryIds(new Map());
      setRealGenerationStarted(false);
      setChosenRefPhoto(null);
      hpfGenStartedRef.current = false;
      hpfFlowStartedRef.current = false;
      hpfResultRevealedRef.current = false;
      scrollViewRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [visible, fadeAnim]);

  // After 90s on generation-results, allow skipping
  useEffect(() => {
    const isOnGenerationSlide = slides[currentIndex]?.id === 'generation-results';
    if (!isOnGenerationSlide || generationDone) {
      return;
    }
    const timer = setTimeout(() => {
      setGenerationTimedOut(true);
    }, 90000);
    return () => clearTimeout(timer);
  }, [currentIndex, generationDone]);

  // Fetch public recipes when modal opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const fetchRecipes = async () => {
      setRecipesLoading(true);
      try {
        const recipes = await browsePublicRecipes({ limit: 15, onboardingOnly: true });
        if (cancelled) return;
        // Filter to recipes with cover image + valid model + prompt
        const valid = recipes.filter(r =>
          r.example_result_url &&
          r.recipe_data?.steps?.[0]?.modelIds?.[0] &&
          r.recipe_data?.steps?.[0]?.prompts?.[0]
        );
        setPublicRecipes(valid);
      } catch (err) {
        console.warn('[Onboarding] Failed to fetch recipes:', err);
      } finally {
        if (!cancelled) setRecipesLoading(false);
      }
    };

    fetchRecipes();
    return () => { cancelled = true; };
  }, [visible]);

  // Complete onboarding when local paywall is dismissed
  const handlePaywallClose = useCallback(async () => {
    setShowLocalPaywall(false);
    // Refresh subscription status so CoinBalance shows premium crown
    await refreshSubscription();
    finishOnboarding();
  }, [finishOnboarding, refreshSubscription]);

  // Persist the uploaded selfies as the "You" soul. Called from both the
  // Continue path and the Skip path so the user never loses their upload.
  // Falls back to the original picker URI if a bg-removed cache entry is
  // missing or unreadable. No-ops cleanly when there are no photos.
  const saveYouSoul = useCallback(async () => {
    if (uploadedPhotos.length === 0) return;
    if (isSavingSoulRef.current) return;
    isSavingSoulRef.current = true;
    try {
      // Verify each bg-removed cache file still exists; otherwise fall back.
      const soulPhotos = await Promise.all(
        uploadedPhotos.map(async (uri, i) => {
          const bgRemoved = bgRemovedPhotosRef.current.get(i);
          if (!bgRemoved) return uri;
          try {
            const info = await FileSystemLegacy.getInfoAsync(bgRemoved);
            return info.exists ? bgRemoved : uri;
          } catch {
            return uri;
          }
        }),
      );
      console.log('[Onboarding] Saving "You" soul with', soulPhotos.length, 'photos');
      const existingYou = souls.find((s) => s.name === 'You');
      if (existingYou) {
        await updateSoul(existingYou.id, { name: 'You', imageUris: soulPhotos });
        console.log('[Onboarding] Updated existing "You" soul');
      } else {
        const newId = await addSoul({ name: 'You', imageUris: soulPhotos });
        console.log('[Onboarding] Created new "You" soul:', newId);
      }
    } catch (err) {
      console.error('[Onboarding] Failed to save soul:', err);
    } finally {
      isSavingSoulRef.current = false;
    }
  }, [uploadedPhotos, souls, addSoul, updateSoul]);

  // Skip upload → save anything already picked, then jump to the paywall.
  const handleSkipUpload = useCallback(async () => {
    await saveYouSoul();
    if (Platform.OS !== 'web') await MediaLibrary.requestPermissionsAsync();
    // Aya shows the paywall AFTER onboarding closes (PostOnboardingFlow) to avoid
    // the stale-UIViewController bug from presenting a native paywall inside this
    // RN <Modal>. So complete here; completeOnboarding() triggers the post-flow.
    finishOnboarding();
  }, [saveYouSoul]);

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: false }
  );

  const handleScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / SCREEN_WIDTH);
    setCurrentIndex(index);
  }, []);

  // Advance to a specific next slide. On web, smooth scrolling gets
  // interrupted by layout churn (e.g. the consent dialog unmounting) and
  // strands the carousel between slides — jump instantly instead.
  const advanceToSlide = useCallback((nextIndex: number) => {
    scrollViewRef.current?.scrollTo({
      x: nextIndex * SCREEN_WIDTH,
      animated: Platform.OS !== 'web',
    });
    // Visual opacity/scale interpolate from scrollX — sync it explicitly on
    // web where the instant jump may not emit a scroll event.
    if (Platform.OS === 'web') scrollX.setValue(nextIndex * SCREEN_WIDTH);
    setCurrentIndex(nextIndex);
  }, [scrollX]);

  // Generation-failure escape hatch: jump back to the choose-photo step
  // (failures are often photo-specific — moderation, bad reference). Re-arms
  // the auto-start so returning to the generation slide fires fresh.
  const handleHpfChangePhotos = useCallback(() => {
    hpfGenStartedRef.current = false;
    const idx = slides.findIndex((s) => s.id === 'choose-photo');
    if (idx >= 0) advanceToSlide(idx);
  }, [slides, advanceToSlide]);

  const goToNext = useCallback(async () => {
    const currentSlide = slides[currentIndex];

    // Log the "how did you hear" answer when leaving that slide.
    if (currentSlide?.id === 'how-did-you-hear') {
      if (hearSources.length > 0) {
        capturePH('onboarding_hear_source_selected', { sources: hearSources });
      }
    }

    // Show the AI data-sharing consent dialog when leaving the feature-edit
    // slide — the user must approve before any face photo is sent to Fal.ai.
    // This runs REGARDLESS of whether the selfie-upload step is enabled, so
    // every user passes the consent during onboarding (the remote selfie-step
    // kill-switch no longer hides it). Native only: the deliberately-short web
    // ad funnel skips this. Identical disclosure copy is reused at first
    // generation via ensureAIConsent().
    //   • Allow + selfie step on  → record consent, advance into the upload step
    //     (or the hard-paywall flow's choose-photo step when that flow runs).
    //   • Allow + selfie step off → record consent, finish onboarding → paywall
    //     (feature-edit is then the last slide; no data is sent here).
    //   • Not Now                 → skip the upload step and finish onboarding;
    //     no data is sent, and consent is re-requested lazily at first upload.
    if (currentSlide?.id === 'feature-edit' && Platform.OS !== 'web') {
      const agreed = await promptAIConsentDialog();
      if (agreed) await persistAIConsent();
      if (agreed && (selfieStepEnabled || hpfFlowRuns)) {
        advanceToSlide(currentIndex + 1);
      } else {
        await MediaLibrary.requestPermissionsAsync();
        // Aya shows the paywall AFTER onboarding closes (PostOnboardingFlow) to avoid
        // the stale-UIViewController bug from presenting a native paywall inside this
        // RN <Modal>. So complete here; completeOnboarding() triggers the post-flow.
        finishOnboarding();
      }
      return;
    }

    // Save selfies as "You" soul when leaving the upload step.
    if (currentSlide?.id === 'upload-selfies') {
      await saveYouSoul();
    }

    // Hard-paywall flow: leaving the generation slide (the last slide when the
    // flow runs). Arm the hard paywall ONLY when a result was actually
    // delivered AND the paywall is enabled — a failed/aborted generation, or a
    // config with `paywall.enabled` off, falls back to the normal soft
    // post_onboarding paywall so we never hard-lock a user (or leave them with
    // NO paywall because the pending key made PostOnboardingFlow stand down).
    if (currentSlide?.id === 'onboarding-generation') {
      if (hpfConfig.paywall.enabled && onbGen.status === 'completed' && onbGen.resultUrl) {
        try {
          await AsyncStorage.setItem(HARD_PAYWALL_PENDING_KEY, 'true');
          // Admin override: also arm the preview bypass so a subscribed /
          // coin-holding admin device still sees the hard paywall (with a
          // forced close button after 2s) for testing the full flow.
          if (await getHardPaywallAdminOverride()) {
            await AsyncStorage.setItem(HARD_PAYWALL_PREVIEW_KEY, 'true');
          }
        } catch (err) {
          console.warn('[Onboarding] Failed to arm hard paywall:', err);
        }
      }
      if (Platform.OS !== 'web') await MediaLibrary.requestPermissionsAsync();
      finishOnboarding();
      return;
    }

    // Advancing past the last slide → show paywall, then finishOnboarding via handlePaywallClose.
    if (currentIndex >= slides.length - 1) {
      if (Platform.OS !== 'web') await MediaLibrary.requestPermissionsAsync();
      // Aya shows the paywall AFTER onboarding closes (PostOnboardingFlow) to avoid
    // the stale-UIViewController bug from presenting a native paywall inside this
    // RN <Modal>. So complete here; completeOnboarding() triggers the post-flow.
    finishOnboarding();
    } else {
      advanceToSlide(currentIndex + 1);
    }
  }, [currentIndex, slides, finishOnboarding, hearSources, uploadedPhotos, saveYouSoul, advanceToSlide, selfieStepEnabled, hpfFlowRuns, hpfConfig, onbGen.status, onbGen.resultUrl]);

  const goToSlide = useCallback((index: number) => {
    scrollViewRef.current?.scrollTo({
      x: index * SCREEN_WIDTH,
      animated: Platform.OS !== 'web',
    });
    if (Platform.OS === 'web') scrollX.setValue(index * SCREEN_WIDTH);
    setCurrentIndex(index);
  }, [scrollX]);

  const renderVisualElement = (slide: OnboardingSlide, index: number) => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];

    const scale = scrollX.interpolate({
      inputRange,
      outputRange: [0.8, 1, 0.8],
      extrapolate: 'clamp',
    });

    const opacity = scrollX.interpolate({
      inputRange,
      outputRange: [0.3, 1, 0.3],
      extrapolate: 'clamp',
    });

    switch (slide.visualHint) {
      case 'hero-video':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} />
          </View>
        );

      // 'how-did-you-hear' is rendered by its own full-screen branch in renderSlide.

      case 'image-gallery':
        return USE_CARD_STACK_GALLERY ? (
          <Animated.View style={[styles.visualContainer, styles.visualContainerGallery, { transform: [{ scale }] }]}>
            <CardStackGallery isActive={currentIndex === index} />
          </Animated.View>
        ) : (
          <Animated.View style={[styles.visualContainer, styles.visualContainerGallery, { transform: [{ scale }] }]}>
            <ImageGalleryGrid isActive={currentIndex === index} />
          </Animated.View>
        );

      case 'model-cards':
        return (
          <Animated.View style={[styles.visualContainer, { transform: [{ scale }], opacity }]}>
            <ModelCardsAnimation isActive={currentIndex === index} />
          </Animated.View>
        );

      case 'editing':
        return (
          <Animated.View style={[styles.visualContainer, { transform: [{ scale }], opacity }]}>
            <EditingAnimation isActive={currentIndex === index} />
          </Animated.View>
        );

      case 'how-it-works':
        return (
          <Animated.View style={[styles.visualContainer, styles.howItWorksVisual, { transform: [{ scale }], opacity }]}>
            <HowItWorksSlideshow />
          </Animated.View>
        );

      case 'intent-picker':
        return (
          <Animated.View style={[styles.visualContainer, styles.visualContainerIntent, { transform: [{ scale }], opacity }]}>
            <IntentPicker selectedIntents={selectedIntents} onSelect={handleIntentSelect} />
          </Animated.View>
        );

      case 'upload-selfies':
        return (
          <Animated.View style={[styles.visualContainer, { transform: [{ scale }], opacity }]}>
            <UploadSelfiesStep photos={uploadedPhotos} onPickPhotos={handlePickPhotos} onRemovePhoto={handleRemovePhoto} validationResults={validationResults} isValidating={isValidating} validatingIndices={validatingIndices} onDismissResult={dismissResult} pickerProcessingCount={pickerProcessingCount} onSecretSkip={handleCreatorSkip} />
          </Animated.View>
        );

      case 'feature-agent':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} source={AGENT_VIDEO_SOURCE} />
          </View>
        );

      case 'feature-photoshoot':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} source={PHOTOSHOOT_VIDEO_SOURCE} />
          </View>
        );

      case 'feature-upscale':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} source={UPSCALE_VIDEO_SOURCE} />
          </View>
        );

      case 'feature-effects':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} source={EFFECTS_VIDEO_SOURCE} />
          </View>
        );

      case 'feature-edit':
        return (
          <View style={styles.heroVideoWrapper}>
            <HeroVideoSlide isActive={currentIndex === index} source={EDIT_VIDEO_SOURCE} />
          </View>
        );

      case 'rate-us':
        return (
          <Animated.View style={[styles.visualContainer, { transform: [{ scale }], opacity }]}>
            <RateUsStep />
          </Animated.View>
        );

      case 'pick-styles':
        return (
          <Animated.View style={[styles.visualContainer, styles.visualContainerPickStyles, { transform: [{ scale }], opacity }]}>
            <StylePickerStep selectedStyles={selectedStyles} onToggleStyle={handleToggleStyle} recipes={publicRecipes} loading={recipesLoading} />
          </Animated.View>
        );

      case 'generation-results':
        return (
          <Animated.View style={[styles.visualContainer, { transform: [{ scale }], opacity }]}>
            <GenerationResultsStep
              selectedStyles={selectedStyles}
              isActive={currentIndex === index}
              onGenerationDone={handleGenerationDone}
              onFirstResult={() => setHasAnyGenerationResult(true)}
              onPhotoTap={setFullscreenPhoto}
              recipes={publicRecipes}
              uploadedPhotos={uploadedPhotos}
              onStartGeneration={handleStartGeneration}
              generationLibraryIds={generationLibraryIds}
              libraryImages={libraryImages}
            />
          </Animated.View>
        );

      default:
        return null;
    }
  };

  const renderSlide = (slide: OnboardingSlide, index: number) => {
    const isGallerySlide = slide.visualHint === 'image-gallery';
    const isFeatureVideoSlide = slide.visualHint === 'feature-photoshoot' || slide.visualHint === 'feature-upscale' || slide.visualHint === 'feature-edit' || slide.visualHint === 'feature-agent';
    const isHeroVideoSlide = slide.visualHint === 'hero-video' || isFeatureVideoSlide;
    const isIntentSlide = slide.visualHint === 'intent-picker';
    const isHearSlide = slide.visualHint === 'how-did-you-hear';
    const isPickStylesSlide = slide.visualHint === 'pick-styles';
    const isTopTextSlide = isIntentSlide || isPickStylesSlide || isHearSlide;

    // First slide: full-bleed auto carousel with title + laurels overlaid in
    // the top gradient band. Bypasses the normal padded slide layout.
    if (slide.id === 'hero-video') {
      return (
        <View key={slide.id} style={[styles.slide, { width: SCREEN_WIDTH }]}>
          <View style={styles.slideBackground} />
          <HeroPhotoCarousel
            isActive={currentIndex === index}
            title={t(slide.titleKey)}
            topInset={insets.top}
          />
        </View>
      );
    }

    // How-did-you-hear: full-screen native scroll (title + options), fixed button.
    if (isHearSlide) {
      return (
        <View key={slide.id} style={[styles.slide, { width: SCREEN_WIDTH }]}>
          <View style={styles.slideBackground} />
          <HowDidYouHearPicker
            title={t(slide.titleKey)}
            topInset={insets.top}
            bottomInset={insets.bottom}
            selected={hearSources}
            onToggle={(id) =>
              setHearSources((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
              )
            }
          />
        </View>
      );
    }

    // Hard-paywall flow: choose the reference photo. Full-screen (own scroll),
    // titles rendered inside the component.
    if (slide.id === 'choose-photo') {
      return (
        <View key={slide.id} style={[styles.slide, { width: SCREEN_WIDTH }]}>
          <View style={styles.slideBackground} />
          <ChoosePhotoStep
            topInset={insets.top}
            bottomInset={insets.bottom}
            selected={chosenRefPhoto}
            onSelect={handleChoosePhoto}
          />
        </View>
      );
    }

    // Hard-paywall flow: free generation (waiting → reveal → failure states
    // all live inside the component).
    if (slide.id === 'onboarding-generation') {
      return (
        <View key={slide.id} style={[styles.slide, { width: SCREEN_WIDTH }]}>
          <View style={styles.slideBackground} />
          <View style={{ flex: 1, paddingTop: insets.top + 44, paddingBottom: insets.bottom + 104 }}>
            <OnboardingGenerationStep
              isActive={currentIndex === index}
              status={onbGen.status}
              resultUrl={onbGen.resultUrl}
              error={onbGen.error}
              canRetry={onbGen.canRetry}
              referenceUri={chosenRefPhoto?.uri ?? null}
              selfieUri={uploadedPhotos[0] ?? null}
              etaSeconds={hpfEtaSeconds}
              onRetry={handleHpfRetry}
              onChangePhotos={handleHpfChangePhotos}
              onPhotoTap={(uri) => setFullscreenPhoto({ uri })}
            />
          </View>
        </View>
      );
    }

    return (
      <View key={slide.id} style={[styles.slide, { width: SCREEN_WIDTH }]}>
        <View style={styles.slideBackground} />

        <View style={[styles.slideContent, { paddingTop: isGallerySlide ? 0 : isHeroVideoSlide ? insets.top + 34 : insets.top + 40, paddingHorizontal: isGallerySlide || isHeroVideoSlide ? 0 : isPickStylesSlide ? STYLE_GRID_PADDING : 32 }]}>
          {/* Text content at top for intent / hear / pick-styles slides */}
          {isTopTextSlide && (
            <View style={styles.textWrapperTop}>
              {isHearSlide && (
                <Image
                  source={HEAR_ILLUSTRATION_SOURCE}
                  style={[styles.hearIllustration, { width: hearIllustrationSize, height: hearIllustrationSize }]}
                  resizeMode="contain"
                />
              )}
              <Text style={styles.title}>
                {isPickStylesSlide ? t(getPickStylesTitleKey(selectedStyles.size)) : t(slide.titleKey)}
              </Text>
              {!!slide.subtitleKey && (
                <Text style={styles.subtitle}>{t(slide.subtitleKey)}</Text>
              )}
            </View>
          )}

          {/* Visual element */}
          <View style={[styles.visualWrapper, (isIntentSlide || isHearSlide || isPickStylesSlide) && styles.visualWrapperIntent, isHeroVideoSlide && styles.visualWrapperHero]}>
            {renderVisualElement(slide, index)}
          </View>

          {/* Text content at bottom - hidden for top-text slides */}
          {!isTopTextSlide && (
            <View style={[styles.textWrapper, isGallerySlide && { paddingHorizontal: 32 }]}>
              {slide.id === 'feature-photoshoot' && (
                <View style={styles.viralBadge}>
                  <Flame size={13} color="#FF2D95" fill="#FF2D95" />
                  <Text style={styles.viralBadgeText}>{t('onboarding.hpf.result.viralBadge')}</Text>
                </View>
              )}
              <Text style={styles.title}>
                {slide.id === 'generation-results' && generationDone
                  ? t('onboarding.lab.photosReady')
                  : t(slide.titleKey)}
              </Text>
              {slide.id === 'generation-results' && !generationDone ? (
                <GenerationProgressOverlay
                  isActive={currentIndex === index}
                  generationDone={generationDone}
                />
              ) : (
                // The upload-selfies slide shows its rules as green-icon tips
                // above the dropzone, so the bottom subtitle would be redundant.
                ((slide.id === 'generation-results' && generationDone) ||
                  (!!slide.subtitleKey && slide.id !== 'upload-selfies')) ? (
                  <Text style={styles.subtitle}>
                    {slide.id === 'generation-results' && generationDone
                      ? t('onboarding.lab.photosInLibrary')
                      : t(slide.subtitleKey)}
                  </Text>
                ) : null
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderPagination = () => (
    <View style={styles.pagination}>
      {slides.map((_, index) => {
        const inputRange = [
          (index - 1) * SCREEN_WIDTH,
          index * SCREEN_WIDTH,
          (index + 1) * SCREEN_WIDTH,
        ];

        const dotWidth = scrollX.interpolate({
          inputRange,
          outputRange: [8, 24, 8],
          extrapolate: 'clamp',
        });

        const dotOpacity = scrollX.interpolate({
          inputRange,
          outputRange: [0.3, 1, 0.3],
          extrapolate: 'clamp',
        });

        return (
          <TouchableOpacity key={index} onPress={() => goToSlide(index)} activeOpacity={0.7}>
            <Animated.View
              style={[
                styles.dot,
                {
                  width: dotWidth,
                  opacity: dotOpacity,
                  backgroundColor: '#444',
                },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const isLastSlide = currentIndex === slides.length - 1;
  const isHeroSlide = slides[currentIndex]?.id === 'hero-video';
  const isGenerationResultsSlide = slides[currentIndex]?.id === 'generation-results';
  const isUploadSlide = slides[currentIndex]?.visualHint === 'upload-selfies';
  const isPickStylesSlide = slides[currentIndex]?.visualHint === 'pick-styles';
  const isIntentSlide = slides[currentIndex]?.visualHint === 'intent-picker';
  const isHearSlide = slides[currentIndex]?.visualHint === 'how-did-you-hear';
  const isRateUsSlide = slides[currentIndex]?.id === 'rate-us';

  const isChoosePhotoSlide = slides[currentIndex]?.id === 'choose-photo';
  const isHpfGenerationSlide = slides[currentIndex]?.id === 'onboarding-generation';

  const isIntentDisabled = isIntentSlide && selectedIntents.size === 0;
  const isHearDisabled = isHearSlide && hearSources.length === 0;
  const isUploadDisabled = isUploadSlide && (uploadedPhotos.length === 0 || isValidating);
  const isPickStylesDisabled = isPickStylesSlide && selectedStyles.size === 0;
  const isGenerationStillRunning = isGenerationResultsSlide && !generationDone && !generationTimedOut && !hasAnyGenerationResult;
  const isChoosePhotoDisabled = isChoosePhotoSlide && !chosenRefPhoto;
  // The generation slide's CTA unlocks on reveal (Continue → hard paywall),
  // once retries are exhausted, or when generation can never start (photo
  // step skipped / no selfies) — those fall through to the soft paywall.
  const hpfGenerationCannotStart =
    onbGen.status === 'idle' && (!chosenRefPhoto || uploadedPhotos.length === 0);
  const isHpfGenerationLocked =
    isHpfGenerationSlide &&
    !(onbGen.status === 'completed' || (onbGen.status === 'failed' && !onbGen.canRetry) || hpfGenerationCannotStart);
  const isCTADisabled = isIntentDisabled || isHearDisabled || isUploadDisabled || isPickStylesDisabled || isGenerationStillRunning || isChoosePhotoDisabled || isHpfGenerationLocked;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      statusBarTranslucent
      transparent={true}
    >
      <View style={styles.modalBackground}>
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Slides */}
        <Animated.ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
          bounces={false}
          scrollEnabled={!isIntentSlide && !isHearSlide && !isUploadSlide && !isPickStylesSlide && !isGenerationResultsSlide && !isChoosePhotoSlide && !isHpfGenerationSlide}
        >
          {slides.map(renderSlide)}
        </Animated.ScrollView>

        {/* Top pagination dots — hidden on the hero-video slide */}
        {slides[currentIndex]?.visualHint !== 'hero-video' && (
          <View style={[styles.topPagination, { top: insets.top + 4 }]}>
            {renderPagination()}
          </View>
        )}

        {/* Top-right Skip for upload step. Hidden in the hard-paywall flow —
            the free generation needs selfies, so the step is mandatory there
            (choose-photo has no skip either). Legacy onboarding keeps it. */}
        {isUploadSlide && !hpfFlowRuns && (
          <TouchableOpacity
            onPress={handleSkipUpload}
            activeOpacity={0.7}
            style={[styles.skipTopRight, { top: insets.top + 8 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.skipTopRightText}>{t('common.skip')}</Text>
          </TouchableOpacity>
        )}

        {/* Hard-paywall flow: optional skip on the generation waiting screen
            (config `generation.allow_skip`). Only while the result hasn't
            landed — skipping bails to the soft paywall (no hard-paywall arm).
            Once completed, the CTA becomes "Continue → hard paywall" instead. */}
        {isHpfGenerationSlide && hpfConfig.generation.allowSkip && onbGen.status !== 'completed' && (
          <TouchableOpacity
            onPress={handleSkipHpfGeneration}
            activeOpacity={0.7}
            style={[styles.skipTopRight, { top: insets.top + 8 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.skipTopRightText}>{t('common.skip')}</Text>
          </TouchableOpacity>
        )}

        {/* On the hero slide, let the photo run under the buttons: drop the
            opaque bar and lay down a soft gradient scrim for legibility. */}
        {isHeroSlide && (
          <LinearGradient
            colors={['rgba(8,8,8,0)', 'rgba(8,8,8,0.85)']}
            style={styles.bottomScrim}
            pointerEvents="none"
          />
        )}

        {/* Bottom controls */}
        <View style={[styles.bottomContainer, isHeroSlide && styles.bottomContainerTransparent, { paddingBottom: insets.bottom + 10 }]}>

          {/* CTA Button */}
          <TouchableOpacity
              style={[
                styles.ctaButton,
                isLastSlide && styles.ctaButtonFinal,
                isCTADisabled && styles.ctaButtonDisabled,
              ]}
              onPress={isCTADisabled ? undefined : goToNext}
              activeOpacity={isCTADisabled ? 1 : 0.9}
              disabled={isCTADisabled}
            >
              {isUploadSlide && isValidating && (
                <ActivityIndicator size="small" color="#000" style={{ marginRight: 8 }} />
              )}
              <Text style={[
                styles.ctaText,
                isLastSlide && styles.ctaTextFinal,
                isCTADisabled && styles.ctaTextDisabled,
              ]}>
                {isUploadSlide && isValidating
                  ? (validationCountdown > 0
                    ? t('onboarding.lab.cta.checkingQualityCountdown', { n: validationCountdown })
                    : t('onboarding.lab.cta.checkingQuality'))
                  : isGenerationResultsSlide
                  ? (generationDone || hasAnyGenerationResult
                    ? t('onboarding.lab.cta.saveAndContinue')
                    : generationTimedOut
                      ? t('onboarding.lab.cta.continueResultsInLibrary')
                      : t('common.continue'))
                  : isRateUsSlide ? t('onboarding.lab.cta.rateUs') : isLastSlide ? t('onboarding.lab.cta.startExploring') : t('common.continue')}
              </Text>
              {!isCTADisabled && !isValidating && <ArrowRight size={20} color="#000" />}
            </TouchableOpacity>
        </View>
      </Animated.View>
      </View>

      {/* Full-screen photo viewer */}
      {fullscreenPhoto && (
        <TouchableOpacity
          style={styles.fullscreenOverlay}
          activeOpacity={1}
          onPress={() => setFullscreenPhoto(null)}
        >
          {/* expo-image shares its disk/memory cache with the result tiles,
              so the already-loaded photo opens instantly (RN Image re-fetched
              the remote URL from scratch — 3-4s delay). */}
          <ExpoImage
            source={fullscreenPhoto}
            style={styles.fullscreenImage}
            contentFit="contain"
            transition={80}
          />
          <View style={[styles.fullscreenClose, { top: insets.top + 12 }]}>
            <Text style={styles.fullscreenCloseText}>✕</Text>
          </View>
        </TouchableOpacity>
      )}

      <OnboardingPaywallModal visible={showLocalPaywall} onClose={handlePaywallClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackground: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    // Modal portals render outside #root, so the phone column is enforced
    // here: content column centered, modalBackground paints the sides black.
    ...(Platform.OS === 'web' && {
      width: '100%',
      maxWidth: WEB_MAX_WIDTH,
      alignSelf: 'center' as const,
    }),
  },
  slide: {
    flex: 1,
    position: 'relative',
  },
  slideBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
  },
  slideContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  visualWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualWrapperIntent: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  visualWrapperHero: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  heroVideoWrapper: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
  },

  // First-slide full-bleed photo carousel
  heroCarouselRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080808',
  },
  heroCarouselImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroCarouselTopGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Math.round(SCREEN_HEIGHT * 0.40),
  },
  heroCarouselTextWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 4,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
  },
  laurel: { width: 15, height: 36 },
  laurelFlip: { transform: [{ scaleX: -1 }] },
  heroCarouselBottomGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 280 },
  heroAgentCardWrap: { position: 'absolute', left: 20, right: 20, bottom: 140 },
  heroAgentCard: {
    borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  heroAgentScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  heroAgentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  heroAgentMascot: { width: 60, height: 60, tintColor: '#ffffff' },
  heroAgentTitle: {
    color: '#ffffff', fontFamily: 'SFRounded-Medium', fontSize: 18, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  heroAgentSub: {
    color: '#ffffff', fontSize: 14, lineHeight: 19, marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  statText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: 'SFRounded-Medium',
  },
  // Narrow enough that "1M+ photos generated" wraps to two lines on its own.
  // maxWidth (not a hardcoded \n) lets each locale wrap where it fits — short
  // translations stay one line, long ones break naturally.
  statTextWrap: {
    maxWidth: 92,
  },
  statRating: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 26,
    fontFamily: 'SFRounded-Medium',
  },
  statStars: {
    flexDirection: 'row',
    gap: 1,
    marginTop: 2,
  },
  hearIllustration: {
    width: 200,
    height: 200,
    alignSelf: 'center',
    marginBottom: 8,
  },
  hearFullScroll: {
    flex: 1,
    alignSelf: 'stretch',
  },
  hearFullContent: {
    paddingHorizontal: 32,
  },
  hearList: {
    width: '100%',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 130,
  },
  hearOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  hearOptionSelected: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  hearOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  hearOptionTextSelected: {
    color: '#000',
  },
  textWrapperTop: {
    alignItems: 'center',
    marginBottom: 24,
  },
  textWrapper: {
    alignItems: 'center',
    paddingBottom: 170, // Space for bottom controls
  },
  viralBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,45,149,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,149,0.35)',
  },
  viralBadgeText: {
    color: '#FF2D95',
    fontSize: 12,
    fontFamily: 'SFRounded-Medium',
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Visual elements
  visualContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualContainerGallery: {
    height: GALLERY_HEIGHT,
    width: SCREEN_WIDTH,
    alignItems: 'stretch',
  },
  // Image gallery grid — 2 rows of vertical portrait cards
  imageGalleryContainer: {
    width: SCREEN_WIDTH,
    height: GALLERY_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  imageGalleryInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: 10,
  },
  imageGalleryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  imageGalleryCard: {
    width: 150,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  imageGalleryCardImage: {
    width: '100%',
    height: '100%',
  },
  imageGalleryEdgeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 30,
  },
  imageGalleryEdgeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
  },

  // Card stack / fan gallery
  stackContainer: {
    width: SCREEN_WIDTH,
    height: GALLERY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackCard: {
    position: 'absolute',
    width: STACK_CARD_W,
    height: STACK_CARD_H,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    // Depth shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  stackCardImage: {
    width: '100%' as any,
    height: '100%' as any,
  },

  // Social proof badge — floating on top of gallery
  socialProofBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 10,
  },
  socialProofText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
  },

  // Mock cards visualization
  mockCardsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: -25,
  },
  mockCardsRow2: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  mockCard: {
    width: 115,
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  mockCardSmall: {
    width: 90,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  mockCardImageContainer: {
    height: 65,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mockCardImageSmallContainer: {
    height: 48,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  geoLogo: {
    // Base style, dimensions set inline
  },
  geoLogoTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  mockCardText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Manrope-SemiBold',
    marginBottom: 4,
  },
  mockCardTextSmall: {
    color: '#999',
    fontSize: 9,
    fontFamily: 'Manrope-Medium',
  },
  mockCardPrice: {
    backgroundColor: YELLOW_DIM,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  mockCardPriceText: {
    color: YELLOW,
    fontSize: 9,
    fontFamily: 'Manrope-Bold',
  },

  // Prompt bubble for gallery
  promptBubble: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#333',
    maxWidth: 260,
  },
  promptText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'Manrope-Regular',
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Gallery visualization - 2x2 grid
  galleryGrid: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  galleryColumn: {
    gap: 10,
  },
  galleryGridItem: {
    alignItems: 'center',
  },
  galleryImageContainer: {
    position: 'relative',
  },
  galleryGridImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
  },
  galleryLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(20, 20, 20, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryLabel: {
    marginTop: 8,
    backgroundColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  galleryLabelText: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'Manrope-Medium',
  },

  // Recipe slideshow visualization
  recipeSlideshowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
  },
  recipeSlideshowCard: {
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  recipeSlideshowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recipeSlideshowImage: {
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
  },
  recipeSlideshowLabel: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    marginTop: 12,
    textAlign: 'center',
  },

  // Cloud sync - history list visualization
  historyContainer: {
    width: 280,
    gap: 8,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222',
    gap: 10,
  },
  historyCardFirst: {
    borderColor: '#333',
  },
  historyContent: {
    flex: 1,
    position: 'relative',
    height: 38,
    justifyContent: 'center',
  },
  skeletonContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
  },
  textContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyTitle: {
    color: YELLOW,
    fontSize: 13,
    fontFamily: 'Manrope-SemiBold',
  },
  historyPrompt: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'Manrope-Regular',
  },
  skeletonTitle: {
    width: 80,
    height: 14,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonPrompt: {
    width: 180,
    height: 10,
    backgroundColor: '#222',
    borderRadius: 4,
  },
  historyTime: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'Manrope-Regular',
  },
  syncedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: YELLOW_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Character stack visualization - overlapping scattered photos
  characterStackContainer: {
    width: 320,
    height: 360,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  characterCard: {
    position: 'absolute',
    width: 140,
    height: 180,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    // No background - show PNG transparency
  },
  characterCardImage: {
    width: '100%',
    height: '100%',
  },

  // Editing animation visualization
  editingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  editingImageContainer: {
    width: 200,
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  editingImage: {
    width: '100%',
    height: '100%',
  },
  editingStrokeLeft: {
    position: 'absolute',
    top: '42%',
    left: 8,
    width: 55,
    height: 10,
    backgroundColor: '#E84444',
    borderRadius: 5,
    shadowColor: '#E84444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    transformOrigin: 'left',
  },
  editingStrokeRight: {
    position: 'absolute',
    top: '42%',
    right: 8,
    width: 55,
    height: 10,
    backgroundColor: '#E84444',
    borderRadius: 5,
    shadowColor: '#E84444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    transformOrigin: 'right',
  },
  editingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  editingLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  editingBrushIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editingBrushDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4444',
  },
  editingLabelText: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
  },

  // Intent picker - 2-column, 3-row grid of cards
  visualContainerIntent: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  intentScroll: {
    flex: 1,
  },
  intentScrollContent: {
    gap: 12,
    paddingBottom: 130,
  },
  intentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  intentCardWrapper: {
    flex: 1,
  },
  intentCard: {
    height: Math.floor((SCREEN_WIDTH - 64 - 12) / 2 * 0.75),
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    padding: 14,
    gap: 10,
  },
  intentCardSelected: {
    backgroundColor: YELLOW_DIM,
    borderColor: YELLOW,
  },
  intentCardText: {
    color: '#999',
    fontSize: 15,
    fontFamily: 'Manrope-Medium',
  },
  intentCardTextSelected: {
    color: YELLOW,
  },

  // How it works visual
  howItWorksVisual: {
    height: Math.round(SCREEN_HEIGHT * 0.5),
    width: SCREEN_WIDTH - 64,
  },
  howItWorksComposedImage: {
    width: SCREEN_WIDTH - 64,
    height: Math.round(SCREEN_HEIGHT * 0.5),
    position: 'absolute',
    top: 0,
    left: 0,
  },

  // Text
  title: {
    fontSize: 40,
    fontFamily: 'SFRounded-Medium',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'SFRounded-Regular',
    color: '#888',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 320,
  },
  consentLink: {
    textDecorationLine: 'underline' as const,
  },

  // Top pagination
  topPagination: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },

  // Bottom controls
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
  },
  bottomContainerTransparent: {
    backgroundColor: 'transparent',
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.round(SCREEN_HEIGHT * 0.30),
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },

  // CTA Button — white pill, rounded font (matches home tab design language)
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 72,
    gap: 8,
    borderRadius: 36,
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  ctaButtonFinal: {
    backgroundColor: '#ffffff',
  },
  ctaText: {
    color: '#000',
    fontSize: 20,
    fontFamily: 'SFRounded-Medium',
  },
  ctaTextFinal: {
    color: '#000',
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  skipText: {
    color: '#666',
    fontSize: 14,
    fontFamily: 'Manrope-Medium',
  },
  skipTopRight: {
    position: 'absolute',
    right: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    zIndex: 20,
  },
  skipTopRightText: {
    color: '#888',
    fontSize: 16,
    fontFamily: 'SFRounded-Medium',
  },
  ctaButtonDisabled: {
    backgroundColor: '#E5E5E5',
  },
  ctaTextDisabled: {
    color: '#999',
  },

  // Rate-us step
  rateUsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  rateUsStarsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 28,
  },
  rateUsCopy: {
    color: '#bbb',
    fontSize: 17,
    lineHeight: 24,
    fontFamily: 'SFRounded-Regular',
    textAlign: 'center',
    maxWidth: 300,
  },

  // Upload selfies step — dark theme matching other slides
  uploadStepContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 280,
  },
  uploadPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: -40,
    zIndex: 2,
  },
  uploadPreviewCenter: {
    width: 220,
    height: 220,
    zIndex: 3,
    transform: [{ rotate: '0deg' }],
  },
  // Good-selfie examples + rules block (replaces the illustration).
  // Positive marginBottom so it never overlaps the tap-to-upload area.
  uploadGuide: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 18,
    zIndex: 2,
  },
  uploadExamplesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  uploadExampleCard: {
    width: 88,
    height: 117,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'rgba(74,222,128,0.5)',
  },
  uploadExampleImg: {
    width: '100%',
    height: '100%',
  },
  uploadExampleCheck: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadTips: {
    alignSelf: 'stretch',
    gap: 7,
    paddingLeft: 8,
  },
  uploadTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  uploadTipText: {
    color: '#d1d5db',
    fontSize: 13.5,
    fontFamily: 'Manrope-Medium',
    flexShrink: 1,
  },
  uploadStepArea: {
    width: 280,
    height: 360,
    backgroundColor: '#1a1a1a',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadStepAreaWithPreviews: {
    // Guide no longer overlaps the dropzone, so no extra top padding needed —
    // keeps "Tap to upload" vertically centered.
    paddingTop: 0,
  },
  uploadStepAreaTitle: {
    fontSize: 18,
    fontFamily: 'Manrope-SemiBold',
    color: '#fff',
    marginTop: 0,
  },
  uploadStepAreaHint: {
    fontSize: 13,
    fontFamily: 'Manrope-Regular',
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  uploadStepCardsContainer: {
    width: 260,
    height: 380,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadStepSingleCard: {
    width: 200,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    transform: [{ rotate: '3deg' }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  uploadStepAddMoreCard: {
    position: 'absolute',
    width: 180,
    height: 250,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    borderColor: '#333',
    borderStyle: 'dashed',
    top: 10,
    left: 0,
    transform: [{ rotate: '-6deg' }],
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadStepAddMoreText: {
    color: '#555',
    fontSize: 13,
    fontFamily: 'Manrope-Medium',
    textAlign: 'center',
  },
  uploadStepStackedCards: {
    width: 260,
    height: 360,
    position: 'relative',
  },
  uploadStepBackCard: {
    position: 'absolute',
    width: 180,
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    top: 0,
    left: 0,
    transform: [{ rotate: '-8deg' }],
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  uploadStepMiddleCard: {
    position: 'absolute',
    width: 180,
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    top: 40,
    left: 40,
    transform: [{ rotate: '0deg' }],
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 7,
  },
  uploadStepAddMoreOverlay: {
    borderWidth: 1.5,
    borderColor: '#333',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadStepFrontCard: {
    position: 'absolute',
    width: 180,
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    top: 80,
    right: 0,
    transform: [{ rotate: '8deg' }],
    zIndex: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  uploadStepCardImage: {
    width: '100%',
    height: '100%',
  },
  uploadStepNumberBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  uploadStepNumberText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Manrope-Bold',
  },
  uploadStepCardDelete: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1.5,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  uploadStepThumbDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: -1,
  },
  uploadStepCardWarningBorder: {
    borderWidth: 2,
    borderColor: '#f59e0b',
  },
  uploadStepCardCriticalBorder: {
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  uploadStepValidatingBadge: {
    position: 'absolute' as const,
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  bgRemovalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },

  // Style picker — 3-column scrollable grid with checkmarks
  visualContainerPickStyles: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    height: undefined,
  },
  stylePickerWrapper: {
    flex: 1,
    position: 'relative',
  },
  stylePickerScroll: {
    flex: 1,
  },
  stylePickerContent: {
    paddingBottom: 130, // clear the absolute bottom CTA bar
  },
  stylePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: STYLE_GRID_GAP,
  },
  stylePickerItem: {
    width: STYLE_ITEM_WIDTH,
    height: STYLE_ITEM_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  stylePickerImage: {
    width: '100%',
    height: '100%',
  },
  stylePickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 45, 149, 0.15)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: YELLOW,
  },
  stylePickerCheckCircle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stylePickerSkeleton: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  stylePickerLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  stylePickerLabelText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    fontFamily: 'Manrope-Medium',
    textAlign: 'center',
  },
  stylePickerEmptyCircle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  stylePickerBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },

  // Full-screen photo viewer
  fullscreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  fullscreenClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenCloseText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Manrope-Medium',
  },
});
