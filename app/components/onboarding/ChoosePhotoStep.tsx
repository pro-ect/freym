import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Link2, Check, X } from 'lucide-react-native';
import { fetchInspireFeed, type InspireFeedItem } from '../../../lib/inspire/feed';
import { resolvePinterestImage } from '../../../lib/inspire/pinterestResolver';
import { getScreenWidth } from '../../../lib/webLayout';
import { safeAspectRatio, safeTileHeight } from '../../../lib/layout/imageSizing';

/**
 * Hard-paywall onboarding, step 1: pick the photo to recreate as yourself.
 * Primary path is the Inspire feed grid (pinned photos sort first, so the
 * best onboarding references are curated by pinning — no code changes).
 * Escape hatch above the grid: paste a Pinterest (or any image) link. The
 * camera-roll option was removed — users mistook "your photo" for their selfie.
 */

export type ChosenReferencePhoto = {
  /** Local file URI or public https URL, ready for the generation hook. */
  uri: string;
  source: 'feed' | 'link' | 'upload';
};

const NUM_COLUMNS = 2;
const GUTTER = 6;
const H_PAD = 20;
const SCREEN_WIDTH = getScreenWidth();
const COLUMN_WIDTH = Math.floor(
  (SCREEN_WIDTH - H_PAD * 2 - GUTTER * (NUM_COLUMNS - 1)) / NUM_COLUMNS
);

const SKELETON_RATIOS = [1.2, 1.4, 1.0, 1.6, 1.3, 1.5];

interface ChoosePhotoStepProps {
  topInset: number;
  bottomInset: number;
  selected: ChosenReferencePhoto | null;
  onSelect: (photo: ChosenReferencePhoto | null) => void;
}

