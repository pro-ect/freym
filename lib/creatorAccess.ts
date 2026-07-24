import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Creator secret-skip.
 *
 * A hidden 7-tap gesture on the onboarding selfie-example thumbnails marks
 * this account as a creator: it skips the initial generation step and every
 * onboarding paywall (hard, post-onboarding, first-launch), landing them
 * straight in the app. Coins are granted BY HAND in Supabase (which is also
 * how creators are identified), so this flag carries no money and is safe to
 * set purely on the client.
 *
 * Persistence: the local flag is instant and offline. It's also mirrored from
 * `profiles.creator_access` on profile load (BalanceContext), so an account
 * the founder flags by hand in Supabase keeps skipping paywalls even after a
 * reinstall that wipes AsyncStorage.
 *
 * Kill switch: the gesture checks `app_config.creator_access_enabled` before
 * arming, so it can be disabled remotely if it ever leaks.
 */

export const CREATOR_ACCESS_KEY = '@creator_access';

export async function setCreatorAccess(): Promise<void> {
  try {
    await AsyncStorage.setItem(CREATOR_ACCESS_KEY, 'true');
  } catch {
    // best effort — a failed write just means the gesture must be redone
  }
}

export async function isCreatorAccess(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CREATOR_ACCESS_KEY)) === 'true';
  } catch {
    return false;
  }
}
