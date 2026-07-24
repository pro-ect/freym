import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LibraryProvider } from "../contexts/LibraryContext";
import { SettingsProvider } from "../contexts/SettingsContext";
import { SoulsProvider } from "../contexts/SoulsContext";
import { RecipesProvider } from "../contexts/RecipesContext";
import { CloudQueueProvider } from "../contexts/CloudQueueContext";
import { BalanceProvider } from "../contexts/BalanceContext";
import { SubscriptionProvider } from "../contexts/SubscriptionContext";
import { ApiKeyModalProvider } from "../contexts/ApiKeyModalContext";
import { AuthModalProvider } from "../contexts/AuthModalContext";
import { OnboardingProvider, useOnboarding } from "../contexts/OnboardingContext";
import { PaywallProvider, usePaywall } from "../contexts/PaywallContext";
import { useSubscription } from "../contexts/SubscriptionContext";
import AsyncStorage from '@react-native-async-storage/async-storage';
import LabOnboardingModal from "./components/LabOnboardingModal";
import PostOnboardingFlow from "./components/PostOnboardingFlow";
import HardPaywallGate from "./components/HardPaywallGate";
import { isCreatorAccess } from "../lib/creatorAccess";
import GlobalAgentFab from "./components/GlobalAgentFab";
import DialogHost from "./components/DialogHost";
import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from "react";
import { View, ActivityIndicator, Text, TextInput, InteractionManager, AppState } from "react-native";
import { useFonts } from "expo-font";
import * as Linking from 'expo-linking';
import { initializeRevenueCat } from "../lib/revenuecat";
import { preloadModelsCache, invalidateModelsCache } from "../lib/cloudModels";
import { ensureAnonymousSession } from "../lib/auth/ensureGuestSession";
import { initFacebookSDK } from "../lib/facebook";
import { initAppsFlyer, logAFLogin } from "../lib/appsflyer";
import { getATTStatus, requestATT } from "../lib/att";
import { initPostHog, getPostHog } from "../lib/posthog";
import { PostHogProvider } from "posthog-react-native";
import i18n, { isLatinLanguage } from "../lib/i18n";

// TODO(freym): create a "freym-studio" project in Sentry and set
// EXPO_PUBLIC_SENTRY_DSN in eas.json / .env. Empty DSN → Sentry stays disabled.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export default Sentry.wrap(function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'Manrope-Regular': require('../assets/fonts/Manrope-Regular.ttf'),
    'Manrope-Medium': require('../assets/fonts/Manrope-Medium.ttf'),
    'Manrope-SemiBold': require('../assets/fonts/Manrope-SemiBold.ttf'),
    'Manrope-Bold': require('../assets/fonts/Manrope-Bold.ttf'),
    'SFRounded-Regular': require('../assets/SF-Pro-Rounded-Regular.otf'),
    'SFRounded-Medium': require('../assets/SF-Pro-Rounded-Medium.otf'),
  });

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const session = await ensureAnonymousSession();

        // ATT prompt is shown later from the onboarding gallery slide.
        // Read current status (may already be granted/denied from prior runs)
        // so SDKs initialize with the right tracking flag.
        const attStatus = await getATTStatus();
        const attGranted = attStatus === 'granted';

        // Initialize tracking SDKs. AppsFlyer's timeToWaitForATTUserAuthorization
        // (10s) gives onboarding slide 1 a window to surface the ATT prompt
        // before install attribution is sent.
        await initAppsFlyer();
        // Configure RevenueCat WITH the Supabase user id from the very first call.
        // ensureAnonymousSession() above guarantees a session (even a guest one)
        // exists by now, so we always have a stable UUID. Passing it as appUserID
        // means RC is identified as the real Supabase user before ANY paywall can
        // be shown — closing the race where the hard-paywall onboarding presented
        // and completed a purchase while RC was still a $RCAnonymousID (which the
        // webhook can't map to a profile and the client identity-gated safety net
        // won't credit → subscription buys that never granted coins). Without an id
        // RC would mint an anonymous id and rely on SubscriptionContext's later
        // logIn(), which the onboarding purchase flow can outrun.
        await initializeRevenueCat(session?.user?.id);
        await initFacebookSDK(attGranted);
        await initPostHog();

        // Session/DAU signal — fire on every app start.
        logAFLogin();

        // TEMP: Force refresh models cache (remove after testing)
        await invalidateModelsCache();

        preloadModelsCache();

        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize:', error);
        setIsReady(true);
      }
    };

    initializeApp();
  }, []);

  // Handle deep links
  useEffect(() => {
    // Only handle deep links after app is ready
    if (!isReady || !fontsLoaded) {
      return;
    }

    const handleDeepLink = (event: { url: string }) => {
      console.log('🔗 Deep link received:', event.url);
      console.log('📊 App state - isReady:', isReady, 'fontsLoaded:', fontsLoaded);

      // Parse URL manually to get the path after the scheme
      // e.g., freym://recipe/123 -> recipe/123 (dev/preview schemes included)
      const match = event.url.match(/^(?:freym|freymdev|freympreview):\/\/(.+)$/);

      if (match && match[1]) {
        const path = match[1];
        console.log('📍 Extracted path:', path);

        // Split path to get route and ID separately for debugging
        const parts = path.split('/');
        console.log('📂 Path parts:', parts);
        console.log('   - Route:', parts[0]);
        console.log('   - ID:', parts[1]);

        // Wait for router to be ready before navigating
        setTimeout(() => {
          try {
            const targetPath = `/${path}`;
            console.log('📱 Attempting navigation to:', targetPath);
            router.replace(targetPath as any);
            console.log('✅ Navigation call completed');
          } catch (error) {
            console.error('❌ Navigation error:', error);
          }
        }, 500);
      } else {
        console.log('⚠️ Could not extract path from URL:', event.url);
      }
    };

    // Handle initial URL (app opened via deep link)
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('🚀 Initial URL:', url);
        handleDeepLink({ url });
      }
    });

    // Handle deep links while app is running
    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, [router, isReady, fontsLoaded]);

  // Set Manrope as default font globally
  useEffect(() => {
    if (fontsLoaded) {
      console.log('✅ Manrope fonts loaded successfully');

      // Override Text rendering to apply default font.
      // Manrope is Latin-only, so for non-Latin languages (CJK, Cyrillic,
      // Hindi, Thai, …) we skip injecting fontFamily and let the OS pick a
      // script-appropriate fallback font (correct shaping, no tofu).
      const originalTextRender = (Text as any).render;
      (Text as any).render = function (props: any, ref: any) {
        const newProps = isLatinLanguage(i18n.language)
          ? { ...props, style: [{ fontFamily: 'Manrope-Regular' }, props.style] }
          : props;
        return originalTextRender.call(this, newProps, ref);
      };

      // Override TextInput rendering to apply default font (same script gate).
      const originalTextInputRender = (TextInput as any).render;
      (TextInput as any).render = function (props: any, ref: any) {
        const newProps = isLatinLanguage(i18n.language)
          ? { ...props, style: [{ fontFamily: 'Manrope-Regular' }, props.style] }
          : props;
        return originalTextInputRender.call(this, newProps, ref);
      };
    }
  }, [fontsLoaded]);

  if (!isReady || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaProvider>
    );
  }

  // Auth is now contextual - modal shown when user tries to perform auth-required actions
  // No blocking screen - users can browse freely

  const posthogClient = getPostHog();

  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <OnboardingProvider>
          <SettingsProvider>
            <BalanceProvider>
              <SubscriptionProvider>
                <AuthModalProvider>
                  <PaywallProvider>
                    <ApiKeyModalProvider>
                      <SoulsProvider>
                        <RecipesProvider>
                        <LibraryProvider>
                          <CloudQueueProvider>
                            <AppContent />
                          </CloudQueueProvider>
                        </LibraryProvider>
                        </RecipesProvider>
                      </SoulsProvider>
                    </ApiKeyModalProvider>
                  </PaywallProvider>
                </AuthModalProvider>
              </SubscriptionProvider>
            </BalanceProvider>
          </SettingsProvider>
        </OnboardingProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  return posthogClient ? (
    <PostHogProvider client={posthogClient} autocapture={{ captureScreens: true, captureTouches: true }}>
      {tree}
    </PostHogProvider>
  ) : tree;
});

