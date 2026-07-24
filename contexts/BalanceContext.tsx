/**
 * BalanceContext - Global balance state shared across all tabs
 *
 * Provides real-time balance updates to all components without
 * each tab needing its own subscription.
 *
 * - BYOK users (grandfathered, has custom API key): Show "∞" (unlimited)
 * - Regular users: Show coin_balance
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { formatBalance } from '../lib/replicate/accountBalance';
import { setCreatorAccess } from '../lib/creatorAccess';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface BalanceInfo {
  displayText: string;
  isReplicateBalance: boolean;
  rawValue: number;
  isLoading: boolean;
  freeGenerationsRemaining?: number;
  hasFalKey?: boolean;
  hasReplicateKey?: boolean;
}

interface BalanceContextValue {
  balanceInfo: BalanceInfo;
  hasCustomKey: boolean;
  refresh: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextValue | null>(null);

async function fetchBalanceData(userIdToFetch: string): Promise<{
  balance: number;
  hasCustomKey: boolean;
  displayText: string;
  isReplicateBalance: boolean;
  freeGenerationsRemaining?: number;
  hasFalKey?: boolean;
  hasReplicateKey?: boolean;
} | null> {
  // Bound the request so a hung socket (flaky mobile network / stalled RLS)
  // can't leave the caller awaiting forever — abort after 8s → the query
  // rejects → we return null, which the caller maps to a safe display.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('has_custom_key, replicate_api_key_encrypted, fal_api_key_encrypted, coin_balance, subscription_coins, free_generations_remaining, creator_access')
      .eq('id', userIdToFetch)
      .abortSignal(controller.signal)
      .maybeSingle();

    if (!profile) {
      console.log('fetchBalanceData: No profile found for user:', userIdToFetch);
      return null;
    }

    // Mirror a hand-set creator flag to the local paywall-skip flag so an
    // account the founder flags in Supabase keeps skipping paywalls even after
    // a reinstall wiped AsyncStorage.
    if (profile.creator_access === true) {
      setCreatorAccess().catch(() => {});
    }

    const hasReplicateKey = !!(profile.has_custom_key && profile.replicate_api_key_encrypted);
    const hasFalKey = !!profile.fal_api_key_encrypted;
    const userHasCustomKey = hasReplicateKey || hasFalKey;
    const freeGens = profile.free_generations_remaining ?? 20;
    const totalBalance = (profile.coin_balance || 0) + (profile.subscription_coins || 0);

    // Grandfathered BYOK users get unlimited
    if (userHasCustomKey) {
      return {
        balance: 0,
        hasCustomKey: true,
        displayText: '∞',
        isReplicateBalance: true,
        freeGenerationsRemaining: freeGens,
        hasFalKey,
        hasReplicateKey,
      };
    }

    // Regular users show coin balance
    return {
      balance: totalBalance,
      hasCustomKey: false,
      displayText: String(totalBalance),
      isReplicateBalance: false,
      freeGenerationsRemaining: freeGens,
      hasFalKey: false,
      hasReplicateKey: false,
    };
  } catch (error) {
    console.error('Error fetching balance data:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo>({
    displayText: '',
    isReplicateBalance: false,
    rawValue: 0,
    isLoading: true,
  });
  const [userId, setUserId] = useState<string | null>(null);
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const loadBalance = useCallback(async (userIdToLoad?: string) => {
    let targetUserId = userIdToLoad || userIdRef.current;

    try {
      if (!targetUserId) {
        // getSession() reads the persisted session from local storage (no
        // /auth/v1/user network round trip), so it can't hang on a flaky
        // network the way getUser() could.
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          setBalanceInfo({
            displayText: '',
            isReplicateBalance: false,
            rawValue: 0,
            isLoading: false,
          });
          return;
        }
        setUserId(user.id);
        userIdRef.current = user.id;
        targetUserId = user.id;
      }

      const result = await fetchBalanceData(targetUserId);
      if (result) {
        setHasCustomKey(result.hasCustomKey);
        setBalanceInfo({
          displayText: result.displayText,
          isReplicateBalance: result.isReplicateBalance,
          rawValue: result.balance,
          isLoading: false,
          freeGenerationsRemaining: result.freeGenerationsRemaining,
          hasFalKey: result.hasFalKey,
          hasReplicateKey: result.hasReplicateKey,
        });
      } else {
        // Missing profile OR a timed-out/failed fetch. Prefer the last-known
        // balance over flashing a wrong "0"; only fall back to "0" when we've
        // never had a value.
        setBalanceInfo(prev => ({
          ...prev,
          displayText: prev.displayText || '0',
          isLoading: false,
        }));
      }
    } catch (error) {
      console.error('BalanceContext: loadBalance failed:', error);
    } finally {
      // Hard guarantee: the chip can never be left spinning indefinitely.
      setBalanceInfo(prev => (prev.isLoading ? { ...prev, isLoading: false } : prev));
    }
  }, []);

  // Initial load and auth state changes
  useEffect(() => {
    console.log('BalanceContext: Initializing...');
    loadBalance();

    // Failsafe: if the very first load stalls for any reason (even before
    // loadBalance's own finally can run), stop the infinite spinner after 8s.
    const failsafeTimer = setTimeout(() => {
      setBalanceInfo(prev =>
        prev.isLoading
          ? { ...prev, displayText: prev.displayText || '0', isLoading: false }
          : prev
      );
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('BalanceContext: Auth state changed:', event);
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          setUserId(session.user.id);
          userIdRef.current = session.user.id;
          loadBalance(session.user.id);
        }
      } else if (event === 'SIGNED_OUT') {
        setUserId(null);
        userIdRef.current = null;
        setHasCustomKey(false);
        setBalanceInfo({
          displayText: '',
          isReplicateBalance: false,
          rawValue: 0,
          isLoading: false,
        });
      }
    });

    return () => {
      clearTimeout(failsafeTimer);
      subscription.unsubscribe();
    };
  }, [loadBalance]);

  // Real-time subscription for balance changes.
  // Hardened: handles CHANNEL_ERROR/TIMED_OUT/CLOSED with backoff reconnect,
  // reconciles on (re)subscribe, and refetches when the app returns to foreground —
  // so a flaky socket can no longer leave the chip showing a stale balance.
  useEffect(() => {
    if (!userId || hasCustomKey) {
      return;
    }

    let isCleanedUp = false;
    const MAX_BACKOFF_MS = 30_000;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (isCleanedUp) return;
      clearReconnectTimer();
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      reconnectAttemptsRef.current = attempt + 1;
      console.log(`BalanceContext: scheduling realtime reconnect in ${delay}ms (attempt ${attempt + 1})`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!isCleanedUp) setupChannel();
      }, delay);
    };

    const setupChannel = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channel = supabase
        .channel(`global_balance_${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'coin_transactions',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            console.log('BalanceContext: coin_transactions change received:', payload.eventType);
            loadBalance();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            console.log('BalanceContext: profiles update received');
            const newData = payload.new as any;

            const purchasedCoins = newData?.coin_balance ?? 0;
            const subscriptionCoins = newData?.subscription_coins ?? 0;
            const totalBalance = purchasedCoins + subscriptionCoins;

            if (newData?.coin_balance !== undefined || newData?.subscription_coins !== undefined) {
              console.log('BalanceContext: Updating balance to:', { purchasedCoins, subscriptionCoins, totalBalance });
              setBalanceInfo(prev => ({
                ...prev,
                displayText: String(totalBalance),
                rawValue: totalBalance,
              }));
            }
          }
        )
        .subscribe((status) => {
          console.log('BalanceContext: Subscription status:', status);
          if (status === 'SUBSCRIBED') {
            // Reconcile anything missed while the channel was down.
            reconnectAttemptsRef.current = 0;
            clearReconnectTimer();
            loadBalance();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`BalanceContext: realtime ${status} — will reconnect`);
            scheduleReconnect();
          }
        });

      channelRef.current = channel;
    };

    setupChannel();

    // Self-heal on foreground even if realtime is flaky.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        console.log('BalanceContext: app foregrounded — refetching balance');
        loadBalance();
      }
    });

    return () => {
      isCleanedUp = true;
      clearReconnectTimer();
      reconnectAttemptsRef.current = 0;
      appStateSub.remove();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, hasCustomKey, loadBalance]);

  const refresh = useCallback(async () => {
    await loadBalance();
  }, [loadBalance]);

  return (
    <BalanceContext.Provider value={{ balanceInfo, hasCustomKey, refresh }}>
      {children}
    </BalanceContext.Provider>
  );
}

/**
 * Hook to access global balance state
 */
export function useBalance() {
  const context = useContext(BalanceContext);
  if (!context) {
    throw new Error('useBalance must be used within a BalanceProvider');
  }
  return context;
}
