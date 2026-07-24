import React, { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Animated,
  Dimensions,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';

const ROUNDED_FONT = 'SFRounded-Medium';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import MaskedView from '@react-native-masked-view/masked-view';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hexagon, ChevronRight, Sparkles, MessageCircle } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import Carousel from 'react-native-reanimated-carousel';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, { FadeIn, FadeOut, runOnJS } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

const HAS_LIQUID_GLASS = (() => {
  try { return isLiquidGlassAvailable(); } catch { return false; }
})();

import { useImageModels } from '../hooks/useCloudModels';
import { fetchActiveModelCategories, ActiveModelCategory } from '../../lib/models/homeQueries';
import { CloudModel } from '../../lib/cloudModels';
import CoinBalance from '../components/CoinBalance';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import AdminModelEditModal from '../components/AdminModelEditModal';
import HomeSkeleton from '../components/HomeSkeleton';
import AgentHeroBanner from '../components/AgentHeroBanner';
import RemoteImage from '../components/RemoteImage';
import { useReplicateBalance } from '../hooks/useReplicateBalance';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useSettings } from '../../contexts/SettingsContext';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 4 / 3); // 3:4 portrait hero
const HERO_RECIPE_INTERVAL_MS = 3200;
const HERO_SLIDE_MS = 360;

// Portrait preview cards — 3:4 (taller than wide), matching the recipes strip.
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.42);
const CARD_IMAGE_HEIGHT = Math.round(CARD_WIDTH * 4 / 3);
const CARD_LABEL_HEIGHT = 48;
const CARD_TOTAL_HEIGHT = CARD_IMAGE_HEIGHT + CARD_LABEL_HEIGHT;
const SECTION_GAP = 28;

function openModel(slug: string) {
  router.push({ pathname: '/(tabs)/create', params: { model: slug } });
}

function modelHeroImage(m: CloudModel): string | null {
  return m.heroImageUrl ?? m.iconUrl ?? null;
}

