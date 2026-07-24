/**
 * SubscriptionContext - Global subscription state from RevenueCat
 *
 * Tracks user's subscription status, entitlements, and provides
 * functions to present the appropriate paywall based on user state.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import Purchases from 'react-native-purchases';
import {
  getSubscriptionStatus,
  addCustomerInfoUpdateListener,
  restorePurchases,
  setRevenueCatUserId,
  SubscriptionStatus,
} from '../lib/revenuecat';
import { supabase } from '../lib/supabase';
import { logAFPurchase, setAppsFlyerUserId } from '../lib/appsflyer';
import { identifyPostHogUser, resetPostHog, capturePH } from '../lib/posthog';

interface SubscriptionContextValue {
  subscriptionStatus: SubscriptionStatus;
  isLoading: boolean;
  refresh: () => Promise<void>;
  restorePurchases: () => Promise<boolean>;
}

const defaultStatus: SubscriptionStatus = {
  isSubscribed: false,
  activeEntitlements: [],
  expirationDate: null,
  willRenew: false,
  productIdentifier: null,
  periodType: null,
  // Placeholder, not a fetch result — nothing may revoke coins off this.
  fetchOk: false,
};

// One-time coin pack product IDs. Coin amounts are resolved SERVER-SIDE in the
// credit_coin_pack RPC — this set is only used to filter RC transactions.
const COIN_PACK_PRODUCT_IDS = new Set<string>([
  'lab.coins.500', 'lab.coins.2000', 'coins_500', 'coins_2000',
  'lab.coins.100', 'lab.coins.300', 'lab.coins.700',
  'com.aya.copyshot.coins.1000', 'com.aya.copyshot.coins.3000', 'com.aya.copyshot.coins.5000',
]);
// Only reconcile coin packs purchased on/after this date. Packs bought earlier
// were credited by the webhook before idempotent dedupe (processed_purchases)
// existed, so re-crediting them client-side would double-grant.
const COIN_PACK_RECONCILE_SINCE = Date.parse('2026-06-21T00:00:00Z');

// Persist the Supabase-UUID <-> RevenueCat-app_user_id mapping so the webhook can
// resolve $RCAnonymousID events server-side (renewals/expirations for users RC only
// knows by an anonymous id) and so we can debug identity without the RC dashboard.
// The record_revenuecat_identity RPC maps each id to auth.uid() server-side, so we
// only pass the RC ids — never the Supabase id. Best-effort; never throws.
async function recordRcIdentities(): Promise<void> {
  try {
    const ids = new Set<string>();
    const appUserId = await Purchases.getAppUserID();
    if (appUserId) ids.add(appUserId);
    try {
      const info = await Purchases.getCustomerInfo();
      if (info?.originalAppUserId) ids.add(info.originalAppUserId);
    } catch { /* customerInfo optional */ }
    for (const id of ids) {
      await supabase.rpc('record_revenuecat_identity', { p_rc_app_user_id: id });
    }
  } catch (e) {
    console.warn('[Subscription] recordRcIdentities failed:', e);
  }
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>(defaultStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const listenerRef = useRef<(() => void) | null>(null);
  // Edge detection for af_purchase: tracks whether we've seen a subscribed=true state
  // for this product yet in this session. null = unobserved; true/false = last observed.
  const lastSubscribedRef = useRef<boolean | null>(null);

  // Product ID to coin amount mapping (must match revenuecat-webhook)
  const SUBSCRIPTION_COIN_AMOUNTS: Record<string, number> = {
    "lab.monthly.2000": 2000,
    "monthly_2000": 2000,
    "lab.monthly.500": 500,
    "weekly_500": 500,
    "yearly_25000": 25000,
    "creators_weekly_600": 600,
    "creators_monthly_3000": 2000,
    "creators_yearly_36000": 36000,
  };

  const loadSubscriptionStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const status = await getSubscriptionStatus();
      setSubscriptionStatus(status);
      console.log('Subscription status loaded:', status);

      // Fire af_purchase only on the false→true subscription edge within this session.
      // First observation seeds the ref without firing — that handles cold-start where
      // the user is already subscribed (renewals/refunds are expected via RC's S2S).
      const prev = lastSubscribedRef.current;
      if (prev === false && status.isSubscribed && status.productIdentifier) {
        try {
          const products = await Purchases.getProducts([status.productIdentifier]);
          const product = products[0];
          const revenue = product?.price ?? 0;
          const currency = product?.currencyCode ?? 'USD';
          // AppsFlyer is the single source of purchase truth → Meta (MMP postback).
          // Do NOT also fire the FB SDK purchase here, or Meta double-counts.
          logAFPurchase({
            revenue,
            currency,
            productId: status.productIdentifier,
          });
        } catch (e) {
          console.warn('[Subscription] af_purchase fire failed:', e);
        }
      }
      lastSubscribedRef.current = status.isSubscribed;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Sync subscription coins to database when RevenueCat shows active subscription.
      // This handles the transfer case: anonymous user buys → signs in → RC transfers
      // subscription → webhook can't credit coins (TRANSFER has no product_id) →
      // client syncs coins here using the product info from RevenueCat SDK.
      //
      // IDENTITY GATE: only grant when RevenueCat is CURRENTLY identified as THIS
      // Supabase user (getAppUserID() === user.id). Otherwise the active entitlement
      // belongs to the DEVICE (a different account, or a still-anonymous
      // $RCAnonymousID that shares the device) and crediting here would duplicate a
      // real subscriber's coins onto an account RevenueCat doesn't know — one the
      // EXPIRATION webhook can never later zero, so the coins would leak permanently.
      // We use getAppUserID() (current identity), NOT customerInfo.originalAppUserId,
      // which stays the first/anon id after a legit transfer and would reject real
      // users. We also require a real future-dated period and pass it as p_period_end
      // so the grant routes through the RPC's authoritative per-cycle path (never the
      // NOW()-stamped one-shot safety-net that never expires).
      let rcAppUserId: string | null = null;
      try {
        rcAppUserId = await Purchases.getAppUserID();
      } catch (e) {
        console.warn('[Subscription] getAppUserID failed, skipping coin sync:', e);
      }
      const rcIdentityMatches = rcAppUserId === user.id;
      const periodEndMs = status.expirationDate ? status.expirationDate.getTime() : 0;
      const hasFuturePeriod = periodEndMs > Date.now();

      if (status.isSubscribed && status.productIdentifier && !rcIdentityMatches) {
        console.log(`[Subscription] Skipping coin sync: RC identity (${rcAppUserId}) != user (${user.id}) — device-shared entitlement, not crediting.`);
      }

      if (
        status.isSubscribed &&
        status.productIdentifier &&
        rcIdentityMatches &&
        hasFuturePeriod
      ) {
        const expectedCoins = SUBSCRIPTION_COIN_AMOUNTS[status.productIdentifier];
        if (expectedCoins) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_coins')
            .eq('id', user.id)
            .maybeSingle();

          if (profile && profile.subscription_coins !== expectedCoins) {
            // periodEndMs is guaranteed a real future date here, so the RPC treats
            // this as an authoritative per-cycle reset: it refills once when a NEW
            // period boundary is seen and no-ops on every foreground within the same
            // cycle. This makes the client a reliable renewal backstop even if the
            // webhook can't credit (e.g. a still-anonymous-then-transferred RC
            // customer), while the same account will later receive the EXPIRATION
            // webhook that zeroes it.
            const periodEndIso = new Date(periodEndMs).toISOString();
            console.log(`Syncing subscription coins: ${profile.subscription_coins} → ${expectedCoins} (${status.productIdentifier}, period_end=${periodEndIso})`);
            await supabase.rpc('set_subscription_coins', {
              p_user_id: user.id,
              p_amount: expectedCoins,
              p_product_id: status.productIdentifier,
              p_period_end: periodEndIso,
            });
            console.log('Subscription coins synced to database');
          }
        }
      }

      // REVOKE (mirror of the grant above). RevenueCat is authoritative: if it says
      // THIS identity holds no subscription entitlement, this account must not be
      // sitting on subscription coins. Without this, the only thing that ever zeroes
      // an account is a webhook — so a TRANSFER (guest buys → signs in → the sub moves
      // to the signed-in account) whose webhook never lands leaves the source account
      // holding a full cycle's coins forever, duplicating one purchase across two
      // accounts. Zeroing here makes expiry/transfer self-healing with no webhook
      // dependency: coins can only be SPENT from a live session, and every session
      // reconciles on load.
      //
      // Four gates, all required — this path DESTROYS balance, so it must never fire
      // on a guess:
      //   fetchOk        — getSubscriptionStatus() returns isSubscribed:false when
      //                    getCustomerInfo() THROWS. Without this gate a network blip
      //                    would wipe a paying subscriber.
      //   rcIdentityMatches — if RC is identified as someone else, its entitlements say
      //                    nothing about THIS user; stay out.
      //   no active WEB (Stripe) sub — web subscribers are granted subscription_coins by
      //                    stripe-webhook and are INVISIBLE to RevenueCat, so RC always
      //                    reports isSubscribed:false for them. Revoking off RC alone
      //                    would wipe a paying Stripe subscriber on every launch. Their
      //                    zeroing is stripe-webhook's job, not ours.
      //   subscription_coins > 0 — nothing to do otherwise (and avoids a write + a
      //                    misleading 0→0 ledger row on every single app launch).
      if (status.fetchOk && rcIdentityMatches && !status.isSubscribed) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('subscription_coins, web_subscription_status, web_subscription_period_end')
          .eq('id', user.id)
          .maybeSingle();

        const webSubActive =
          profile?.web_subscription_status === 'active' ||
          (profile?.web_subscription_period_end
            ? new Date(profile.web_subscription_period_end).getTime() > Date.now()
            : false);

        if (profile && (profile.subscription_coins ?? 0) > 0 && !webSubActive) {
          console.log(`[Subscription] RC reports no entitlement for ${user.id} but DB holds ${profile.subscription_coins} subscription coins — revoking.`);
          // p_amount 0 with a product id other than 'transfer_out' also CLEARS
          // subscription_period_end (see migration 0043), so a genuine re-subscribe
          // is credited normally afterwards rather than being locked out.
          await supabase.rpc('set_subscription_coins', {
            p_user_id: user.id,
            p_amount: 0,
            p_product_id: 'no_entitlement',
          });
          console.log('[Subscription] Subscription coins revoked');
        }
      }

      // Reconcile one-time coin packs. The NON_RENEWING webhook only credits
      // when app_user_id matched at purchase time — an anonymous-then-signin
      // (or a missed webhook) leaves a pack uncredited, and unlike
      // subscriptions nothing else re-grants it. Mirror the subscription sync
      // using RC's customerInfo.
      //
      // Dedupe vs the webhook: tx.transactionIdentifier here is RC's INTERNAL
      // id (o1_...), not the Apple store transaction id the webhook uses, so
      // ids alone can never match (that mismatch double-credited every pack).
      // credit_coin_pack therefore dedupes on (user, product, purchaseDate)
      // and REQUIRES p_purchased_at from client_reconcile callers.
      try {
        const info = await Purchases.getCustomerInfo();
        const txns = info?.nonSubscriptionTransactions ?? [];
        for (const tx of txns) {
          const pid = tx.productIdentifier;
          if (!COIN_PACK_PRODUCT_IDS.has(pid)) continue;
          const purchasedAt = tx.purchaseDate ? Date.parse(tx.purchaseDate) : 0;
          if (!purchasedAt || purchasedAt < COIN_PACK_RECONCILE_SINCE) continue;
          const txId = tx.transactionIdentifier;
          if (!txId) continue;
          await supabase.rpc('credit_coin_pack', {
            p_user_id: user.id,
            p_transaction_id: txId,
            p_product_id: pid,
            p_source: 'client_reconcile',
            p_purchased_at: tx.purchaseDate,
          });
        }
      } catch (e) {
        console.warn('[Subscription] coin pack reconcile failed:', e);
      }

    } catch (error) {
      console.error('Error loading subscription status:', error);
      setSubscriptionStatus(defaultStatus);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load and auth state listener
  useEffect(() => {
    const isAnonymousUser = (user: any): boolean => {
      return user.is_anonymous === true ||
        user.email?.endsWith('@guest.local') ||
        user.user_metadata?.kind === 'guest';
    };

    const initializeSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        // Link RevenueCat for ALL users, including anonymous (guest) ones.
        // Attaching purchases to the Supabase UUID — even a guest uuid — is what
        // lets revenuecat-webhook credit RENEWALS: an $RCAnonymousID can't be
        // matched to a profile (webhook skips non-UUID app_user_ids), so an
        // anonymous subscriber otherwise receives exactly ONE coin grant ever and
        // gets nothing on renewal. The later Apple-sign-in transfer still works —
        // RC Transfer Behavior ("Transfer to new App User ID") moves the sub from
        // the guest uuid to the signed-in uuid, and restorePurchases re-reads
        // Apple's receipt (see docs/.revenuecat-guest-signin-transfer.md).
        try {
          await setRevenueCatUserId(user.id);
          console.log('RevenueCat user ID linked:', user.id, '(anon:', isAnonymousUser(user), ')');
          // Force restore to pick up any transferred/prior purchases.
          await restorePurchases();
          console.log('Purchases restored after logIn');
          // Persist RC id mapping (current + original/anon) for server-side resolution.
          await recordRcIdentities();
        } catch (error) {
          console.error('Failed to link RevenueCat user ID:', error);
        }
        // Identify in PostHog for ALL users (incl. guests) so anonymous session
        // recordings are traceable to a Supabase account. AppsFlyer CUID and the
        // signup/login funnel events stay REAL-users-only — don't pollute
        // acquisition funnels with auto-created guest accounts.
        const guest = isAnonymousUser(user);
        await identifyPostHogUser(user.id, {
          email: user.email,
          is_guest: guest,
          has_email: !!user.email,
        });
        if (!guest) {
          try {
            await setAppsFlyerUserId(user.id);
            const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : 0;
            const isFreshSignup = createdAtMs && (Date.now() - createdAtMs) < 5 * 60 * 1000;
            capturePH(isFreshSignup ? 'user_signed_up' : 'user_logged_in', {
              provider: user.app_metadata?.provider,
              has_email: !!user.email,
            });
          } catch (error) {
            console.error('Failed to set analytics identity:', error);
          }
        }
        await loadSubscriptionStatus();
      } else {
        setIsLoading(false);
      }
    };

    initializeSubscription();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        setUserId(session.user.id);
        // Link RevenueCat for ALL users (see initializeSubscription note) so
        // guest subscribers' renewals can be credited by the webhook.
        try {
          await setRevenueCatUserId(session.user.id);
          console.log('RevenueCat user ID linked on', event, ':', session.user.id, '(anon:', isAnonymousUser(session.user), ')');
          // Force restore to pick up any transferred/prior purchases.
          await restorePurchases();
          console.log('Purchases restored after logIn on', event);
          // Persist RC id mapping (current + original/anon) for server-side resolution.
          await recordRcIdentities();
        } catch (error) {
          console.error('Failed to link RevenueCat user ID on', event, ':', error);
        }
        // Identify in PostHog for ALL users (incl. guests) so anonymous session
        // recordings are traceable to a Supabase account. AppsFlyer CUID + the
        // signup/login funnel events stay REAL-users-only (see above).
        const guest = isAnonymousUser(session.user);
        await identifyPostHogUser(session.user.id, {
          email: session.user.email,
          is_guest: guest,
          has_email: !!session.user.email,
        });
        if (!guest) {
          try {
            await setAppsFlyerUserId(session.user.id);
            const createdAtMs = session.user.created_at ? new Date(session.user.created_at).getTime() : 0;
            const isFreshSignup = createdAtMs && (Date.now() - createdAtMs) < 5 * 60 * 1000;
            capturePH(isFreshSignup ? 'user_signed_up' : 'user_logged_in', {
              provider: session.user.app_metadata?.provider,
              has_email: !!session.user.email,
              auth_event: event,
            });
          } catch (error) {
            console.error('Failed to set analytics identity on', event, ':', error);
          }
        }
        await loadSubscriptionStatus();
      } else if (event === 'SIGNED_OUT') {
        setUserId(null);
        setSubscriptionStatus(defaultStatus);
        resetPostHog();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadSubscriptionStatus]);

  // Set up RevenueCat customer info listener
  useEffect(() => {
    if (!userId) return;

    if (listenerRef.current) {
      listenerRef.current();
    }

    const unsubscribe = addCustomerInfoUpdateListener(async (customerInfo) => {
      console.log('RevenueCat customer info updated');
      await loadSubscriptionStatus();
    });

    listenerRef.current = unsubscribe;

    return () => {
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
    };
  }, [userId, loadSubscriptionStatus]);

  const handleRestorePurchases = useCallback(async (): Promise<boolean> => {
    const result = await restorePurchases();
    if (result) {
      await loadSubscriptionStatus();
    }
    return result;
  }, [loadSubscriptionStatus]);

  return (
    <SubscriptionContext.Provider
      value={{
        subscriptionStatus,
        isLoading,
        refresh: loadSubscriptionStatus,
        restorePurchases: handleRestorePurchases,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

/**
 * Hook to access subscription state and paywall functions
 */
export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
