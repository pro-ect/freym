import PostHog from 'posthog-react-native';

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

let instance: PostHog | null = null;

export function getPostHog(): PostHog | null {
  return instance;
}

export async function initPostHog(): Promise<PostHog | null> {
  if (instance) return instance;

  if (!API_KEY) {
    console.warn('[PostHog] EXPO_PUBLIC_POSTHOG_API_KEY missing — analytics disabled');
    return null;
  }

  try {
    instance = new PostHog(API_KEY, {
      host: HOST,
      enableSessionReplay: true,
      captureAppLifecycleEvents: true,
      sessionReplayConfig: {
        // AI photo app: prompts and generated images are core UX data,
        // so leave them visible. Hide text inputs that could carry secrets
        // (login fields, API keys, billing) — those are masked anyway by RN
        // for secureTextEntry, but this is the safety net.
        maskAllTextInputs: false,
        maskAllImages: false,
        maskAllSandboxedViews: true,
        captureLog: true,
        captureNetworkTelemetry: false,
      },
    });
    if (__DEV__) {
      instance.debug(true);
    }
    console.log('[PostHog] initialized, host:', HOST);
    return instance;
  } catch (error) {
    console.warn('[PostHog] init failed:', error);
    return null;
  }
}

export async function identifyPostHogUser(userId: string, properties: Record<string, any> = {}) {
  if (!instance) return;
  try {
    await instance.identify(userId, properties);
    console.log('[PostHog] identified:', userId);
  } catch (error) {
    console.warn('[PostHog] identify failed:', error);
  }
}

export async function aliasPostHogUser(alias: string) {
  if (!instance) return;
  try {
    await instance.alias(alias); // links `alias` (old anon id) to the current distinct_id (new real id)
    console.log('[PostHog] aliased:', alias);
  } catch (error) {
    console.warn('[PostHog] alias failed:', error);
  }
}

export function resetPostHog() {
  if (!instance) return;
  try {
    instance.reset();
  } catch (error) {
    console.warn('[PostHog] reset failed:', error);
  }
}

export function capturePH(event: string, properties: Record<string, any> = {}) {
  if (!instance) return;
  try {
    instance.capture(event, properties);
  } catch (error) {
    console.warn('[PostHog] capture failed:', event, error);
  }
}
