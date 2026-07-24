import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

const HAS_LIQUID_GLASS = (() => {
  try { return isLiquidGlassAvailable(); } catch { return false; }
})();

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  square?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function GlassPill({ children, onPress, square = false, style }: Props) {
  const shape = square ? styles.square : styles.pill;

  const content = <View style={styles.row}>{children}</View>;

  if (HAS_LIQUID_GLASS) {
    const Wrap: any = onPress ? Pressable : View;
    return (
      <Wrap onPress={onPress} style={style}>
        <GlassView
          isInteractive={!!onPress}
          glassEffectStyle="clear"
          style={[shape, styles.body]}
        >
          {content}
        </GlassView>
      </Wrap>
    );
  }

  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={style}>
      <View style={shape}>
        <BlurView
          intensity={60}
          tint="systemUltraThinMaterial"
          style={styles.body}
        >
          {content}
        </BlurView>
      </View>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 44,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  square: {
    height: 44,
    width: 44,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  body: {
    height: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
