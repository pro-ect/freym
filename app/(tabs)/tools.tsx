/**
 * Tools tab
 *
 * Lists public recipes tagged with `category = 'tools'` — utility recipes such
 * as upscalers, background removers, flash/relight effects. Tap a card to open
 * the recipe at `/recipe/[id]` (same target as MyRecipesModal).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Wrench, Settings as SettingsIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import ScreenWithBlurredTitle from '../components/ScreenWithBlurredTitle';
import GenerationsChip from '../components/GenerationsChip';
import GlassPill from '../components/GlassPill';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import {
  browsePublicRecipes,
  type PublicRecipe,
} from '../../lib/recipes/supabaseRecipes';
import { useAuth } from '../../contexts/AuthModalContext';
import { useBalance } from '../../contexts/BalanceContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { getScreenWidth } from '../../lib/webLayout';
import { safeAspectRatio } from '../../lib/layout/imageSizing';

const SCREEN_WIDTH = getScreenWidth();
// Each recipe shows its own before + after photos as two overlapping, tilted
// cards: the before sits behind-left, the after overlaps it on the right and is
// nudged down a touch (the same staggered/overlap look as before).
const PHOTO_W = Math.round(SCREEN_WIDTH * 0.5);
const PAIR_OVERLAP = Math.round(SCREEN_WIDTH * 0.12); // after overlaps before
const PAIR_STAGGER = 26; // after nudged down
const SINGLE_W = Math.round(SCREEN_WIDTH * 0.62); // recipes with only one photo

// Photos are tilted by a small alternating angle so the feed feels playful.
// Deterministic by list index so it's stable across renders.
const TILT_ANGLES = [-3, 2, -2.5, 3, -2, 2.5];

/** Photos used to render a recipe card: prefer the multi-result array. */
function getRecipePhotos(item: PublicRecipe): string[] {
  if (item.example_result_urls && item.example_result_urls.length > 0) {
    return item.example_result_urls;
  }
  const single = item.featured_image_url || item.example_result_url;
  return single ? [single] : [];
}

/**
 * One recipe = its before + after example photos shown as two overlapping,
 * tilted cards (before behind-left, after overlapping on the right). Static —
 * no sweep animation here; the recipe page keeps the animated slider. Title
 * sits upright below. Photo height tracks the before image's aspect ratio.
 */
