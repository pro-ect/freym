import { supabase } from '../supabase';
import type { Session } from '@supabase/supabase-js';
import { getStableDeviceId } from './deviceId';

/**
 * Ensure a Supabase session exists.
 * If the user already has a session (guest or Apple), returns it.
 * If no session, first tries to recover this DEVICE's stable guest account
 * (so reinstalls / sign-outs return to the SAME account instead of minting a
 * new one — the behaviour that was cloning subscriptions and stranding
 * libraries). Falls back to signInAnonymously() if device recovery is
 * unavailable.
 */
export async function ensureAnonymousSession(): Promise<Session | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      const label = session.user?.is_anonymous ? 'anonymous' : (session.user?.email || session.user?.id);
      console.log('[Auth] Existing session:', label);

      // Legacy anonymous accounts (created by signInAnonymously before device-guest
      // recovery existed) have no email and no device link, so guest-auth could never
      // find them again — a later sign-out or reinstall would orphan the account along
      // with its coins and library. Bind it to this device NOW, while we still hold a
      // live session for it, so guest-auth can adopt it instead of minting a new one.
      if (session.user?.is_anonymous) {
        void linkDeviceToAnonymousAccount();
      }

      return session;
    }

    // No session — recover this device's stable guest account first.
    const recovered = await recoverDeviceGuestSession();
    if (recovered) return recovered;

    // Fallback: fresh anonymous account (previous behaviour). Used when device
    // recovery is unavailable (web, SecureStore/device-id missing, or the
    // guest-auth function is unreachable).
    console.log('[Auth] Device recovery unavailable, creating anonymous session...');
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error) {
      console.error('[Auth] Anonymous sign-in failed:', error.message);
      return null;
    }

    console.log('[Auth] Anonymous session created:', data.session?.user?.id);
    return data.session;
  } catch (error) {
    console.error('[Auth] Error ensuring session:', error);
    return null;
  }
}

/**
 * Bind this device to the CURRENT anonymous account so `guest-auth` can adopt it
 * later (see migration 0044). Fire-and-forget and fully best-effort: a failure just
 * leaves the account unlinked, exactly as it is today — never block app start over
 * it. The server derives the user from the JWT and refuses anything that is not
 * anonymous, so this can never bind a real account to a device.
 */
async function linkDeviceToAnonymousAccount(): Promise<void> {
  try {
    const deviceId = await getStableDeviceId();
    if (!deviceId) return;

    const { data, error } = await supabase.functions.invoke('link-device-guest', {
      body: { deviceId },
    });
    if (error) {
      console.warn('[Auth] link-device-guest failed:', error.message);
      return;
    }
    if (data?.linked) {
      console.log('[Auth] Anonymous account linked to device for future recovery');
    }
  } catch (error) {
    console.warn('[Auth] link-device-guest error:', error);
  }
}

/**
 * Resolve this device's stable guest id and exchange it (via the `guest-auth`
 * edge function) for the deterministic `<deviceId>@guest.local` account, then
 * install that session. Returns null on any failure so the caller can fall
 * back to anonymous sign-in.
 */
async function recoverDeviceGuestSession(): Promise<Session | null> {
  try {
    const deviceId = await getStableDeviceId();
    if (!deviceId) return null;

    console.log('[Auth] No session — recovering device guest account...');
    const { data, error } = await supabase.functions.invoke('guest-auth', {
      body: { deviceId },
    });

    if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
      console.warn('[Auth] guest-auth recovery failed:', error?.message ?? 'no session in response');
      return null;
    }

    const { error: setErr, data: setData } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (setErr || !setData.session) {
      console.warn('[Auth] setSession after guest-auth failed:', setErr?.message);
      return null;
    }

    console.log('[Auth] Recovered device guest session:', setData.session.user?.id);
    return setData.session;
  } catch (error) {
    console.warn('[Auth] device guest recovery error:', error);
    return null;
  }
}
