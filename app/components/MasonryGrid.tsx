import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MasonryGridProps<T> {
  data: T[];
  renderItem: (
    item: T,
    dimensions?: { width: number; height: number },
    updateDimensions?: (id: string, width: number, height: number) => void
  ) => React.ReactNode;
  keyExtractor: (item: T) => string;
  numColumns?: 2 | 3;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  emptyComponent?: React.ReactNode;
  contentContainerStyle?: any;
  onEndReached?: () => void;
  onEndReachedThreshold?: number; // Distance from bottom to trigger (default: 0.5 = 50% from bottom)
  ListFooterComponent?: React.ReactNode;
}

// Hook to manage image dimensions
function useImageDimensions() {
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>({});

  const updateDimensions = useCallback((id: string, width: number, height: number) => {
    setDimensions(prev => {
      // Only update if we don't already have dimensions for this item
      if (prev[id]) return prev;
      return { ...prev, [id]: { width, height } };
    });
  }, []);

  const getDimensions = useCallback((id: string) => dimensions[id], [dimensions]);

  return { getDimensions, updateDimensions };
}

export default function MasonryGrid<T>({
  data,
  renderItem,
  keyExtractor,
  numColumns = 2,
  onRefresh,
  isRefreshing = false,
  emptyComponent,
  contentContainerStyle,
  onEndReached,
  onEndReachedThreshold = 0.5,
  ListFooterComponent,
}: MasonryGridProps<T>) {
  const { getDimensions, updateDimensions } = useImageDimensions();

  // Handle scroll event to detect when user reaches bottom
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!onEndReached) return;

    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;

    // Calculate how far from bottom the user is
    const paddingToBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;

    // Trigger when user is within threshold distance from bottom
    const threshold = layoutMeasurement.height * onEndReachedThreshold;

    if (paddingToBottom < threshold) {
      onEndReached();
    }
  }, [onEndReached, onEndReachedThreshold]);

  // Distribute items into columns for masonry layout
  const columns: T[][] = Array.from({ length: numColumns }, () => []);
  data.forEach((item, index) => {
    columns[index % numColumns].push(item);
  });

  if (data.length === 0 && emptyComponent) {
    return <>{emptyComponent}</>;
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={100}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            colors={['#fff']}
          />
        ) : undefined
      }
    >
      <View style={styles.masonryContainer}>
        {columns.map((column, columnIndex) => (
          <View key={columnIndex} style={styles.masonryColumn}>
            {column.map((item) => {
              const key = keyExtractor(item);
              const dims = getDimensions(key);
              return (
                <View key={key}>
                  {renderItem(item, dims, updateDimensions)}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {ListFooterComponent && <View>{ListFooterComponent}</View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 12,
    paddingBottom: 100,
  },
  masonryContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  masonryColumn: {
    flex: 1,
  },
});

export { useImageDimensions };
