import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Settings as SettingsIcon, X, Copy, Check, ArrowUpRight, Wand2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchFreymFeed, type FreymFeedItem } from '../../lib/freym/feed';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { HARD_PAYWALL_PREVIEW_KEY } from '../../lib/hardPaywallFlow/config';
import ScreenWithBlurredTitle from '../components/ScreenWithBlurredTitle';
import GenerationsChip from '../components/GenerationsChip';
import GlassPill from '../components/GlassPill';
import LibrarySettingsModal from '../components/LibrarySettingsModal';
import { usePaywall } from '../../contexts/PaywallContext';
import { getScreenWidth } from '../../lib/webLayout';
import { safeAspectRatio, safeTileHeight } from '../../lib/layout/imageSizing';

const NUM_COLUMNS = 2;
const GUTTER = 6;
const H_PAD = 16;
const SCREEN_WIDTH = getScreenWidth();
// Floor so the column width is always an integer — fractional layout dimensions
// feed straight into native CALayers and any non-finite value crashes iOS.
const COLUMN_WIDTH = Math.floor(
  (SCREEN_WIDTH - H_PAD * 2 - GUTTER * (NUM_COLUMNS - 1)) / NUM_COLUMNS
);

const SKELETON_RATIOS = [1.2, 1.4, 1.0, 1.6, 1.3, 1.5, 1.1, 1.45, 1.25, 1.55, 1.15, 1.35];

