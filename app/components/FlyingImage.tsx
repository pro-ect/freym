import React, { useEffect } from 'react';
import { Image, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FlyingImageProps {
  imageUri: string;
  startX: number;
  startY: number;
  onAnimationComplete: () => void;
}

export default function FlyingImage({ imageUri, startX, startY, onAnimationComplete }: FlyingImageProps) {
  const translateX = useSharedValue(startX);
  const translateY = useSharedValue(startY);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Calculate target position (bottom right, where library tab is)
    const targetX = SCREEN_WIDTH - 80;
    const targetY = SCREEN_HEIGHT - 100;

    // Start animation sequence
    translateX.value = withTiming(targetX, {
      duration: 800,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });

    translateY.value = withTiming(targetY, {
      duration: 800,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });

    scale.value = withSequence(
      withTiming(1.1, { duration: 150 }),
      withTiming(0.3, { duration: 650 })
    );

    opacity.value = withTiming(0, {
      duration: 800,
    }, (finished) => {
      if (finished) {
        runOnJS(onAnimationComplete)();
      }
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <Image source={{ uri: imageUri }} style={styles.image} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
