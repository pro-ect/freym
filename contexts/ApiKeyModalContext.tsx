/**
 * ApiKeyModalContext - Legacy API key setup modal
 *
 * NOTE: For BYOK variant, the unified AuthModal now handles API key setup
 * as part of the 2-step onboarding flow. This context is kept for:
 * - Manual API key modal access via showApiKeyModal()
 * - Settings screen API key management
 *
 * checkCanGenerate() always returns true now since AuthModalContext
 * handles the BYOK API key check in its requireAuth() function.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import ApiKeySetupModal from '../app/components/ApiKeySetupScreen';

interface ApiKeyModalContextValue {
  /**
   * Legacy check - always returns true now.
   * BYOK API key check is handled by AuthModalContext.requireAuth()
   */
  checkCanGenerate: () => boolean;

  /**
   * Show the API key modal programmatically (for settings, etc.)
   */
  showApiKeyModal: () => void;

  /**
   * Hide the API key modal
   */
  hideApiKeyModal: () => void;

  /**
   * Whether the modal is currently visible
   */
  isModalVisible: boolean;
}

const ApiKeyModalContext = createContext<ApiKeyModalContextValue | null>(null);

export function ApiKeyModalProvider({ children }: { children: React.ReactNode }) {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const { hasCustomApiKey } = useSettings();

  const showApiKeyModal = useCallback(() => {
    setIsModalVisible(true);
  }, []);

  const hideApiKeyModal = useCallback(() => {
    setIsModalVisible(false);
  }, []);

  /**
   * Legacy check - always returns true.
   * BYOK API key requirement is now handled by AuthModalContext.requireAuth()
   * which shows the unified 2-step onboarding modal.
   */
  const checkCanGenerate = useCallback(() => {
    // Always return true - AuthModalContext handles BYOK API key check
    return true;
  }, []);

  return (
    <ApiKeyModalContext.Provider
      value={{
        checkCanGenerate,
        showApiKeyModal,
        hideApiKeyModal,
        isModalVisible,
      }}
    >
      {children}
      <ApiKeySetupModal
        visible={isModalVisible}
        onClose={hideApiKeyModal}
        onSuccess={hideApiKeyModal}
      />
    </ApiKeyModalContext.Provider>
  );
}

/**
 * Hook to access API key modal functions
 */
export function useApiKeyModal() {
  const context = useContext(ApiKeyModalContext);
  if (!context) {
    throw new Error('useApiKeyModal must be used within an ApiKeyModalProvider');
  }
  return context;
}
