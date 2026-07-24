import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

// Persisted in SecureStore so the device keeps ONE stable guest identity.
// iOS: SecureStore is Keychain-backed and survives app reinstall, so the stored
// value outlives a fresh identifierForVendor. Android: SecureStore does not
// survive uninstall, but getAndroidId() is itself reinstall-stable, so we simply
// re-derive the same value on reinstall.
const DEVICE_KEY = 'guest_device_key_v1';

/**
 * Returns a stable device id valid for the `guest-auth` edge function
 * (iOS: identifierForVendor UUID; Android: 64-bit hex from getAndroidId).
 *
 * The id is durable across reinstalls and app-storage wipes, which is what lets
 * a returning device recover its SAME Supabase guest account instead of minting
 * a brand-new one (the behaviour that was cloning subscriptions and stranding
 * user libraries). Returns null if no id can be obtained (e.g. web / SecureStore
 * unavailable) so callers can fall back to anonymous sign-in.
 */
export async function getStableDeviceId(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  // 1. Prefer the previously-persisted id (Keychain survives reinstall on iOS).
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored) return stored;
  } catch {
    // SecureStore unavailable — fall through to derive fresh.
  }

  // 2. Derive a platform-native stable id.
  let id: string | null = null;
  try {
    if (Platform.OS === 'android') {
      id = Application.getAndroidId() || null; // 64-bit hex, reinstall-stable
    } else if (Platform.OS === 'ios') {
      id = await Application.getIosIdForVendorAsync(); // UUID
    }
  } catch {
    id = null;
  }

  if (!id) return null;

  // 3. Persist so future launches (and iOS reinstalls) reuse the same id.
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  } catch {
    // Non-fatal: worst case we re-derive next launch.
  }

  return id;
}
