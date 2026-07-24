import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export function CustomGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <BlurView
      intensity={80}
      tint="dark"
      style={styles.container}
    >
      <View style={styles.tabsContainer}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const isFocused = state.index === index;

          const onPress = () => {
            // Stronger haptic for tab changes
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          // Get the icon from the tab options
          const icon = options.tabBarIcon
            ? options.tabBarIcon({
                focused: isFocused,
                color: isFocused ? '#3b82f6' : 'rgba(255, 255, 255, 0.6)',
                size: 24,
              })
            : null;

          return (
            <TabButton
              key={route.key}
              label={typeof label === 'string' ? label : route.name}
              icon={icon}
              isActive={isFocused}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </BlurView>
  );
}

interface TabButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  label,
  icon,
  isActive,
  onPress,
  onLongPress,
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const scale = withSpring(isActive ? 1.08 : 1, {
      damping: 15,
      stiffness: 150,
    });

    const opacity = withSpring(isActive ? 1 : 0.6, {
      damping: 15,
      stiffness: 150,
    });

    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const textAnimatedStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      isActive ? 1 : 0,
      [0, 1],
      ['rgba(255, 255, 255, 0.6)', '#3b82f6']
    );

    return {
      color,
    };
  });

  return (
    <AnimatedTouchable
      accessibilityRole="button"
      accessibilityState={isActive ? { selected: true } : {}}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tab, animatedStyle]}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>{icon}</View>
      <Animated.Text
        style={[styles.label, textAnimatedStyle]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    gap: 4,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default CustomGlassTabBar;
