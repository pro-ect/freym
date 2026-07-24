/**
 * PaywallContext - Global paywall state with smart routing
 *
 * Routes to the correct paywall based on subscription status:
 * - Non-premium users → RCPaywallModal (RevenueCat-hosted subscription paywall)
 * - Premium users → HybridPaywallModal in coinsOnly mode (coin packs only)
 *
 * Anonymous users can purchase freely — RevenueCat is linked to their
 * Supabase UUID, and purchases migrate automatically on Apple sign-in.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import HybridPaywallModal from '../app/components/HybridPaywallModal';
import { useSubscription } from './SubscriptionContext';
import { capturePH } from '../lib/posthog';

interface PaywallContextType {
  showPaywall: (trigger?: string) => void;
  hidePaywall: () => void;
  isPaywallVisible: boolean;
}

const PaywallContext = createContext<PaywallContextType | null>(null);

export function PaywallProvider({ children }: { children: React.ReactNode }) {
  // `visible` tracks the imperative SUBSCRIPTION paywall (for isPaywallVisible /
  // PostOnboardingFlow). `coinsVisible` is a SEPARATE flag for the premium
  // coin-pack sheet. They must not share state: during a non-premium subscription
  // purchase, `isSubscribed` flips true mid-await, which would mount the premium
  // HybridPaywallModal — if it read `visible` (still true during the await) it
  // flashed the coins paywall for a frame before the finally reset it. Decoupled,
  // coinsVisible stays false through the subscription flow, so no flash.
  const [visible, setVisible] = useState(false);
  const [coinsVisible, setCoinsVisible] = useState(false);
  const [trigger, setTrigger] = useState<string>('unknown');
  const { subscriptionStatus, refresh } = useSubscription();

  // Re-entrancy guard: RevenueCatUI.presentPaywall() presents a native VC on
  // the top-most view controller. Calling it twice (e.g. the automatic
  // first-launch present racing a manual tap) stacks a second native paywall,
  // and dismissing the top one leaves a stale UIViewController over the app —
  // the classic "touches dead / frozen" bug. This ref makes present idempotent.
  const presentingRef = useRef(false);

  const hidePaywall = useCallback(() => {
    console.log('📱 PaywallContext: Hiding paywall');
    setVisible(false);
    setCoinsVisible(false);
    capturePH('paywall_dismissed', { trigger });
  }, [trigger]);

  const handlePurchaseComplete = useCallback(() => {
    capturePH('paywall_purchase_completed', { trigger });
    setVisible(false);
    setCoinsVisible(false);
    refresh();
  }, [refresh, trigger]);

  const isPremium = subscriptionStatus.isSubscribed;

  const showPaywall = useCallback(async (triggerSource?: string) => {
    const source = triggerSource || 'unknown';
    console.log('📱 PaywallContext: Showing paywall, trigger:', source, 'isSubscribed:', subscriptionStatus.isSubscribed);
    setTrigger(source);
    capturePH('paywall_viewed', {
      trigger: source,
      is_subscribed: subscriptionStatus.isSubscribed,
      variant: subscriptionStatus.isSubscribed ? 'coins_only' : 'onboarding',
    });

    // Premium users → declarative coin-pack sheet (pure RN, no RevenueCatUI,
    // so no native modal-over-modal freeze). Uses its own coinsVisible flag.
    if (subscriptionStatus.isSubscribed) {
      setCoinsVisible(true);
      return;
    }

    // Non-premium → present the native RC subscription paywall IMPERATIVELY.
    // Wrapping RevenueCatUI.Paywall in an RN <Modal> (the old RCPaywallModal)
    // froze the app whenever it was flipped visible over another open RN modal
    // (e.g. 4K upscale from ImageDetailsModal). presentPaywall manages its own
    // native presentation on the top-most view controller, so it stacks
    // cleanly over any open sheet/alert. `visible` is toggled around the await
    // only so PostOnboardingFlow's isPaywallVisible→rating-prompt still works.
    // Never stack a second native present over one that's still up.
    if (presentingRef.current) {
      console.log('📱 PaywallContext: present already in progress, ignoring', source);
      return;
    }
    presentingRef.current = true;
    setVisible(true);
    try {
      const result = await RevenueCatUI.presentPaywall({ displayCloseButton: true });
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        handlePurchaseComplete();
      } else {
        capturePH('paywall_dismissed', { trigger: source });
      }
    } catch (err) {
      console.warn('[Paywall] presentPaywall failed:', err);
      capturePH('paywall_dismissed', { trigger: source });
    } finally {
      presentingRef.current = false;
      setVisible(false);
    }
  }, [subscriptionStatus.isSubscribed, handlePurchaseComplete]);

  return (
    <PaywallContext.Provider value={{ showPaywall, hidePaywall, isPaywallVisible: visible || coinsVisible }}>
      {children}
      {/* Premium coin-pack sheet only, driven by its OWN coinsVisible flag so it
          never rides the subscription flow's `visible` (which caused the coins
          paywall to flash for a frame right after a subscription purchase). The
          non-premium subscription paywall is presented imperatively in
          showPaywall (no RN Modal → no freeze). */}
      {isPremium && (
        <HybridPaywallModal
          visible={coinsVisible}
          onClose={hidePaywall}
          onPurchaseComplete={handlePurchaseComplete}
          trigger={trigger}
        />
      )}
    </PaywallContext.Provider>
  );
}

/**
 * Hook to access paywall functionality
 *
 * Usage:
 * ```
 * const { showPaywall } = usePaywall();
 *
 * // When user tries to generate with insufficient coins
 * if (coinBalance < cost) {
 *   showPaywall('insufficient_coins');
 *   return;
 * }
 * ```
 */
export function usePaywall() {
  const context = useContext(PaywallContext);
  if (!context) {
    throw new Error('usePaywall must be used within PaywallProvider');
  }
  return context;
}
