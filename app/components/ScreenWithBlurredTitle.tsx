import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ROUNDED_FONT = 'SFRounded-Medium';

type Props = {
  title: string;
  /** When set, a logo image is shown in place of the text title (e.g. the Aya wordmark). */
  titleImage?: ImageSourcePropType;
  /** Optional tap handler on the title/logo (e.g. hidden 7-tap tester gestures). */
  onTitlePress?: () => void;
  rightControls?: ReactNode;
  children: (headerHeight: number) => ReactNode;
};

export default function ScreenWithBlurredTitle({ title, titleImage, onTitlePress, rightControls, children }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 8 + 44 + 12;

  return (
    <View style={styles.container}>
      {children(headerHeight)}

      <View pointerEvents="box-none" style={[styles.headerOverlay, { height: headerHeight }]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
              locations={[0.55, 1]}
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

        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <Pressable onPress={onTitlePress} disabled={!onTitlePress} hitSlop={8}>
              {titleImage ? (
                <Image source={titleImage} style={styles.headerLogo} contentFit="contain" cachePolicy="memory-disk" />
              ) : (
                <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              )}
            </Pressable>
          </View>
          {rightControls ? <View style={styles.headerRight}>{rightControls}</View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLeft: { flex: 1, marginRight: 12 },
  headerTitle: {
    color: '#fff',
    fontFamily: ROUNDED_FONT,
    fontSize: 24,
    fontWeight: '400',
  },
  headerLogo: {
    width: 87,
    height: 40, // 1189x548 source -> ~2.18 ratio, matches the old home-tab logo
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
