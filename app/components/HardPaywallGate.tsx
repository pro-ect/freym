/**
 * HardPaywallGate — the hard paywall at the end of the hard-paywall onboarding
 * flow (app_config.hard_paywall_flow_v2).
 *
 * Armed by LabOnboardingModal via AsyncStorage HARD_PAYWALL_PENDING_KEY, set
 * only after the free onboarding generation delivered a result. Renders the
 * same RevenueCat dashboard-designed paywall as RCPaywallModal, but:
 *   - no close button (unless config.paywall.dismissable)
 *   - optional custom ✕ that appears after close_button_delay_seconds
 *   - Android back is a no-op while hard
 *   - re-shown on EVERY app launch until purchase/restore
 *     (config.paywall.reshow_on_relaunch)
 *
 * Safety valves (checked on every launch BEFORE showing):
 *   - remote config disabled → clear the key, never show (reviewer escape)
 *   - user already subscribed → clear the key
 *   - reshow_on_relaunch=false and it was shown once → clear the key
 * Live entitlement flip (restore on another surface) auto-dismisses.
 *
 * Root-level like PostOnboardingFlow: the RC paywall is a native view and must
 * never be presented from inside the onboarding <Modal> (stale-UIViewController
 * touch freeze).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { type PurchasesOffering } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import * as StoreReview from 'expo-store-review';
import { ENTITLEMENTS } from '../../lib/revenuecat';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useBalance } from '../../contexts/BalanceContext';
import {
  getHardPaywallFlowConfig,
  HARD_PAYWALL_PENDING_KEY,
  HARD_PAYWALL_PREVIEW_KEY,
  type HardPaywallFlowConfig,
} from '../../lib/hardPaywallFlow/config';
import { capturePH } from '../../lib/posthog';
import { isCreatorAccess } from '../../lib/creatorAccess';

const SHOWN_ONCE_KEY = '@hard_paywall_shown_once_v1';
// Keep in sync with PostOnboardingFlow — purchase on the hard paywall counts
// as the moment to ask for a rating (once ever).
const RATING_PROMPTED_KEY = '@onboarding_rating_prompted_v1';
const TRIGGER = 'hard_paywall_onboarding';

export default function HardPaywallGate() {
  const { subscriptionStatus, isLoading, refresh } = useSubscription();
  const { balanceInfo, hasCustomKey } = useBalance();
  const { shouldShowOnboarding } = useOnboarding();
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<HardPaywallFlowConfig | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [closeButtonShown, setCloseButtonShown] = useState(false);
  const checkedRef = useRef(false);
  // Tester preview (7-tap on the Aya logo): show even for subscribers, force
  // a close button, never re-arm on relaunch.
  const previewRef = useRef(false);

  const clearPending = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(HARD_PAYWALL_PENDING_KEY);
      await AsyncStorage.removeItem(HARD_PAYWALL_PREVIEW_KEY);
    } catch {}
  }, []);

  // Re-arm the launch check whenever onboarding re-opens (admin reset or the
  // 7-tap preview) so finishing it can trigger the paywall again this session.
  useEffect(() => {
    if (shouldShowOnboarding) checkedRef.current = false;
  }, [shouldShowOnboarding]);

  // Decide once per launch, after onboarding is out of the way and the
  // subscription state has loaded.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Wait for both subscription AND balance to load so the has-coins check
    // below is reliable (an unloaded balance reads 0 and would wrongly lock).
    if (shouldShowOnboarding || isLoading || balanceInfo.isLoading || checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const pending = await AsyncStorage.getItem(HARD_PAYWALL_PENDING_KEY);
        if (pending !== 'true' || cancelled) return;

        const preview = (await AsyncStorage.getItem(HARD_PAYWALL_PREVIEW_KEY)) === 'true';
        previewRef.current = preview;
        if (preview) {
          // One-shot: clear both keys up-front so a kill/relaunch can never
          // strand a tester (who may be subscribed) behind the hard paywall.
          await clearPending();
        }

        if (!preview && subscriptionStatus.isSubscribed) {
          await clearPending();
          return;
        }
        // Creators (secret-skip or hand-flagged) never see the hard paywall.
        if (!preview && (await isCreatorAccess())) {
          await clearPending();
          return;
        }

        const cfg = await getHardPaywallFlowConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.paywall.enabled) {
          // Remote kill switch (whole flow or just the paywall) — also
          // releases anyone already armed.
          await clearPending();
          return;
        }

        // Don't hard-lock users who already have coins (coin-pack buyers,
        // hand-granted creators, returning users). Brand-new users have a 0
        // balance, so they still get the paywall. BYOK users (∞) too.
        if (
          !preview &&
          cfg.paywall.skipIfHasCoins &&
          (balanceInfo.rawValue > 0 || hasCustomKey)
        ) {
          await clearPending();
          return;
        }

        const shownOnce = await AsyncStorage.getItem(SHOWN_ONCE_KEY);
        if (!preview && !cfg.paywall.reshowOnRelaunch && shownOnce === 'true') {
          await clearPending();
          return;
        }

        // Optional dedicated offering (e.g. a close-button-less duplicate of
        // the main paywall). Falls back to the current offering on any miss.
        if (cfg.paywall.offeringLookupKey) {
          try {
            const offerings = await Purchases.getOfferings();
            const target = offerings.all[cfg.paywall.offeringLookupKey] ?? null;
            setOffering(target);
            if (target) {
              console.log('[HardPaywallGate] using offering:', cfg.paywall.offeringLookupKey);
            } else {
              // Common causes: paywall/offering not published yet, RC SDK's
              // offerings cache (restart the app), or the offering's products
              // not fetchable from the store — RC drops such offerings.
              console.warn(
                '[HardPaywallGate] offering not found:',
                cfg.paywall.offeringLookupKey,
                '— falling back to current. Available:',
                Object.keys(offerings.all),
              );
            }
          } catch (err) {
            console.warn('[HardPaywallGate] offering fetch failed:', err);
          }
        }
        if (cancelled) return;

        setConfig(cfg);
        // Small delay so the onboarding Modal (when we arrive straight from
        // it) has fully torn down natively — same trick as PostOnboardingFlow.
        setTimeout(async () => {
          if (cancelled) return;
          try {
            await AsyncStorage.setItem(SHOWN_ONCE_KEY, 'true');
          } catch {}
          setVisible(true);
          capturePH('paywall_viewed', { trigger: TRIGGER, hard: !cfg.paywall.dismissable });
        }, 600);
      } catch (err) {
        console.warn('[HardPaywallGate] check failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldShowOnboarding, isLoading, balanceInfo.isLoading, balanceInfo.rawValue, hasCustomKey, subscriptionStatus.isSubscribed, clearPending]);

  // Delayed custom ✕ for the hard mode. Preview always gets one after 2s so
  // a (possibly subscribed) tester can leave.
  useEffect(() => {
    if (!visible || !config) return;
    if (config.paywall.dismissable) return;
    const delay = previewRef.current ? 2 : config.paywall.closeButtonDelaySeconds;
    if (delay <= 0) return;
    const t = setTimeout(() => setCloseButtonShown(true), delay * 1000);
    return () => clearTimeout(t);
  }, [visible, config]);

  // Live entitlement flip (e.g. restore finished elsewhere) → stand down.
  // Skipped in preview — testers are usually already subscribed.
  useEffect(() => {
    if (!visible || previewRef.current) return;
    if (subscriptionStatus.isSubscribed) {
      clearPending();
      setVisible(false);
    }
  }, [visible, subscriptionStatus.isSubscribed, clearPending]);

  const scheduleRatingPrompt = useCallback(() => {
    setTimeout(async () => {
      try {
        const already = await AsyncStorage.getItem(RATING_PROMPTED_KEY);
        if (already === 'true') return;
        if (!(await StoreReview.hasAction())) return;
        await AsyncStorage.setItem(RATING_PROMPTED_KEY, 'true');
        StoreReview.requestReview().catch(() => {});
      } catch {}
    }, 6000);
  }, []);

  const handlePurchaseComplete = useCallback(async () => {
    capturePH('paywall_purchase_completed', { trigger: TRIGGER });
    await clearPending();
    setVisible(false);
    refresh();
    scheduleRatingPrompt();
  }, [clearPending, refresh, scheduleRatingPrompt]);

  // Soft dismissal: only reachable via the RC close button (dismissable mode)
  // or the delayed custom ✕. The pending key is intentionally KEPT so the
  // paywall re-arms on the next launch (unless reshow_on_relaunch is off, in
  // which case the launch check clears it).
  const handleSoftDismiss = useCallback(() => {
    capturePH('paywall_dismissed', { trigger: TRIGGER });
    setVisible(false);
  }, []);

  // Keep the Modal MOUNTED after dismissal and drive it via the `visible`
  // prop only (same pattern as RCPaywallModal). Returning null while the
  // native modal + RC paywall VC are still presented rips them out
  // mid-dismissal and leaves a stale UIViewController over the app — every
  // touch/scroll freezes (same class of bug documented in PostOnboardingFlow).
  if (Platform.OS === 'web' || !config) return null;

  const isHard = !config.paywall.dismissable;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      // Android back: no-op while hard, soft-dismiss otherwise.
      onRequestClose={isHard ? () => {} : handleSoftDismiss}
    >
      <View style={styles.container}>
        <RevenueCatUI.Paywall
          options={{
            displayCloseButton: config.paywall.dismissable,
            ...(offering ? { offering } : {}),
          }}
          onPurchaseCompleted={handlePurchaseComplete}
          onPurchaseError={() => {
            // Stay open; user can retry.
          }}
          onRestoreCompleted={({ customerInfo }) => {
            if (customerInfo.entitlements.active[ENTITLEMENTS.SUBSCRIPTION]) {
              handlePurchaseComplete();
            }
          }}
          onDismiss={isHard ? () => {} : handleSoftDismiss}
        />
        {isHard && closeButtonShown && (
          <Pressable
            style={styles.closeButton}
            onPress={handleSoftDismiss}
            hitSlop={12}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeButton: {
    position: 'absolute',
    top: 58,
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
