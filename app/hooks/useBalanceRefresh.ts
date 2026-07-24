/**
 * Shared Balance Refresh Hook
 *
 * Automatically refreshes balance when the tab gains focus.
 * Used by both Editor and Create tabs.
 */

import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';

export function useBalanceRefresh() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setRefreshTrigger(prev => prev + 1);
    }, [])
  );

  const manualRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return {
    refreshTrigger,
    manualRefresh,
  };
}
