/**
 * useClipboardInspireWatcher
 *
 * On initial mount AND on app foreground, if the clipboard has any http(s)
 * link or an image, read it (which triggers the iOS native "Allow Paste"
 * system dialog) and route directly to the Inspire tab with the payload
 * pre-filled. No JS-side warning either before or after the system prompt.
 *
 * Re-paste protection: a `Clipboard.addClipboardListener` subscription flips
 * `clipboardChangedRef` whenever the clipboard content actually changes.
 * The foreground check bails out when the clipboard is unchanged since the
 * last handled paste, so coming back to the app doesn't re-prompt or
 * re-route for the same URL. Only a NEW link triggers another paste.
 *
 * Gated by `visibleTabs.inspire` so non-admin users (where Inspire is
 * hidden) aren't pulled into the flow. Per-content dedupe via
 * `lastHandledRef`.
 */

import { useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, usePathname } from 'expo-router';
import { useSettings } from '../../contexts/SettingsContext';
import { imagineHasRefPhoto } from '../../lib/inspire/refPhotoFlag';

// The clipboard auto-paste may ONLY pull the user into the Imagine/Copy Shot
// tab when they're sitting on a tab root. If they're deep in a focused stack
// screen (e.g. the recipe/effects screen at /recipe/[id]), foregrounding the
// app after the photo picker must not yank them away mid-flow.
const TAB_ROOTS = new Set([
  '/inspire', '/imagine', '/tools', '/editor', '/library',
  '/home', '/create', '/recipes', '/video',
]);

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function useClipboardInspireWatcher() {
  const { visibleTabs } = useSettings();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const lastHandledRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  // Starts true so the initial mount check still runs. Flipped to false after
  // a successful handle; flipped back to true by the clipboard listener when
  // the user copies something new.
  const clipboardChangedRef = useRef(true);

  useEffect(() => {
    if (!visibleTabs.inspire) return;

    const checkClipboard = async ({ force }: { force?: boolean } = {}) => {
      if (inFlightRef.current) return;
      // On foreground re-checks, bail out if the clipboard hasn't changed
      // since we last handled it. The initial mount call passes force=true
      // so the very first check always runs.
      if (!force && !clipboardChangedRef.current) return;
      // Don't hijack navigation (or fire the iOS Allow-Paste prompt) while the
      // user is inside a focused stack screen like the recipe/effects flow.
      // Returning without consuming the dirty flag lets it run later once
      // they're back on a tab root.
      const current = pathnameRef.current;
      if (current && !TAB_ROOTS.has(current)) return;
      // A reference photo is already attached on the Imagine tab — never
      // clobber it with clipboard content (and don't fire the iOS Allow-Paste
      // prompt for a payload we'd ignore). Return WITHOUT consuming the dirty
      // flag: once the user removes the photo, a later foreground check can
      // still pick the link/image up, and manual paste into the URL field
      // always works.
      if (imagineHasRefPhoto.current) return;
      inFlightRef.current = true;
      try {
        // Quiet peek — these don't trigger the iOS Allow-Paste dialog on
        // iOS 14+; they just tell us whether there's a URL/image present.
        const hasUrl = await Clipboard.hasUrlAsync().catch(() => false);
        if (hasUrl) {
          // Triggers iOS native "Allow Paste". If denied, returns null /
          // throws — we silently drop. If allowed but the URL isn't
          // Pinterest, also silently drop (no JS warnings).
          const url = await Clipboard.getUrlAsync().catch(() => null);
          if (!url) return;
          if (lastHandledRef.current === url) {
            clipboardChangedRef.current = false;
            return;
          }
          if (!isHttpUrl(url)) {
            // Mark as seen so we don't re-prompt for a non-http URL
            // every foreground until the clipboard actually changes.
            clipboardChangedRef.current = false;
            return;
          }
          lastHandledRef.current = url;
          clipboardChangedRef.current = false;
          // navigate (not push) avoids stacking a duplicate /(tabs)/inspire on
          // top of an already-mounted tab navigator — `push` during native
          // tab init can trip RNScreens's "Expected exactly 1 focused tab,
          // got: 0" invariant on iOS.
          router.navigate({
            pathname: '/(tabs)/imagine',
            params: { pinterestUrl: url, nonce: String(Date.now()) },
          });
          return;
        }

        const hasImage = await Clipboard.hasImageAsync().catch(() => false);
        if (hasImage) {
          // Triggers iOS native "Allow Paste".
          const image = await Clipboard.getImageAsync({ format: 'jpeg' }).catch(() => null);
          if (!image?.data) {
            clipboardChangedRef.current = false;
            return;
          }
          const fingerprint = `img:${image.data.length}`;
          if (lastHandledRef.current === fingerprint) {
            clipboardChangedRef.current = false;
            return;
          }
          lastHandledRef.current = fingerprint;
          clipboardChangedRef.current = false;
          router.navigate({
            pathname: '/(tabs)/imagine',
            params: { clipboardImage: image.data, nonce: String(Date.now()) },
          });
          return;
        }

        // Nothing pasteable now — clear the dirty flag so we don't keep
        // re-checking every foreground.
        clipboardChangedRef.current = false;
      } catch (err) {
        console.warn('[ClipboardWatcher] check failed:', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    // Listen for clipboard changes. iOS fires this when the user copies
    // something new in another app while we're backgrounded (or here in
    // foreground). We use it purely as a dirty flag — the actual read still
    // happens on initial mount + AppState 'active'.
    const clipboardSub = Clipboard.addClipboardListener(() => {
      clipboardChangedRef.current = true;
    });

    // Initial check — defer past the first paint so the native tab
    // navigator finishes registering its triggers before we route into it.
    // Without this, the very first router.navigate races NativeTabs init and
    // RNScreens throws "Expected exactly 1 focused tab, got: 0".
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      checkClipboard({ force: true });
    });

    // Re-check when the app comes back to the foreground, but only if the
    // clipboard actually changed since we last handled it.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') checkClipboard();
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      sub.remove();
      clipboardSub.remove();
      interactionHandle.cancel();
    };
  }, [visibleTabs.inspire]);
}