export default function ChoosePhotoStep({
  topInset,
  bottomInset,
  selected,
  onSelect,
}: ChoosePhotoStepProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<InspireFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkResolving, setLinkResolving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const feed = await fetchInspireFeed(40);
        if (!cancelled) setItems(feed);
      } catch (err) {
        console.warn('[ChoosePhoto] feed fetch failed:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = useMemo(() => {
    const cols: InspireFeedItem[][] = Array.from({ length: NUM_COLUMNS }, () => []);
    const heights = new Array(NUM_COLUMNS).fill(0);
    for (const it of items) {
      const ratio = safeAspectRatio(it.width, it.height);
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
    for (const ratio of SKELETON_RATIOS) {
      const h = safeTileHeight(COLUMN_WIDTH, ratio);
      let target = 0;
      for (let c = 1; c < NUM_COLUMNS; c++) if (heights[c] < heights[target]) target = c;
      cols[target].push(ratio);
      heights[target] += h + GUTTER;
    }
    return cols;
  }, []);

  const handleFeedTap = useCallback(
    (item: InspireFeedItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (selected?.uri === item.image_url) {
        onSelect(null);
      } else {
        onSelect({ uri: item.image_url, source: 'feed' });
      }
    },
    [selected, onSelect],
  );

  const handleResolveLink = useCallback(async () => {
    if (!linkText.trim() || linkResolving) return;
    setLinkResolving(true);
    setLinkError(null);
    try {
      const localUri = await resolvePinterestImage(linkText);
      onSelect({ uri: localUri, source: 'link' });
      setShowLinkInput(false);
      setLinkText('');
    } catch (err: any) {
      setLinkError(err?.message || t('onboarding.hpf.linkError'));
    } finally {
      setLinkResolving(false);
    }
  }, [linkText, linkResolving, onSelect, t]);

  const selectedIsCustom = selected && selected.source !== 'feed';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 56,
          paddingBottom: bottomInset + 140,
          paddingHorizontal: H_PAD,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{t('onboarding.hpf.choosePhoto.title')}</Text>
        <Text style={styles.subtitle}>{t('onboarding.hpf.choosePhoto.subtitle')}</Text>

        {/* Escape hatch: paste a Pinterest (or any image) link. Camera-roll
            upload was removed — users read "your photo" as their selfie, so
            the reference is limited to the curated feed + a pasted link. */}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionCard, showLinkInput && styles.actionCardActive]}
            onPress={() => {
              setShowLinkInput((v) => !v);
              setLinkError(null);
            }}
          >
            <Link2 size={18} color="#fff" />
            <Text style={styles.actionText}>{t('onboarding.hpf.pasteLink')}</Text>
          </Pressable>
        </View>

        {showLinkInput && (
          <View style={styles.linkInputWrap}>
            <TextInput
              style={styles.linkInput}
              placeholder={t('onboarding.hpf.linkPlaceholder')}
              placeholderTextColor="#666"
              value={linkText}
              onChangeText={setLinkText}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleResolveLink}
              editable={!linkResolving}
            />
            <Pressable
              style={styles.linkGoButton}
              onPress={handleResolveLink}
              disabled={linkResolving}
            >
              {linkResolving ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.linkGoText}>{t('onboarding.hpf.linkGo')}</Text>
              )}
            </Pressable>
          </View>
        )}
        {!!linkError && <Text style={styles.linkError}>{linkError}</Text>}

        {/* Custom selection preview (link or upload) */}
        {selectedIsCustom && (
          <View style={styles.customPreviewWrap}>
            <Image
              source={{ uri: selected!.uri }}
              style={styles.customPreview}
              contentFit="cover"
              transition={120}
            />
            <View style={styles.selectedBadge}>
              <Check size={14} color="#000" strokeWidth={3} />
            </View>
            <Pressable style={styles.customRemove} onPress={() => onSelect(null)} hitSlop={10}>
              <X size={14} color="#fff" strokeWidth={2.5} />
            </Pressable>
          </View>
        )}

        {/* Inspire feed grid */}
        <View style={styles.grid}>
          {(isLoading && items.length === 0 ? skeletonColumns : columns).map(
            (col: any[], colIndex: number) => (
              <View
                key={`col-${colIndex}`}
                style={{ width: COLUMN_WIDTH, marginLeft: colIndex === 0 ? 0 : GUTTER }}
              >
                {isLoading && items.length === 0
                  ? (col as number[]).map((ratio, i) => (
                      <View
                        key={`sk-${colIndex}-${i}`}
                        style={[
                          styles.skeletonTile,
                          { width: COLUMN_WIDTH, height: safeTileHeight(COLUMN_WIDTH, ratio) },
                        ]}
                      />
                    ))
                  : (col as InspireFeedItem[]).map((it) => {
                      const ratio = safeAspectRatio(it.width, it.height);
                      const h = safeTileHeight(COLUMN_WIDTH, ratio);
                      const isSelected = selected?.uri === it.image_url;
                      return (
                        <Pressable
                          key={it.id}
                          onPress={() => handleFeedTap(it)}
                          style={[styles.tile, isSelected && styles.tileSelected]}
                        >
                          <Image
                            source={{ uri: it.thumbnail_url ?? it.image_url }}
                            style={{ width: COLUMN_WIDTH - (isSelected ? 6 : 0), height: h - (isSelected ? 6 : 0), borderRadius: 13 }}
                            contentFit="cover"
                            transition={120}
                          />
                          {isSelected && (
                            <View style={styles.selectedBadge}>
                              <Check size={14} color="#000" strokeWidth={3} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
              </View>
            ),
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    fontSize: 32,
    fontFamily: 'SFRounded-Medium',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'SFRounded-Regular',
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  actionCardActive: {
    borderColor: '#fff',
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SFRounded-Medium',
  },
  linkInputWrap: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  linkInput: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    color: '#fff',
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: 'SFRounded-Regular',
  },
  linkGoButton: {
    height: 48,
    minWidth: 64,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  linkGoText: {
    color: '#000',
    fontSize: 14,
    fontFamily: 'SFRounded-Medium',
  },
  linkError: {
    color: '#ff6b6b',
    fontSize: 13,
    fontFamily: 'SFRounded-Regular',
    marginBottom: 12,
    textAlign: 'center',
  },
  customPreviewWrap: {
    alignSelf: 'center',
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  customPreview: {
    width: 160,
    height: 213,
  },
  customRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tile: {
    marginBottom: GUTTER,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {
    borderWidth: 3,
    borderColor: '#fff',
  },
  selectedBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonTile: {
    marginBottom: GUTTER,
    borderRadius: 16,
    backgroundColor: '#161616',
  },
});