export default function HomeTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const balanceInfo = useReplicateBalance();
  const { subscriptionStatus } = useSubscription();
  const { isAdmin } = useSettings();
  const { models: allModels, isLoading, refresh } = useImageModels();

  // Dev-only models (e.g. the 3x3 Crop tool) are injected by useImageModels with
  // sortOrder=-1. They're useful in Studio but shouldn't surface on Home — they
  // were briefly flashing into the "All models" fallback before real data landed.
  const models = useMemo(() => allModels.filter((m) => m.sortOrder >= 0), [allModels]);

  const [showSettings, setShowSettings] = useState(false);
  const [categories, setCategories] = useState<ActiveModelCategory[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingModel, setEditingModel] = useState<CloudModel | null>(null);

  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  const lastFetchRef = useRef(0);
  const REFRESH_TTL_MS = 60_000;

  const loadCategories = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const cats = await fetchActiveModelCategories();
      setCategories(cats);
    } catch (err) {
      // Never let a failed/aborted categories fetch wedge the skeleton — the
      // "All models" fallback covers the empty-categories case below.
      console.warn('[Home] loadCategories failed:', err);
    } finally {
      setCategoriesLoaded(true);
    }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current > REFRESH_TTL_MS) loadCategories();
  }, [loadCategories]));

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refresh(), loadCategories()]);
    setIsRefreshing(false);
  }, [refresh, loadCategories]);

  // Derive featured + per-category lists from the single cached models list.
  const featured = useMemo(() => models.filter((m) => m.isFeatured), [models]);
  const byCategory = useMemo(() => {
    const map: Record<string, CloudModel[]> = {};
    for (const cat of categories) {
      map[cat.slug] = models
        .filter((m) => m.categorySlugs.includes(cat.slug))
        .slice()
        .sort((a, b) => {
          // Pinned first, then most-recently-updated.
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          const at = new Date(a.updatedAt).getTime();
          const bt = new Date(b.updatedAt).getTime();
          return bt - at;
        });
    }
    return map;
  }, [models, categories]);

  // Fallback "All models" section so the screen is never empty before backfill.
  const hasAnySections = categories.some((c) => (byCategory[c.slug]?.length ?? 0) > 0);
  const showAllModelsFallback = !hasAnySections && models.length > 0;

  // Prefetch first hero image to avoid first-frame flash.
  useEffect(() => {
    const first = featured[0];
    if (!first) return;
    const uri = modelHeroImage(first);
    if (uri) Image.prefetch(uri);
  }, [featured]);

  const headerHeight = insets.top + 8 + 50 + 12;

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
            progressViewOffset={headerHeight}
          />
        }
      >
        {/* Show skeleton until BOTH the models and the categories have arrived.
            Without the categories gate, the brief window after models load but
            before categories load would flash the "All models" fallback. */}
        {(isLoading && models.length === 0) || !categoriesLoaded ? (
          <HomeSkeleton />
        ) : (
          <>
            <AgentHeroBanner onPress={() => router.push('/agent' as any)} />

            {featured.length > 0 ? (
              <HeroCarousel items={featured} onPress={openModel} scrollY={scrollY} />
            ) : null}

            {categories.map((cat) => {
              const items = byCategory[cat.slug] ?? [];
              if (items.length === 0) return null;
              return (
                <ModelSection
                  key={cat.slug}
                  title={cat.title}
                  subtitle={cat.subtitle}
                  models={items}
                  onPressCard={openModel}
                  onLongPressCard={isAdmin ? setEditingModel : undefined}
                />
              );
            })}

            {showAllModelsFallback ? (
              <ModelSection
                title={t('home.allModels')}
                subtitle={t('home.allModelsSubtitle')}
                models={models}
                onPressCard={openModel}
                onLongPressCard={isAdmin ? setEditingModel : undefined}
              />
            ) : null}
          </>
        )}

        {!isLoading && models.length === 0 ? (
          <View style={styles.empty}>
            <Sparkles size={32} color="#555" />
            <Text style={styles.emptyTitle}>{t('home.noModelsYet')}</Text>
            <Text style={styles.emptySubtitle}>{t('home.noModelsSubtitle')}</Text>
          </View>
        ) : null}
      </Animated.ScrollView>

      <View pointerEvents="box-none" style={[styles.headerOverlay, { height: headerHeight }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
              locations={[0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            tint="systemChromeMaterialDark"
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Image
            source={require('../../assets/aya-photo-logo.png')}
            style={styles.headerLogoImg}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
          <View style={styles.headerRight}>
            <GlassChatButton onPress={() => router.push('/agent' as any)} />
            <CoinBalance
              balance={balanceInfo.isLoading ? null : balanceInfo.displayText}
              onPress={() => setShowSettings(true)}
              iconType="asterisk"
              isPremium={subscriptionStatus.isSubscribed}
            />
            <GlassCogButton onPress={() => setShowSettings(true)} />
          </View>
        </View>
      </View>

      <LibrarySettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

      <AdminModelEditModal
        visible={editingModel !== null}
        model={editingModel}
        categories={categories}
        onClose={() => setEditingModel(null)}
        onSaved={async () => {
          await refresh();
          await loadCategories();
        }}
      />
    </View>
  );
}

function GlassChatButton({ onPress }: { onPress: () => void }) {
  if (HAS_LIQUID_GLASS) {
    return (
      <GlassView isInteractive glassEffectStyle="clear" style={styles.cogGlass}>
        <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.cogTouchable} activeOpacity={0.85}>
          <MessageCircle size={22} color="#fff" strokeWidth={1.5} />
        </TouchableOpacity>
      </GlassView>
    );
  }
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.cogGlass} activeOpacity={0.85}>
      <MessageCircle size={22} color="#fff" strokeWidth={1.5} />
    </TouchableOpacity>
  );
}

function GlassCogButton({ onPress }: { onPress: () => void }) {
  if (HAS_LIQUID_GLASS) {
    return (
      <GlassView isInteractive glassEffectStyle="clear" style={styles.cogGlass}>
        <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.cogTouchable} activeOpacity={0.85}>
          <Hexagon size={22} color="#fff" strokeWidth={1.5} />
        </TouchableOpacity>
      </GlassView>
    );
  }
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.cogGlass} activeOpacity={0.85}>
      <Hexagon size={22} color="#fff" strokeWidth={1.5} />
    </TouchableOpacity>
  );
}

