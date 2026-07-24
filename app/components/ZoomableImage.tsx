import React from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

interface ZoomableImageProps {
  uri: string;
  onPressIn?: () => void;
  onPressOut?: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ZoomableImage({ uri, onPressIn, onPressOut }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = savedScale.value * event.scale;
    })
    .onEnd(() => {
      // Limit zoom between 1x and 5x
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else if (scale.value > 5) {
        scale.value = withSpring(5);
        savedScale.value = 5;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value > 1) {
        // Calculate max translation to keep image within bounds
        const maxTranslateX = ((SCREEN_WIDTH * scale.value) - SCREEN_WIDTH) / 2;
        const maxTranslateY = ((SCREEN_HEIGHT * scale.value) - SCREEN_HEIGHT) / 2;

        const newTranslateX = savedTranslateX.value + event.translationX;
        const newTranslateY = savedTranslateY.value + event.translationY;

        // Constrain translation within bounds
        translateX.value = Math.max(
          -maxTranslateX,
          Math.min(maxTranslateX, newTranslateX)
        );
        translateY.value = Math.max(
          -maxTranslateY,
          Math.min(maxTranslateY, newTranslateY)
        );
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        // Reset zoom
        savedScale.value = 1;
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Zoom to 2.5x
        savedScale.value = 2.5;
        scale.value = withSpring(2.5);
      }
    });

  // Manual tap gesture for press/release to show old image
  const manualTapGesture = Gesture.Manual()
    .onTouchesDown(() => {
      console.log('🔵 ZoomableImage: Touch DOWN detected');
      if (onPressIn) {
        console.log('🔵 ZoomableImage: Calling onPressIn callback');
        runOnJS(onPressIn)();
      } else {
        console.log('⚠️ ZoomableImage: No onPressIn callback provided');
      }
    })
    .onTouchesUp(() => {
      console.log('🔴 ZoomableImage: Touch UP detected');
      if (onPressOut) {
        console.log('🔴 ZoomableImage: Calling onPressOut callback');
        runOnJS(onPressOut)();
      } else {
        console.log('⚠️ ZoomableImage: No onPressOut callback provided');
      }
    })
    .onTouchesCancelled(() => {
      console.log('🟡 ZoomableImage: Touch CANCELLED');
      if (onPressOut) {
        runOnJS(onPressOut)();
      }
    });

  const composedGesture = Gesture.Simultaneous(
    manualTapGesture,
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={styles.container}>
        <Animated.Image
          source={{ uri }}
          style={[styles.image, animatedStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
});