const FIRST_LAUNCH_PAYWALL_KEY = '@first_launch_paywall_shown_v1';

// `enabled` is false while onboarding is showing or its post-flow is pending —
// brand-new users get the paywall from PostOnboardingFlow instead (which also
// marks FIRST_LAUNCH_PAYWALL_KEY), so this only fires for already-onboarded
// users on a fresh launch. We must NOT set the key while disabled.
function useFirstLaunchPaywall(enabled: boolean) {
  const { isLoading, subscriptionStatus } = useSubscription();
  const { showPaywall } = usePaywall();

  useEffect(() => {
    if (!enabled || isLoading) return;

    let cancelled = false;
    (async () => {
      const shown = await AsyncStorage.getItem(FIRST_LAUNCH_PAYWALL_KEY);
      if (shown === 'true' || cancelled) return;

      await AsyncStorage.setItem(FIRST_LAUNCH_PAYWALL_KEY, 'true');

      if (subscriptionStatus.isSubscribed) return;
      // Creators (secret-skip or hand-flagged) never see onboarding paywalls.
      if (await isCreatorAccess()) return;

      // Present only once the launch UI is fully idle. A bare setTimeout raced
      // app-launch settling (splash teardown / navigator mount / lingering
      // system permission VC) and presented the native paywall over a
      // still-transitioning view controller — dismissing it left a stale VC
      // and froze the app. runAfterInteractions waits for animations to finish;
      // the AppState check guards against presenting while backgrounded.
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          if (cancelled || AppState.currentState !== 'active') return;
          showPaywall('first_launch');
        }, 800);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, isLoading, subscriptionStatus.isSubscribed, showPaywall]);
}

// Inner component to handle onboarding modal (needs OnboardingProvider context)
function AppContent() {
  const { shouldShowOnboarding, completeOnboarding, pendingPostOnboarding } = useOnboarding();
  useFirstLaunchPaywall(!shouldShowOnboarding && !pendingPostOnboarding);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#000' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="fine-tune" options={{ headerShown: false }} />
        <Stack.Screen name="recipe/[id]" options={{ headerShown: true, headerTransparent: true, headerBackVisible: false, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: '#fff' }} />
        <Stack.Screen name="recipe/edit/[id]" options={{ headerShown: false }} />
      </Stack>
      {/* Shown on first launch (or admin preview). Gated by shouldShowOnboarding in contexts/OnboardingContext.tsx. */}
      {shouldShowOnboarding && (
        <LabOnboardingModal
          visible={shouldShowOnboarding}
          onComplete={completeOnboarding}
        />
      )}
      {/* Paywall + rating prompt, run AFTER the onboarding Modal unmounts. */}
      <PostOnboardingFlow />
      {/* Hard paywall (hard-paywall flow v2) — armed by onboarding, re-shown
          on every launch until purchase; remote-gated safety valves inside. */}
      <HardPaywallGate />
      {/* Floating Photo Agent button — visible over every main tab. */}
      <GlobalAgentFab />
      {/* App-wide alert/confirm/prompt host for lib/utils/webAlert.ts
          (web + Android; iOS uses native Alert). */}
      <DialogHost />
    </View>
  );
}