function HeroCarousel({
  items,
  onPress,
  scrollY,
}: {
  items: CloudModel[];
  onPress: (slug: string) => void;
  scrollY: Animated.Value;
}) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);

  const stretchTranslateY = scrollY.interpolate({
    inputRange: [-HERO_IMAGE_HEIGHT, 0, 1],
    outputRange: [-HERO_IMAGE_HEIGHT, 0, 0],
    extrapolateLeft: 'extend',
    extrapolateRight: 'clamp',
  });
  const stretchScale = scrollY.interpolate({
    inputRange: [-HERO_IMAGE_HEIGHT, 0, 1],
    outputRange: [2, 1, 1],
    extrapolateLeft: 'extend',
    extrapolateRight: 'clamp',
  });

  const current = items[idx];

  return (
    <View style={styles.heroContainer}>
      <Animated.View
        style={[
          styles.heroImageWrap,
          {
            transformOrigin: 'top',
            transform: [{ translateY: stretchTranslateY }, { scale: stretchScale }],
          },
        ]}
      >
        <Carousel
          width={SCREEN_WIDTH}
          height={HERO_IMAGE_HEIGHT}
          data={items}
          loop
          autoPlay={items.length > 1}
          autoPlayInterval={HERO_RECIPE_INTERVAL_MS}
          scrollAnimationDuration={HERO_SLIDE_MS}
          onConfigurePanGesture={(pan) => {
            pan.activeOffsetX([-12, 12]);
            pan.failOffsetY([-8, 8]);
          }}
          onSnapToItem={(i) => setIdx(i)}
          renderItem={({ item }) => <HeroSlide model={item} onPress={onPress} />}
        />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {current ? (
          <View style={styles.heroBottomStack} pointerEvents="box-none">
            <ReAnimated.Text
              key={`name-${current.id}`}
              entering={FadeIn.duration(360)}
              exiting={FadeOut.duration(220)}
              style={styles.heroTitle}
              numberOfLines={2}
              pointerEvents="none"
            >
              {current.name}
            </ReAnimated.Text>

            <Pressable
              onPress={() => onPress(current.slug)}
              style={styles.heroTryNow}
              hitSlop={8}
            >
              <Text style={styles.heroTryNowText}>{t('home.tryNow')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const HeroSlide = memo(function HeroSlide({
  model,
  onPress,
}: {
  model: CloudModel;
  onPress: (slug: string) => void;
}) {
  const uri = modelHeroImage(model);

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (success) runOnJS(onPress)(model.slug);
        }),
    [onPress, model.slug],
  );

  return (
    <GestureDetector gesture={tap}>
      <View style={StyleSheet.absoluteFill}>
        {uri ? (
          <RemoteImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={HERO_SLIDE_MS}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          locations={[0.45, 1]}
          style={styles.heroBottomScrim}
          pointerEvents="none"
        />
      </View>
    </GestureDetector>
  );
});

function ModelSection({
  title,
  subtitle,
  models,
  onPressCard,
  onLongPressCard,
}: {
  title: string;
  subtitle: string | null;
  models: CloudModel[];
  onPressCard: (slug: string) => void;
  onLongPressCard?: (model: CloudModel) => void;
}) {
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      <FlatList
        data={models}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.sectionList}
        ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
        renderItem={({ item }) => (
          <ModelCard
            model={item}
            onPress={() => onPressCard(item.slug)}
            onLongPress={onLongPressCard ? () => onLongPressCard(item) : undefined}
          />
        )}
      />
    </View>
  );
}

const ModelCard = memo(function ModelCard({
  model,
  onPress,
  onLongPress,
}: {
  model: CloudModel;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const uri = modelHeroImage(model);

  const handleLongPress = onLongPress
    ? () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress();
      }
    : undefined;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      style={styles.card}
    >
      <View style={styles.cardImageWrap}>
        {uri ? (
          <RemoteImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        {model.costCoins === 0 ? (
          <View style={styles.cardFreeBadge}>
            <Text style={styles.cardFreeBadgeText}>{t('home.freeBadge')}</Text>
          </View>
        ) : model.isNew ? (
          <View style={styles.cardNewBadge}>
            <Text style={styles.cardNewBadgeText}>{t('home.newBadge')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardTitle} numberOfLines={1}>{model.name}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLogoImg: {
    width: 109,
    height: 50,
    marginLeft: 8,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cogGlass: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cogTouchable: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroContainer: { width: SCREEN_WIDTH },
  heroImageWrap: {
    width: SCREEN_WIDTH,
    height: HERO_IMAGE_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  heroBottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  heroBottomStack: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 26,
    alignItems: 'center',
  },
  heroTitle: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 36,
    fontWeight: '500',
    textAlign: 'center',
  },
  heroTryNow: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  heroTryNowText: { color: '#000', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '500' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 28, fontWeight: '500' },
  sectionSubtitle: { color: '#888', fontSize: 14, marginTop: 3 },

  sectionList: { paddingHorizontal: 16 },

  card: {
    width: CARD_WIDTH,
    height: CARD_TOTAL_HEIGHT,
  },
  cardImageWrap: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  cardLabel: { height: CARD_LABEL_HEIGHT, paddingTop: 8, paddingHorizontal: 2 },
  cardTitle: { color: '#fff', fontFamily: ROUNDED_FONT, fontSize: 17, fontWeight: '500' },
  cardNewBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  cardNewBadgeText: {
    color: '#000',
    fontFamily: ROUNDED_FONT,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  cardFreeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#4ADE80',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  cardFreeBadgeText: {
    color: '#000',
    fontFamily: ROUNDED_FONT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  placeholder: { backgroundColor: '#0a0a0a' },

  empty: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyTitle: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 18,
    fontWeight: '500',
    marginTop: 8,
  },
  emptySubtitle: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
