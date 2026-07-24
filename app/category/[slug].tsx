import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ActiveCategory, fetchCategory, fetchRecipesByCategory, HomeRecipe } from '../../lib/recipes/homeQueries';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMNS = 2;
const GAP = 10;
const HORIZONTAL_PADDING = 16;
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
const CARD_IMAGE_HEIGHT = Math.round((CARD_WIDTH * 4) / 3);
const CARD_LABEL_HEIGHT = 48;

export default function CategoryPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [category, setCategory] = useState<ActiveCategory | null>(null);
  const [categoryLoaded, setCategoryLoaded] = useState(false);
  const [recipes, setRecipes] = useState<HomeRecipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    const [cat, rows] = await Promise.all([
      fetchCategory(slug),
      fetchRecipesByCategory(slug, 100),
    ]);
    setCategory(cat);
    setRecipes(rows);
    setCategoryLoaded(true);
  }, [slug]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  if (categoryLoaded && !category) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.empty}>{t('category.notFound')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ChevronLeft size={28} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{category?.title ?? ''}</Text>
          {category?.subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{category.subtitle}</Text>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : recipes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{t('category.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          contentContainerStyle={{ padding: HORIZONTAL_PADDING, paddingBottom: 48 }}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#fff" />}
          renderItem={({ item }) => <RecipeCard recipe={item} />}
        />
      )}
    </View>
  );
}

function RecipeCard({ recipe }: { recipe: HomeRecipe }) {
  const { t } = useTranslation();
  const uri = recipe.cover_url;
  return (
    <Pressable onPress={() => router.push(`/recipe/${recipe.id}`)} style={styles.card}>
      <View style={styles.cardImageWrap}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
      </View>
      <View style={styles.cardLabel}>
        <Text style={styles.cardTitle} numberOfLines={1}>{recipe.name}</Text>
        {recipe.photo_count > 0 ? (
          <Text style={styles.cardCount}>{t('category.photoCount', { n: recipe.photo_count })}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    gap: 4,
  },
  back: { padding: 8 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  headerSubtitle: { color: '#888', fontSize: 13, marginTop: 1 },
  card: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT + CARD_LABEL_HEIGHT,
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
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  cardCount: { color: '#888', fontSize: 11, marginTop: 2 },
  placeholder: { backgroundColor: '#0a0a0a' },
  empty: { color: '#666', fontSize: 14 },
});
