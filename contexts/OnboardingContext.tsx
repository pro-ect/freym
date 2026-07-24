/**
 * Onboarding Context
 *
 * Manages onboarding completion state for Lab variant.
 * Persists to AsyncStorage so users only see onboarding once.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface OnboardingContextType {
  hasCompletedOnboarding: boolean;
  shouldShowOnboarding: boolean;
  isLoading: boolean;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>; // For testing/admin
  showOnboarding: () => void; // Show immediately without relaunch
  // Post-onboarding flow (paywall + rating), run AFTER the onboarding Modal
  // unmounts so a nested-modal teardown can't strand a native layer over Home.
  // Flips true the instant onboarding completes; PostOnboardingFlow picks it up.
  pendingPostOnboarding: boolean;
  dismissPostOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const ONBOARDING_COMPLETED_KEY = '@lab_onboarding_completed_v2';

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [forceShow, setForceShow] = useState(false);
  const [pendingPostOnboarding, setPendingPostOnboarding] = useState(false);

  // Load completion status on mount
  useEffect(() => {
    loadOnboardingStatus();
  }, []);

  const loadOnboardingStatus = async () => {
    try {
      const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
      setHasCompletedOnboarding(completed === 'true');
    } catch (error) {
      console.error('[Onboarding] Error loading status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const completeOnboarding = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
      setHasCompletedOnboarding(true);
      setForceShow(false);
      setPendingPostOnboarding(true);
      console.log('[Onboarding] Marked as completed; post-onboarding flow queued');
    } catch (error) {
      console.error('[Onboarding] Error saving status:', error);
    }
  }, []);

  const dismissPostOnboarding = useCallback(() => {
    setPendingPostOnboarding(false);
  }, []);

  const resetOnboarding = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
      setHasCompletedOnboarding(false);
      console.log('[Onboarding] Reset for testing');
    } catch (error) {
      console.error('[Onboarding] Error resetting status:', error);
    }
  }, []);

  const showOnboarding = useCallback(() => {
    setForceShow(true);
  }, []);

  // Show onboarding on first launch, or when admin force-triggers it via Settings.
  const shouldShowOnboarding = forceShow || (!isLoading && !hasCompletedOnboarding);

  return (
    <OnboardingContext.Provider
      value={{
        hasCompletedOnboarding,
        shouldShowOnboarding,
        isLoading,
        completeOnboarding,
        resetOnboarding,
        showOnboarding,
        pendingPostOnboarding,
        dismissPostOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
