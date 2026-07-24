import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Animated,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Carousel from 'react-native-reanimated-carousel';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

import {
  ActiveCategory,
  fetchActiveCategories,
  fetchFeaturedRecipes,
  fetchRecipesByCategory,
  HomeRecipe,
} from '../../lib/recipes/homeQueries';
import { readHomeCache, writeHomeCache } from '../../lib/recipes/homeCache';

const ROUNDED_FONT = 'SFRounded-Medium';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 4 / 3);
const HERO_RECIPE_INTERVAL_MS = 2200;
const HERO_PHOTO_INTERVAL_MS = 1100;
const HERO_SLIDE_MS = 360;
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.42);
const CARD_IMAGE_HEIGHT = Math.round(CARD_WIDTH * 4 / 3);
const CARD_LABEL_HEIGHT = 48;
const CARD_TOTAL_HEIGHT = CARD_IMAGE_HEIGHT + CARD_LABEL_HEIGHT;
const SECTION_GAP = 28;

interface Props {
  topInset: number;       // safe-area + switcher height; used for refresh control + content padding
  bottomInset: number;
}

export default function RecipesCategoriesView({ topInset, bottomInset }: Props) {
  const [featured, setFeatured] = useState<HomeRecipe[]>([]);
  const [categories, setCategories] = useState<ActiveCategory[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, HomeRecipe[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  const lastFetchRef = useRef(0);
  const REFRESH_TTL_MS = 60_000;

  const load = useCallback(async () => {
    lastFetchRef.current = Date.now();

    const featuredP = fetchFeaturedRecipes(8).then((feat) => {
      setFeatured(feat);
      feat.slice(0, 2).forEach((r) => {
        const uri = r.featured_image_url ?? r.cover_url ?? r.example_urls[0];
        if (uri) Image.prefetch(uri);
      });
      return feat;
    });

    const cats = await fetchActiveCategories();
    setCategories(cats);

    const sectionPs = cats.map((c) =>
      fetchRecipesByCategory(c.slug, 18).then((rs) => {
        setByCategory((prev) => ({ ...prev, [c.slug]: rs }));
        return [c.slug, rs] as const;
      }),
    );

    const [feat, ...sections] = await Promise.all([featuredP, ...sectionPs]);
    const map: Record<string, HomeRecipe[]> = {};
    sections.forEach(([slug, rs]) => { map[slug] = rs; });
    writeHomeCache({ ts: Date.now(), featured: feat, categories: cats, byCategory: map });
  }, []);

  useEffect(() => {
    let cancelled = false;
    readHomeCache().then((cache) => {
      if (cancelled) return;
      if (cache) {
        setFeatured(cache.featured);
        setCategories(cache.categories);
        setByCategory(cache.byCategory);
        setIsLoading(false);
        lastFetchRef.current = cache.ts;
      }
      load().finally(() => { if (!cancelled) setIsLoading(false); });
    });
    return () => { cancelled = true; };
  }, [load]);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current > REFRESH_TTL_MS) load();
  }, [load]));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const handleOpenRecipe = (recipe: HomeRecipe) => {
    router.push(`/recipe/${recipe.id}`);
  };

  const handleViewAll = (category: ActiveCategory) => {
    router.push(`/category/${category.slug}`);
  };

  return (
    <Animated.ScrollView
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor="#fff"
          progressViewOffset={topInset}
        />
      }
    >
      {isLoading ? (
        <View style={styles.heroSkeleton}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : featured.length > 0 ? (
        <HeroCarousel items={featured} onPress={handleOpenRecipe} scrollY={scrollY} />
      ) : null}

      {categories.map((cat) => {
        const recipes = byCategory[cat.slug] ?? [];
        if (recipes.length === 0) return null;
        return (
          <Section
            key={cat.slug}
            category={cat}
            recipes={recipes}
            onPressCard={handleOpenRecipe}
            onViewAll={() => handleViewAll(cat)}
          />
        );
      })}
    </Animated.ScrollView>
  );
}

function recipePhotos(recipe: HomeRecipe | undefined): string[] {
  if (!recipe) return [];
  if (recipe.featured_image_url) return [recipe.featured_image_url];
  return recipe.example_urls.length > 0
    ? recipe.example_urls
    : recipe.cover_url ? [recipe.cover_url] : [];
}

