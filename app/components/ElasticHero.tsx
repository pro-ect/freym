import React from 'react';
import { StyleSheet, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  interpolate,
  type SharedValue,
  Extrapolation,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

type Props = {
  source: ImageSourcePropType;
  scrollY: SharedValue<number>;
  size: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Hero image that elastically scales on pull-down (negative scroll offset).
 * Pulls beyond the top → scale up to 1.6× over a 200pt drag.
 */
export default function ElasticHero({ source, scrollY, size, style }: Props) {
  const animStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollY.value, [-200, 0], [1.6, 1], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [-200, 0], [40, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY }, { scale }] };
  });

  return (
    <Animated.View style={[{ width: size, height: size, alignSelf: 'center' }, animStyle, style]}>
      <AnimatedImage
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
      />
    </Animated.View>
  );
}
