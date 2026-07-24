import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';

export interface GlassTabBarTab {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

export interface GlassTabBarProps {
  tabs: GlassTabBarTab[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
  isDark?: boolean;
  blurIntensity?: number;
  backgroundColor?: string;
  activeColor?: string;
  inactiveColor?: string;
  containerStyle?: ViewStyle;
  tabStyle?: ViewStyle;
  labelStyle?: TextStyle;
  showLabels?: boolean;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const GlassTabBar: React.FC<GlassTabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  isDark = false,
  blurIntensity = 80,
  backgroundColor = 'rgba(255, 255, 255, 0.1)',
  activeColor = '#007AFF',
  inactiveColor = 'rgba(128, 128, 128, 0.8)',
  containerStyle,
  tabStyle,
  labelStyle,
  showLabels = true,
}) => {
  return (
    <BlurView
      intensity={blurIntensity}
      tint={isDark ? 'dark' : 'light'}
      style={[styles.container, { backgroundColor }, containerStyle]}
    >
      <View style={styles.tabsContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          return (
            <TabButton
              key={tab.key}
              tab={tab}
              isActive={isActive}
              onPress={() => onTabChange(tab.key)}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
              tabStyle={tabStyle}
              labelStyle={labelStyle}
              showLabel={showLabels}
            />
          );
        })}
      </View>
    </BlurView>
  );
};

interface TabButtonProps {
  tab: GlassTabBarTab;
  isActive: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  tabStyle?: ViewStyle;
  labelStyle?: TextStyle;
  showLabel: boolean;
}

const TabButton: React.FC<TabButtonProps> = ({
  tab,
  isActive,
  onPress,
  activeColor,
  inactiveColor,
  tabStyle,
  labelStyle,
  showLabel,
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const scale = withSpring(isActive ? 1.05 : 1, {
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
      [inactiveColor, activeColor]
    );

    return {
      color,
    };
  });

  return (
    <AnimatedTouchable
      onPress={onPress}
      style={[styles.tab, animatedStyle, tabStyle]}
      activeOpacity={0.7}
    >
      {tab.icon && <View style={styles.iconContainer}>{tab.icon}</View>}
      {showLabel && (
        <Animated.Text
          style={[styles.label, textAnimatedStyle, labelStyle]}
          numberOfLines={1}
        >
          {tab.label}
        </Animated.Text>
      )}
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  tabsContainer: {
    flexDirection: 'row',
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default GlassTabBar;
