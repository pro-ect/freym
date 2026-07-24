/**
 * useReplicateBalance Hook
 *
 * Thin wrapper around useBalance from BalanceContext.
 * Kept for backwards compatibility with existing components.
 *
 * The actual balance logic and realtime subscriptions are handled
 * by the BalanceProvider in the app layout.
 */

import { useBalance, BalanceInfo } from '../../contexts/BalanceContext';

/**
 * @deprecated Use useBalance() from BalanceContext directly
 * @param _refreshTrigger - Ignored, kept for backwards compatibility
 */
export function useReplicateBalance(_refreshTrigger?: number): BalanceInfo {
  const { balanceInfo } = useBalance();
  return balanceInfo;
}

// Re-export type for backwards compatibility
export type { BalanceInfo };
