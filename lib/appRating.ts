import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GENERATIONS_COUNT_KEY = '@successful_generations_count';
const RATING_MILESTONES = [1, 10, 50];
const PROMPT_DELAY_MS = 12000; // 12 seconds

export async function trackGenerationAndPromptRating(): Promise<void> {
  try {
    const currentCount = await AsyncStorage.getItem(GENERATIONS_COUNT_KEY);
    const newCount = (parseInt(currentCount || '0', 10)) + 1;
    await AsyncStorage.setItem(GENERATIONS_COUNT_KEY, String(newCount));

    if (RATING_MILESTONES.includes(newCount)) {
      setTimeout(async () => {
        if (await StoreReview.hasAction()) {
          await StoreReview.requestReview();
        }
      }, PROMPT_DELAY_MS);
    }
  } catch (error) {
    // Silent fail - rating prompt is not critical
    console.warn('Failed to track generation for rating:', error);
  }
}