function HeroCarousel({
  items,
  onPress,
  scrollY,
}: {
  items: HomeRecipe[];
  onPress: (r: HomeRecipe) => void;
  scrollY: Animated.Value;
}) {
  const { t } = useTranslation();
  const [recipeIdx, setRecipeIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);

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

  const currentRecipe = items[recipeIdx];
  const heroPhotos = useMemo(() => recipePhotos(currentRecipe), [currentRecipe]);

  useEffect(() => {
    if (heroPhotos.length < 2) return;
    const id = setInterval(() => {
      setPhotoIdx((i) => (i + 1) % heroPhotos.length);
    }, HERO_PHOTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [heroPhotos.length, recipeIdx]);

  if (!currentRecipe) return null;

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
          onSnapToItem={(idx) => {
            setRecipeIdx(idx);
            setPhotoIdx(0);
          }}
          renderItem={({ item, index }) => (
            <RecipeSlide
              recipe={item}
              photoIdx={index === recipeIdx ? photoIdx : 0}
              onPress={onPress}
            />
          )}
        />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {heroPhotos.length > 1 ? (
          <View style={styles.heroDots} pointerEvents="none">
            {heroPhotos.map((_, i) => (
              <View key={i} style={[styles.heroDot, i === photoIdx && styles.heroDotActive]} />
            ))}
          </View>
        ) : null}

        <View style={styles.heroBottomStack} pointerEvents="box-none">
          <ReAnimated.Text
            key={currentRecipe.id}
            entering={FadeIn.duration(360)}
            exiting={FadeOut.duration(220)}
            style={styles.heroTitle}
            numberOfLines={2}
            pointerEvents="none"
          >
            {currentRecipe.name}
          </ReAnimated.Text>

          <Pressable
            onPress={() => onPress(currentRecipe)}
            style={styles.heroTryNow}
            hitSlop={8}
          >
            <Text style={styles.heroTryNowText}>{t('recipesCategories.tryNow')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const RecipeSlide = memo(function RecipeSlide({
  recipe,
  photoIdx,
  onPress,
}: {
  recipe: HomeRecipe;
  photoIdx: number;
  onPress: (r: HomeRecipe) => void;
}) {
  const photos = useMemo(() => recipePhotos(recipe), [recipe]);
  const uri = photos[photoIdx % Math.max(photos.length, 1)] ?? recipe.cover_url ?? null;

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (success) runOnJS(onPress)(recipe);
        }),
    [onPress, recipe],
  );

  return (
    <GestureDetector gesture={tap}>
      <View style={StyleSheet.absoluteFill}>
        {uri ? (
          <Image
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
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.18)']}
          style={styles.heroBottomScrim}
          pointerEvents="none"
        />
      </View>
    </GestureDetector>
  );
});

function Section({
  category,
  recipes,
  onPressCard,
  onViewAll,
}: {
  category: ActiveCategory;
  recipes: HomeRecipe[];
  onPressCard: (r: HomeRecipe) => void;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const isBeforeAfterSection = category.slug === 'artistic_effects';
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sectionTitle}>{category.title}</Text>
          {category.subtitle ? <Text style={styles.sectionSubtitle}>{category.subtitle}</Text> : null}
        </View>
        <TouchableOpacity onPress={onViewAll} hitSlop={8} style={styles.allPill}>
          <Text style={styles.allText}>{t('recipesCategories.all')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={recipes}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.sectionList}
        ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
        ListFooterComponent={<ViewAllCard onPress={onViewAll} />}
        renderItem={({ item }) => {
          const showBA = isBeforeAfterSection && item.example_urls.length >= 2;
          return showBA
            ? <BeforeAfterCard recipe={item} onPress={() => onPressCard(item)} />
            : <RecipeCard recipe={item} onPress={() => onPressCard(item)} />;
        }}
      />
    </View>
  );
}

const BeforeAfterCard = memo(function BeforeAfterCard({ recipe, onPress }: { recipe: HomeRecipe; onPress: () => void }) {
  const beforeUri = recipe.example_urls[0];
  const afterUri = recipe.example_urls[1];

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.cubic) }),
        withDelay(350, withTiming(0, { duration: 2500, easing: Easing.inOut(Easing.cubic) })),
        withDelay(350, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [progress]);

  const afterClipStyle = useAnimatedStyle(() => ({
    width: progress.value * CARD_WIDTH,
  }));

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardImageWrap}>
        <Image
          source={{ uri: beforeUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <ReAnimated.View style={[styles.baAfterClip, afterClipStyle]} pointerEvents="none">
          <Image
            source={{ uri: afterUri }}
            style={{ width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </ReAnimated.View>
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardTitle} numberOfLines={1}>{recipe.name}</Text>
      </View>
    </Pressable>
  );
});

const RecipeCard = memo(function RecipeCard({ recipe, onPress }: { recipe: HomeRecipe; onPress: () => void }) {
  const [imgIdx, setImgIdx] = useState(0);
  const examples = recipe.example_urls;

  useEffect(() => {
    if (examples.length < 2) return;
    const id = setInterval(() => {
      setImgIdx((i) => (i + 1) % examples.length);
    }, 3000);
    return () => clearInterval(id);
  }, [examples.length]);

  const uri = examples[imgIdx] ?? recipe.cover_url;

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardImageWrap}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={300}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardTitle} numberOfLines={1}>{recipe.name}</Text>
      </View>
    </Pressable>
  );
});

function ViewAllCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={[styles.cardImageWrap, styles.viewAllImage]}>
        <ChevronRight size={28} color="#fff" />
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardTitle}>{t('recipesCategories.viewAll')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroSkeleton: {
    width: SCREEN_WIDTH,
    height: HERO_IMAGE_HEIGHT,
    backgroundColor: '#0f0f0f',
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
  heroDots: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  heroDot: {
    width: 5,
    height: 5,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  heroDotActive: {
    backgroundColor: '#fff',
    width: 14,
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
  allPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: '#1a1a1a',
  },
  allText: { color: '#fff', fontWeight: '600', fontSize: 13 },

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

  viewAllImage: {
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
  },

  baAfterClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },

  placeholder: { backgroundColor: '#0a0a0a' },
});
