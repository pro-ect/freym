import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
  // Shift the pulse phase so adjacent skeletons don't pulse in perfect lockstep.
  // Pass small positive ms offsets (0–600) to create a soft wave across a list.
  delayMs?: number;
}

/**
 * A pulsing placeholder block. Uses opacity on a dark gray fill to keep the
 * effect cheap on the UI thread. Lives entirely in reanimated; no JS heartbeat.
 */
export default function Skeleton({ style, borderRadius = 8, delayMs = 0 }: Props) {
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    const start = () => {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.85, { duration: 850, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.45, { duration: 850, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    };
    if (delayMs > 0) {
      const t = setTimeout(start, delayMs);
      return () => clearTimeout(t);
    }
    start();
    return undefined;
  }, [delayMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { backgroundColor: '#1a1a1a', borderRadius, borderCurve: 'continuous' as const },
        animatedStyle,
        style,
      ]}
    />
  );
}
