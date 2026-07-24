import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const ROUNDED_FONT = 'SFRounded-Medium';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Zap, Crown } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../../contexts/AuthModalContext';

const HAS_LIQUID_GLASS = (() => {
  try { return isLiquidGlassAvailable(); } catch { return false; }
})();

interface CoinBalanceProps {
  balance: number | null | string;
  onPress?: () => void;
  iconType?: 'coins' | 'asterisk';
  isPremium?: boolean;
}

export default function CoinBalance({ balance, onPress, iconType = 'coins', isPremium = false }: CoinBalanceProps) {
  const coinRotation = useSharedValue(0);
  const { isAuthenticated } = useAuth();

  const isLoading = balance === null;

  // Animate coin rotation when loading
  useEffect(() => {
    if (isLoading) {
      // Start rotating
      coinRotation.value = withRepeat(
        withTiming(360, { duration: 1000 }),
        -1, // Infinite
        false // Don't reverse
      );
    } else {
      // Stop at current position
      coinRotation.value = withTiming(0, { duration: 200 });
    }
  }, [isLoading]);

  const coinAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${coinRotation.value}deg` }],
  }));

  const handlePress = () => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  // Token symbol is the flash/Zap everywhere for consistency (matches GenerationsChip).
  // iconType is kept for backward-compat with callers but no longer changes the glyph.

  // Show "Sign in" only for non-premium users who haven't signed in with Apple
  const isZeroBalance = balance === '' || balance === 0 || balance === '0';
  const isEmpty = isZeroBalance && !isAuthenticated && !isPremium;
  const displayText = isEmpty ? 'Sign in' : balance;

  const inner = (
    <>
      <Animated.View style={coinAnimatedStyle}>
        <Zap size={18} color="#FF2D95" strokeWidth={2.5} fill="#FF2D95" />
      </Animated.View>
      {isPremium && <Crown size={13} color="#fff" fill="#fff" />}
      {!isLoading && (
        <Text style={[styles.coinText, isEmpty && styles.signInText]}>
          {displayText}
        </Text>
      )}
    </>
  );

  if (HAS_LIQUID_GLASS) {
    const glass = (
      <GlassView isInteractive={!!onPress} glassEffectStyle="clear" style={[styles.glassPill, styles.glassPillContent]}>
        {inner}
      </GlassView>
    );
    return onPress ? (
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85}>
        {glass}
      </TouchableOpacity>
    ) : glass;
  }

  const blur = (
    <View style={styles.glassPill}>
      <BlurView intensity={60} tint="systemUltraThinMaterial" style={styles.glassPillContent}>
        {inner}
      </BlurView>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.85}>
      {blur}
    </TouchableOpacity>
  ) : blur;
}

const styles = StyleSheet.create({
  glassPill: {
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    height: 44,
  },
  glassPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    height: 44,
  },
  coinText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: ROUNDED_FONT,
  },
  signInText: {
    color: '#fff',
  },
});
