import React from 'react';
import { View, StyleSheet, Dimensions, ScrollView } from 'react-native';
import Skeleton from './Skeleton';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Mirror the geometry in app/(tabs)/home.tsx so the placeholder layout matches
// the real content exactly — nothing reflows when data lands.
const HERO_IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 4 / 3);
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.42);
const CARD_IMAGE_HEIGHT = Math.round(CARD_WIDTH * 4 / 3);
const SECTION_GAP = 28;
const CARDS_PER_STRIP = 4;
const STRIP_COUNT = 3;

export default function HomeSkeleton() {
  return (
    <View>
      {/* Featured hero */}
      <Skeleton
        style={{ width: SCREEN_WIDTH, height: HERO_IMAGE_HEIGHT }}
        borderRadius={0}
      />

      {/* Category strips */}
      {Array.from({ length: STRIP_COUNT }).map((_, sectionIdx) => (
        <View key={sectionIdx} style={{ marginTop: SECTION_GAP }}>
          {/* Section title + subtitle */}
          <View style={styles.sectionHeader}>
            <Skeleton
              style={{ width: 180, height: 24 }}
              borderRadius={6}
              delayMs={sectionIdx * 80}
            />
            <Skeleton
              style={{ width: 230, height: 12, marginTop: 8 }}
              borderRadius={4}
              delayMs={sectionIdx * 80 + 40}
            />
          </View>

          {/* Horizontal card row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false}
            contentContainerStyle={styles.cardRow}
          >
            {Array.from({ length: CARDS_PER_STRIP }).map((_, cardIdx) => (
              <View key={cardIdx} style={[styles.card, cardIdx > 0 && { marginLeft: 10 }]}>
                <Skeleton
                  style={{ width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT }}
                  borderRadius={14}
                  delayMs={sectionIdx * 80 + cardIdx * 60}
                />
                <Skeleton
                  style={{ width: CARD_WIDTH * 0.7, height: 16, marginTop: 12 }}
                  borderRadius={4}
                  delayMs={sectionIdx * 80 + cardIdx * 60 + 30}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  cardRow: {
    paddingHorizontal: 16,
  },
  card: {
    alignItems: 'flex-start',
  },
});