export default function InspireTab() {
  const { showPaywall } = usePaywall();

  const [items, setItems] = useState<FreymFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selected, setSelected] = useState<FreymFeedItem | null>(null);
  const [copied, setCopied] = useState(false);

  // Hidden tester gesture: 7 quick taps on the title re-runs onboarding in
  // hard-paywall PREVIEW mode (HardPaywallGate reads HARD_PAYWALL_PREVIEW_KEY).
  const { showOnboarding } = useOnboarding();
  const logoTapCountRef = useRef(0);
  const lastLogoTapRef = useRef(0);
  const handleLogoTap = useCallback(() => {
    const now = Date.now();
    if (now - lastLogoTapRef.current > 1500) logoTapCountRef.current = 0;
    lastLogoTapRef.current = now;
    logoTapCountRef.current += 1;
    if (logoTapCountRef.current >= 7) {
      logoTapCountRef.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      AsyncStorage.setItem(HARD_PAYWALL_PREVIEW_KEY, 'true').catch(() => {});
      showOnboarding();
    }
  }, [showOnboarding]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => { scrollY.value = e.contentOffset.y; },
  });

  const load = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const data = await fetchFreymFeed();
      setItems(data);
    } catch (e) {
      console.warn('[Inspire] freym feed load failed:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback((item: FreymFeedItem) => {
    Haptics.selectionAsync();
    setCopied(false);
    setSelected(item);
  }, []);

  const copyPrompt = useCallback(async (item: FreymFeedItem) => {
    if (!item.prompt_text) return;
    await Clipboard.setStringAsync(item.prompt_text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
  }, []);

  const usePrompt = useCallback((item: FreymFeedItem) => {
    if (!item.prompt_text) return;
    Haptics.selectionAsync();
    setSelected(null);
    router.push({
      pathname: '/(tabs)/create',
      params: { prompt: item.prompt_text, nonce: String(Date.now()) },
    });
  }, []);

  const columns = useMemo(() => {
    const cols: FreymFeedItem[][] = Array.from({ length: NUM_COLUMNS }, () => []);
    const heights = new Array(NUM_COLUMNS).fill(0);
    for (const it of items) {
      const img = it.images[0];
      const ratio = safeAspectRatio(img?.width ?? null, img?.height ?? null);
      const h = safeTileHeight(COLUMN_WIDTH, ratio);
      let target = 0;
      for (let i = 1; i < NUM_COLUMNS; i++) if (heights[i] < heights[target]) target = i;
      cols[target].push(it);
      heights[target] += h + GUTTER;
    }
    return cols;
  }, [items]);

  const skeletonColumns = useMemo(() => {
    const cols: number[][] = Array.from({ length: NUM_COLUMNS }, () => []);
    const heights = new Array(NUM_COLUMNS).fill(0);
    for (let i = 0; i < SKELETON_RATIOS.length; i++) {
      const ratio = SKELETON_RATIOS[i];
      const h = safeTileHeight(COLUMN_WIDTH, ratio);
      let target = 0;
      for (let c = 1; c < NUM_COLUMNS; c++) if (heights[c] < heights[target]) target = c;
      cols[target].push(ratio);
      heights[target] += h + GUTTER;
    }
    return cols;
  }, []);

  const detailImage = selected?.images[0];
  const detailRatio = safeAspectRatio(detailImage?.width ?? null, detailImage?.height ?? null);

  return (
    <>
    <ScreenWithBlurredTitle
      title="freym"
      onTitlePress={handleLogoTap}
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
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => load(true)}
              tintColor="#fff"
            />
          }
        >
          <Text style={styles.lead}>Fresh prompts from creators</Text>

          {isLoading && items.length === 0 ? (
            <View style={styles.grid}>
              {skeletonColumns.map((col, colIndex) => (
                <View
                  key={`sk-col-${colIndex}`}
                  style={{
                    width: COLUMN_WIDTH,
                    marginLeft: colIndex === 0 ? 0 : GUTTER,
                  }}
                >
                  {col.map((ratio, i) => (
                    <View
                      key={`sk-${colIndex}-${i}`}
                      style={[
                        styles.skeletonTile,
                        { width: COLUMN_WIDTH, height: safeTileHeight(COLUMN_WIDTH, ratio) },
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.grid}>
              {columns.map((col, colIndex) => (
                <View
                  key={`col-${colIndex}`}
                  style={{
                    width: COLUMN_WIDTH,
                    marginLeft: colIndex === 0 ? 0 : GUTTER,
                  }}
                >
                  {col.map((it) => {
                    const img = it.images[0];
                    const ratio = safeAspectRatio(img?.width ?? null, img?.height ?? null);
                    const h = safeTileHeight(COLUMN_WIDTH, ratio);
                    return (
                      <Pressable
                        key={it.id}
                        onPress={() => openDetail(it)}
                        style={{
                          marginBottom: GUTTER,
                          borderRadius: 16,
                          overflow: 'hidden',
                          backgroundColor: '#1a1a1a',
                        }}
                      >
                        <Image
                          source={{ uri: img?.url }}
                          style={{ width: COLUMN_WIDTH, height: h }}
                          contentFit="cover"
                          transition={120}
                        />
                        {!!it.model_name && (
                          <View style={styles.modelChip}>
                            <Text style={styles.modelChipText} numberOfLines={1}>
                              {it.model_name}
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </Animated.ScrollView>
      )}
    </ScreenWithBlurredTitle>

    {/* ── Post detail: image, prompt, copy / use-prompt actions ── */}
    <Modal
      visible={!!selected}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setSelected(null)}
    >
      {selected && (
        <View style={styles.detailContainer}>
          <View style={styles.detailHeader}>
            <View style={styles.creatorRow}>
              {!!selected.creator?.profile_pic_url && (
                <Image
                  source={{ uri: selected.creator.profile_pic_url }}
                  style={styles.creatorAvatar}
                />
              )}
              <Text style={styles.creatorHandle} numberOfLines={1}>
                @{selected.creator?.handle ?? 'unknown'}
              </Text>
            </View>
            <Pressable onPress={() => setSelected(null)} hitSlop={12} style={styles.closeButton}>
              <X size={20} color="#fff" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
            <Image
              source={{ uri: detailImage?.url }}
              style={{
                width: SCREEN_WIDTH,
                height: safeTileHeight(SCREEN_WIDTH, detailRatio),
              }}
              contentFit="cover"
              transition={150}
            />

            <View style={styles.detailBody}>
              {(!!selected.model_name || (selected.style_tags?.length ?? 0) > 0) && (
                <View style={styles.tagsRow}>
                  {!!selected.model_name && (
                    <View style={[styles.tag, styles.tagModel]}>
                      <Text style={styles.tagModelText}>{selected.model_name}</Text>
                    </View>
                  )}
                  {(selected.style_tags ?? []).map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selected.prompt_text ? (
                <>
                  <View style={styles.promptBox}>
                    <Text style={styles.promptText} selectable>
                      {selected.prompt_text}
                    </Text>
                  </View>
                  <View style={styles.actionsRow}>
                    <Pressable style={styles.primaryButton} onPress={() => usePrompt(selected)}>
                      <Wand2 size={16} color="#000" />
                      <Text style={styles.primaryButtonText}>Use prompt</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => copyPrompt(selected)}>
                      {copied ? <Check size={16} color="#fff" /> : <Copy size={16} color="#fff" />}
                      <Text style={styles.secondaryButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                !!selected.caption && (
                  <Text style={styles.captionText} selectable>
                    {selected.caption}
                  </Text>
                )
              )}

              {!!selected.url && (
                <Pressable
                  style={styles.originalLink}
                  onPress={() => Linking.openURL(selected.url!)}
                >
                  <Text style={styles.originalLinkText}>View original</Text>
                  <ArrowUpRight size={14} color="rgba(255,255,255,0.6)" />
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>
      )}
    </Modal>

    <LibrarySettingsModal
      visible={showSettings}
      onClose={() => setShowSettings(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  lead: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    textAlign: 'left',
    alignSelf: 'stretch',
    width: '100%',
    paddingHorizontal: H_PAD,
    paddingTop: 20,
    paddingBottom: 28,
  },
  grid: {
    flexDirection: 'row',
    paddingHorizontal: H_PAD,
  },
  skeletonTile: {
    marginBottom: GUTTER,
    borderRadius: 16,
    backgroundColor: '#161616',
  },
  modelChip: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    maxWidth: COLUMN_WIDTH - 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modelChipText: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 10,
    letterSpacing: 0.2,
  },
  detailContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingVertical: 14,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  creatorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
  },
  creatorHandle: {
    color: '#fff',
    fontFamily: 'SFRounded-Medium',
    fontSize: 15,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBody: {
    paddingHorizontal: H_PAD,
    paddingTop: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tagText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
  },
  tagModel: {
    backgroundColor: '#fff',
  },
  tagModelText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  promptBox: {
    borderRadius: 14,
    backgroundColor: '#141414',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    padding: 14,
  },
  promptText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 21,
  },
  captionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 21,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  originalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 18,
  },
  originalLinkText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
});