function EffectCard({
  item,
  index,
  onPress,
}: {
  item: PublicRecipe;
  index: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const photos = getRecipePhotos(item);
  const [aspect, setAspect] = useState(1.25); // height / width
  const beforeTilt = `${TILT_ANGLES[(index * 2) % TILT_ANGLES.length]}deg`;
  const afterTilt = `${TILT_ANGLES[(index * 2 + 1) % TILT_ANGLES.length]}deg`;

  const title = item.recipe_data?.name || t('toolsTab.untitledTool');

  let media: React.ReactNode;
  if (photos.length === 0) {
    media = (
      <View
        style={[
          styles.photoBox,
          styles.placeholder,
          { width: SINGLE_W, height: SINGLE_W, transform: [{ rotate: beforeTilt }] },
        ]}
      >
        <Wrench size={28} color="#444" strokeWidth={1.5} />
      </View>
    );
  } else if (photos.length === 1) {
    const h = Math.round(SINGLE_W * aspect);
    media = (
      <View style={[styles.photoBox, { width: SINGLE_W, height: h, transform: [{ rotate: beforeTilt }] }]}>
        <Image
          source={{ uri: photos[0] }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
          onLoad={(e) => {
            const s = e?.source;
            if (s?.width && s?.height) setAspect(safeAspectRatio(s.width, s.height, 1.25));
          }}
        />
      </View>
    );
  } else {
    const h = Math.round(PHOTO_W * aspect);
    // The "after" photo is shown 10% larger than the "before".
    const afterW = Math.round(PHOTO_W * 1.1);
    const afterH = Math.round(h * 1.1);
    media = (
      <View style={[styles.pairWrap, { height: Math.max(h + PAIR_STAGGER, afterH + 14) }]}>
        {/* Before — behind, on the left, nudged down + slightly faded.
            DB stores the result/after first (so Aya shows the result as its one
            photo); photos[1] is the before. */}
        <View style={[styles.photoBox, { width: PHOTO_W, height: h, marginTop: PAIR_STAGGER, opacity: 0.9, transform: [{ rotate: beforeTilt }] }]}>
          <Image
            source={{ uri: photos[1] }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            onLoad={(e) => {
              const s = e?.source;
              if (s?.width && s?.height) setAspect(safeAspectRatio(s.width, s.height, 1.25));
            }}
          />
          <View style={[styles.tag, styles.tagLeft]}>
            <Text style={styles.tagText}>{t('toolsTab.before')}</Text>
          </View>
        </View>

        {/* After — overlapping the before, sitting a little higher, on top */}
        <View
          style={[
            styles.photoBox,
            styles.afterBox,
            { width: afterW, height: afterH, marginLeft: -PAIR_OVERLAP, marginTop: 14, transform: [{ rotate: afterTilt }] },
          ]}
        >
          <Image
            source={{ uri: photos[0] }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
          <View style={[styles.tag, styles.tagRight]}>
            <Text style={styles.tagText}>{t('toolsTab.after')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.cardRow}>
      <Pressable onPress={onPress} style={styles.cardPressable}>
        {media}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
      </Pressable>
    </View>
  );
}

export default function ToolsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { requireSession } = useAuth();
  const { balanceInfo } = useBalance();
  const { showPaywall } = usePaywall();
  const [recipes, setRecipes] = useState<PublicRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const fetchTools = useCallback(async () => {
    const rows = await browsePublicRecipes({
      categoryTag: 'tools',
      sortBy: 'pinned',
      limit: 50,
    });
    setRecipes(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await browsePublicRecipes({
          categoryTag: 'tools',
          sortBy: 'pinned',
          limit: 50,
        });
        if (!cancelled) setRecipes(rows);
      } catch (e) {
        console.error('[Tools] initial fetch failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchTools();
    } catch (e) {
      console.error('[Tools] refresh failed', e);
    } finally {
      setRefreshing(false);
    }
  }, [fetchTools]);

  const handleOpenRecipe = useCallback((recipe: PublicRecipe) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    requireSession();
    if (!balanceInfo.hasFalKey && !balanceInfo.hasReplicateKey && balanceInfo.rawValue <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showPaywall('insufficient_coins');
      return;
    }
    router.push(`/recipe/${recipe.id}`);
  }, [requireSession, balanceInfo, showPaywall]);

  const renderCard = useCallback(
    ({ item, index }: { item: PublicRecipe; index: number }) => (
      <EffectCard
        key={item.id}
        item={item}
        index={index}
        onPress={() => handleOpenRecipe(item)}
      />
    ),
    [handleOpenRecipe]
  );

  return (
    <>
    <ScreenWithBlurredTitle
      title={t('toolsTab.effects')}
      rightControls={
        <>
          <GenerationsChip onPress={() => showPaywall('chip_tap')} />
          <GlassPill square onPress={() => setShowSettings(true)}>
            <SettingsIcon size={18} color="#fff" />
          </GlassPill>
        </>
      }
    >
      {(headerHeight) => (
        <View style={styles.container}>
          {loading ? (
            <View style={[styles.centered, { paddingTop: headerHeight }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="#fff"
                />
              }
              contentContainerStyle={{
                paddingTop: headerHeight + 8,
                paddingBottom: insets.bottom + 32,
              }}
            >
              {recipes.length === 0 ? (
                <View style={[styles.empty, { paddingTop: headerHeight + 80 }]}>
                  <Wrench size={48} color="#444" strokeWidth={1.5} />
                  <Text style={styles.emptyTitle}>{t('toolsTab.noEffectsYet')}</Text>
                  <Text style={styles.emptyBody}>
                    {t('toolsTab.emptyBody')}
                  </Text>
                </View>
              ) : (
                <View>
                  {recipes.map((item, index) => renderCard({ item, index }))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </ScreenWithBlurredTitle>
    <LibrarySettingsModal
      visible={showSettings}
      onClose={() => setShowSettings(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRow: {
    alignItems: 'center',
    marginBottom: 56,
  },
  cardPressable: {
    alignItems: 'center',
  },
  // Before + after photos overlapping in one row, centered.
  pairWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  photoBox: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#222',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  afterBox: {
    zIndex: 2,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  tag: {
    position: 'absolute',
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tagLeft: {
    left: 8,
  },
  tagRight: {
    right: 8,
  },
  tagText: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 27,
    lineHeight: 33,
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyBody: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
