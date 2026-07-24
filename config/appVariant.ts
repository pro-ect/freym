/**
 * App Configuration
 *
 * Single Lab app — all variant infrastructure removed.
 * BYOK is available as an optional power-user feature.
 */

import { Platform } from 'react-native';

// RevenueCat API keys (freym project)
// TODO(freym): create the "freym" app in RevenueCat (bundle id genai.freym.studio)
// and paste its keys here. Empty keys → RevenueCat init is skipped (app runs
// without paywall/coins until wired).
// App Store key — used by preview + production (real App Store / sandbox).
const REVENUECAT_APP_STORE_KEY = '';
// Play Store key — the Android counterpart. RC keys are per-store: passing the
// `appl_` key to Purchases.configure on Android throws, which used to leave the
// app running with zero offerings (see getRevenueCatApiKey below).
const REVENUECAT_PLAY_STORE_KEY = '';
// Test Store key — used ONLY by dev-client builds so the RC paywall + fake
// purchases work without App Store Connect, a sandbox account, or a matching
// bundle id. Never ships in a release build (see getRevenueCatApiKey below).
const REVENUECAT_TEST_STORE_KEY = '';

// Feature helpers — all return constants now
export const hasCoinSystem = (): boolean => true;
export const isByokOnly = (): boolean => false;
export const shouldInitRevenueCat = (): boolean => getRevenueCatApiKey() !== '';
export const requiresApiKeyOnboarding = (): boolean => false;
export const getDefaultTabs = () => ({
  // freym 5-tab structure: Inspire · Photo · Video · Edit · Library
  inspire: true,  // freym prompt feed (2-column, sc_posts)
  create: true,   // Photo — Studio (model picker + params)
  video: true,    // Video generation
  editor: true,   // Edit
  library: true,
  // Archived — hidden by default (still re-enableable in Settings)
  home: false,    // old models grid
  imagine: false, // Copy Shot generate-from-ref
  tools: false,   // Effects — utility recipes
  recipes: false,
});
export const hasFreeGenerations = (): boolean => false;
export const shouldShowLabOnboarding = (): boolean => true;
// BYOK is retired. Existing users with stored keys still work server-side,
// but the new client never exposes setup UI or treats BYOK as a path.
export const isByokAvailable = (): boolean => false;
export const shouldShowCoinBonus = (): boolean => true;
// __DEV__ is true only in the dev-client (development) build; it is compiled to
// `false` in every release build (preview + production), so the Test Store key
// can never ship to a store. (RevenueCat also hard-crashes any release build
// that initializes with a test key, as a second safety net.)
export const getRevenueCatApiKey = (): string => {
  if (__DEV__) return REVENUECAT_TEST_STORE_KEY;
  return Platform.OS === 'android'
    ? REVENUECAT_PLAY_STORE_KEY
    : REVENUECAT_APP_STORE_KEY;
};
