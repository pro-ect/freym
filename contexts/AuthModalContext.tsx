/**
 * AuthModalContext - Manages contextual authentication & API key setup
 *
 * Shows auth modal when user tries to perform actions that need a real identity.
 * Anonymous users have valid sessions (can generate), but need Apple sign-in
 * for profile, settings, etc.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { ensureAnonymousSession } from '../lib/auth/ensureGuestSession';
import AuthModal from '../app/components/AuthModal';


interface AuthModalContextValue {
  /**
   * Whether the user has any session (anonymous or real).
   * Use this for actions that just need a valid JWT (e.g., generation).
   */
  hasSession: boolean;

  /**
   * Whether the user is authenticated with a real identity (Apple sign-in).
   * False for anonymous users.
   */
  isAuthenticated: boolean;

  /**
   * Whether the current user is anonymous (has session but no real identity).
   */
  isAnonymous: boolean;

  /**
   * Whether the user has completed all required setup (real auth + API key for BYOK)
   */
  isFullySetUp: boolean;

  /**
   * Check if user has a real (non-anonymous) identity.
   * Shows auth modal if user is anonymous or not signed in.
   * Returns true if ready, false if modal was shown.
   */
  requireAuth: () => boolean;

  /**
   * Ensure a session exists for generation/edit/purchase. An anonymous session
   * is enough (Apple 5.1.1(v) — never force registration to generate). Always
   * returns true; self-heals a missing session without blocking the UI.
   */
  requireSession: () => boolean;

  /**
   * Show the auth modal programmatically
   */
  showAuthModal: () => void;

  /**
   * Hide the auth modal
   */
  hideAuthModal: () => void;

  /**
   * Whether the modal is currently visible
   */
  isModalVisible: boolean;

  /**
   * Current user ID (null if no session at all)
   */
  userId: string | null;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Real auth = has session AND not anonymous
  const isAuthenticated = hasSession && !isAnonymous;

  // Check if fully set up (real auth)
  const isFullySetUp = isAuthenticated;

  const updateAuthState = (session: any) => {
    const exists = !!session;
    const isAnon = session?.user?.is_anonymous ?? false;
    const email = session?.user?.email || '';
    const kind = session?.user?.user_metadata?.kind || '';
    // Old guest-auth users have is_anonymous=false but are still guests
    const isGuest = email.endsWith('@guest.local') || kind === 'guest';
    const notRealUser = isAnon || isGuest;
    console.log('[AuthModal] updateAuthState:', {
      exists,
      isAnon,
      email,
      kind,
      isGuest,
      notRealUser,
      uid: session?.user?.id || null,
      providers: session?.user?.app_metadata?.providers,
    });
    setHasSession(exists);
    setIsAnonymous(notRealUser);
    setUserId(session?.user?.id || null);
    return { exists, anon: notRealUser, uid: session?.user?.id || null };
  };

  // Check initial auth state and listen for changes
  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const { uid } = updateAuthState(session);
      if (uid) {
        checkApiKeyStatus(uid);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthModal] Auth state changed:', event, 'anonymous:', session?.user?.is_anonymous);
      const { uid } = updateAuthState(session);
      if (uid) {
        checkApiKeyStatus(uid);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Check if user has API key (Fal API key for BYOK variant)
  const checkApiKeyStatus = async (uid: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('fal_api_key_encrypted')
        .eq('id', uid)
        .single();
      const hasFalKey = !!data?.fal_api_key_encrypted;
      console.log('[AuthModal] Fal API key status:', hasFalKey);
      setHasApiKey(hasFalKey);
    } catch (error) {
      console.error('[AuthModal] Error checking API key status:', error);
      setHasApiKey(false);
    }
  };

  const showAuthModal = useCallback(() => {
    // Android has no sign-in (Apple is iOS-only); it relies on the stable device
    // guest identity, so never surface the auth modal there.
    if (Platform.OS === 'android') {
      if (!hasSession) { ensureAnonymousSession().catch(() => {}); }
      return;
    }
    setIsModalVisible(true);
  }, [hasSession]);

  const hideAuthModal = useCallback(() => {
    setIsModalVisible(false);
    if (userId) {
      checkApiKeyStatus(userId);
    }
  }, [userId]);

  // Called after successful Apple sign-in.
  // Don't auto-show paywall here — the user may be signing in mid-purchase
  // (from the paywall's auth gate). The paywall is already visible in that case.
  const handleAuthenticated = useCallback(async () => {
    setIsModalVisible(false);
    // Get fresh session to check the newly authenticated user
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      checkApiKeyStatus(uid);
    }
  }, []);

  /**
   * Check if user has a real (non-anonymous) identity.
   * Returns true if ready, false if modal was shown.
   */
  const requireAuth = useCallback(() => {
    console.log('[AuthModal] requireAuth called:', {
      hasSession,
      isAnonymous,
      isAuthenticated,
      userId,
    });
    // Require real identity (Apple sign-in) — anonymous/guest users must sign in first.
    // This gates generation and other paid features behind real auth.
    if (isAuthenticated) {
      console.log('[AuthModal] requireAuth → PASS (user is authenticated)');
      return true;
    }

    // Android has no sign-in path; the guest session is sufficient, so pass
    // through instead of dead-ending on a modal that never appears.
    if (Platform.OS === 'android') {
      if (!hasSession) { ensureAnonymousSession().catch(() => {}); }
      return true;
    }

    console.log('[AuthModal] requireAuth → BLOCKED (showing auth modal)');
    showAuthModal();
    return false;
  }, [isAuthenticated, showAuthModal, hasSession, isAnonymous, userId]);

  const requireSession = useCallback(() => {
    // Anonymous session is enough for generation / edit / purchase. It's created
    // at app boot; self-heal in the rare pre-boot window without blocking the UI.
    if (!hasSession) { ensureAnonymousSession().catch(() => {}); }
    return true;
  }, [hasSession]);

  return (
    <AuthModalContext.Provider
      value={{
        hasSession,
        isAuthenticated,
        isAnonymous,
        isFullySetUp,
        requireAuth,
        requireSession,
        showAuthModal,
        hideAuthModal,
        isModalVisible,
        userId,
      }}
    >
      {children}
      <AuthModal
        visible={isModalVisible}
        onClose={hideAuthModal}
        onAuthenticated={handleAuthenticated}
      />
    </AuthModalContext.Provider>
  );
}

/**
 * Hook to access auth modal functions
 */
export function useAuth() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthModalProvider');
  }
  return context;
}
