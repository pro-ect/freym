/**
 * PostOnboardingFlow — runs the paywall + rating prompt AFTER onboarding closes.
 *
 * Why this exists: presenting the RevenueCat paywall (a *native* view) from
 * inside LabOnboardingModal's React Native <Modal> left a stale UIViewController
 * on top of Home when it dismissed, freezing every touch and flashing the last
 * onboarding slide back. Here the paywall is the root-level PaywallContext Modal
 * (no nesting), shown only once the onboarding Modal has fully unmounted.
 *
 * Sequence:
 *   onboarding completes → pendingPostOnboarding flips true
 *   → (onboarding Modal unmounts) → short delay for native teardown
 *   → mark first-launch paywall as shown → showPaywall('post_onboarding')
 *   → user dismisses it → schedule the native rating prompt (once ever)
 *   → clear the pending flag.
 *
 * Renders nothing — it only orchestrates.
 */
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { HARD_PAYWALL_PENDING_KEY } from '../../lib/hardPaywallFlow/config';
import { isCreatorAccess } from '../../lib/creatorAccess';

// Keep in sync with FIRST_LAUNCH_PAYWALL_KEY in app/_layout.tsx — the
// post-onboarding paywall IS the first-launch paywall, so we mark it shown to
// stop useFirstLaunchPaywall from firing a second one.
const FIRST_LAUNCH_PAYWALL_KEY = '@first_launch_paywall_shown_v1';
const RATING_PROMPTED_KEY = '@onboarding_rating_prompted_v1';

export default function PostOnboardingFlow() {
  const { pendingPostOnboarding, dismissPostOnboarding } = useOnboarding();
  const { showPaywall, isPaywallVisible } = usePaywall();

  const startedRef = useRef(false);
  const shownPaywallRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const finishedRef = useRef(false);

  // Step 1: once onboarding finishes, present the paywall after the onboarding
  // Modal has had time to tear down natively.
  useEffect(() => {
    if (!pendingPostOnboarding || startedRef.current) return;
    startedRef.current = true;

    const t = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(FIRST_LAUNCH_PAYWALL_KEY, 'true');
      } catch {}

      // Hard-paywall flow armed the hard paywall — HardPaywallGate owns both
      // the paywall and the rating prompt from here; don't show the soft one.
      // Creator secret-skip likewise suppresses every onboarding paywall.
      try {
        const hardPending = await AsyncStorage.getItem(HARD_PAYWALL_PENDING_KEY);
        const creator = await isCreatorAccess();
        if (hardPending === 'true' || creator) {
          finishedRef.current = true;
          dismissPostOnboarding();
          return;
        }
      } catch {}

      shownPaywallRef.current = true;
      showPaywall('post_onboarding');
    }, 600);

    return () => clearTimeout(t);
  }, [pendingPostOnboarding, showPaywall, dismissPostOnboarding]);

  // Step 2: when the paywall is dismissed, fire the rating prompt once (~6s
  // later, matching prior behaviour), then clear the pending flag.
  // NOTE: deliberately no cleanup on the rating timer — dismissPostOnboarding()
  // flips pendingPostOnboarding, which would otherwise clear it before it fires.
  useEffect(() => {
    if (!pendingPostOnboarding || finishedRef.current) return;

    if (isPaywallVisible) {
      wasVisibleRef.current = true;
      return;
    }
    if (!shownPaywallRef.current || !wasVisibleRef.current) return;

    // Paywall just closed.
    finishedRef.current = true;

    setTimeout(async () => {
      try {
        const already = await AsyncStorage.getItem(RATING_PROMPTED_KEY);
        if (already === 'true') return;
        if (!(await StoreReview.hasAction())) return;
        await AsyncStorage.setItem(RATING_PROMPTED_KEY, 'true');
        StoreReview.requestReview().catch(() => {});
      } catch {}
    }, 6000);

    dismissPostOnboarding();
  }, [pendingPostOnboarding, isPaywallVisible, dismissPostOnboarding]);

  return null;
}
