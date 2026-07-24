import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAppConfigJson } from '../remoteConfig';

// Hard Paywall Flow v2 — remote config for the onboarding funnel
// (choose photo → selfie → free generation → hard paywall).
// Source of truth: Supabase app_config key `hard_paywall_flow_v2`.
// Any fetch/parse failure degrades to DEFAULT_CONFIG (flow disabled → legacy
// onboarding), so a backend outage can never lock users behind the paywall.
// Last-known-good config is cached in AsyncStorage so the relaunch re-show
// check works offline.

export type HardPaywallFlowConfig = {
  enabled: boolean;
  steps: {
    choosePhoto: boolean;
    selfie: boolean;
    generation: boolean;
  };
  generation: {
    modelId: string | null;
    promptOverride: string | null;
    imageSize: string;
    quality: string;
    timeoutSeconds: number;
    maxAttempts: number;
    /** Displayed ETA (the "Ns / ~Xs" counter on the waiting screen). null =
     *  derive from quality (medium → 60s, low → 45s, else 180s). The real
     *  safety cap is `timeoutSeconds`; this only drives the progress readout. */
    etaSeconds: number | null;
    /** When true, the free-generation waiting screen shows a "Skip" button.
     *  Skipping bails out WITHOUT arming the hard paywall (the user saw no
     *  result), so they land on the soft post-onboarding paywall instead. */
    allowSkip: boolean;
  };
  paywall: {
    /** Master switch for the end-of-flow paywall. false = the flow runs
     *  (photo → selfie → free generation → result) but no paywall is armed
     *  or shown — for testing the funnel in isolation. */
    enabled: boolean;
    dismissable: boolean;
    closeButtonDelaySeconds: number;
    reshowOnRelaunch: boolean;
    /** RevenueCat offering lookup_key to render on the hard paywall (e.g. a
     *  close-button-less duplicate of the main paywall). null = current
     *  offering, same as the regular paywall. */
    offeringLookupKey: string | null;
    /** When true, users who already have a positive coin balance are NOT
     *  hard-locked (coin-pack buyers, hand-granted creators, returning
     *  users). Brand-new users have 0 coins, so they still get it. */
    skipIfHasCoins: boolean;
  };
  /** ISO-3166-1 alpha-2 allowlist; null = all countries. */
  countries: string[] | null;
  /** ISO-3166-1 alpha-2 blocklist — these countries always get the legacy
   *  onboarding, even when `countries` is null. */
  excludedCountries: string[] | null;
};

export const HARD_PAYWALL_FLOW_CONFIG_KEY = 'hard_paywall_flow_v2';
const CACHE_KEY = '@hard_paywall_flow_v2_cache';

// Set by onboarding right before finishOnboarding() when the flow delivered a
// generated result; read by HardPaywallGate on every launch; cleared on
// purchase/restore or when the remote config disables the flow.
export const HARD_PAYWALL_PENDING_KEY = '@hard_paywall_pending_v1';

// Hidden tester mode: set by the 7-tap on the Aya logo (Inspire tab) together
// with force-showing onboarding. Makes HardPaywallGate show even for active
// subscribers, with a forced close button and no relaunch re-arm.
export const HARD_PAYWALL_PREVIEW_KEY = '@hpf_paywall_preview';

// Admin-only local override (Settings → Admin: Hard Paywall Onboarding). When
// set, getHardPaywallFlowConfig() force-enables the whole flow on THIS device
// regardless of the remote `enabled` switch, so the flow can be iterated on in
// the dev build while it stays off for real users. Never written by non-admins.
export const HARD_PAYWALL_ADMIN_OVERRIDE_KEY = '@hpf_admin_override';

export const getHardPaywallAdminOverride = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(HARD_PAYWALL_ADMIN_OVERRIDE_KEY)) === 'true';
  } catch {
    return false;
  }
};

export const setHardPaywallAdminOverride = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(HARD_PAYWALL_ADMIN_OVERRIDE_KEY, enabled ? 'true' : 'false');
  } catch {
    // best-effort; a failed write just leaves the override off
  }
};

/**
 * Force-enable the full flow on a resolved config (admin override only).
 * Force-runs the flow steps (choose photo → selfie → generation) and clears
 * country gating + the has-coins skip so a subscribed/coin-holding admin device
 * still runs the whole thing. The end paywall is NOT forced: it follows the
 * remote `paywall.enabled` knob, so the admin can test the flow with the hard
 * paywall on OR off just by flipping that config value.
 */
function applyAdminOverride(config: HardPaywallFlowConfig): HardPaywallFlowConfig {
  return {
    ...config,
    enabled: true,
    steps: { choosePhoto: true, selfie: true, generation: true },
    countries: null,
    excludedCountries: null,
    paywall: { ...config.paywall, skipIfHasCoins: false },
  };
}

export const DEFAULT_HARD_PAYWALL_FLOW_CONFIG: HardPaywallFlowConfig = {
  enabled: false,
  steps: { choosePhoto: true, selfie: true, generation: true },
  generation: {
    modelId: null,
    promptOverride: null,
    imageSize: '768x1024',
    quality: 'high',
    timeoutSeconds: 240,
    maxAttempts: 2,
    etaSeconds: null,
    allowSkip: false,
  },
  paywall: {
    enabled: true,
    dismissable: false,
    closeButtonDelaySeconds: 0,
    reshowOnRelaunch: true,
    offeringLookupKey: null,
    skipIfHasCoins: true,
  },
  countries: null,
  excludedCountries: null,
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return fallback;
}

function asPositiveInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function asNonNegativeInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Normalize arbitrary JSON into a full config; garbage → safe defaults. */
export function parseHardPaywallFlowConfig(raw: unknown): HardPaywallFlowConfig {
  const d = DEFAULT_HARD_PAYWALL_FLOW_CONFIG;
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const steps = r.steps && typeof r.steps === 'object' ? r.steps : {};
  const gen = r.generation && typeof r.generation === 'object' ? r.generation : {};
  const pw = r.paywall && typeof r.paywall === 'object' ? r.paywall : {};
  const countries = Array.isArray(r.countries)
    ? r.countries.filter((c: unknown) => typeof c === 'string').map((c: string) => c.toUpperCase())
    : null;
  const excludedCountries = Array.isArray(r.excluded_countries)
    ? r.excluded_countries
        .filter((c: unknown) => typeof c === 'string')
        .map((c: string) => c.toUpperCase())
    : null;
  return {
    enabled: asBool(r.enabled, d.enabled),
    steps: {
      choosePhoto: asBool(steps.choose_photo, d.steps.choosePhoto),
      selfie: asBool(steps.selfie, d.steps.selfie),
      generation: asBool(steps.generation, d.steps.generation),
    },
    generation: {
      modelId: asStringOrNull(gen.model_id),
      promptOverride: asStringOrNull(gen.prompt_override),
      imageSize: asStringOrNull(gen.image_size) ?? d.generation.imageSize,
      quality: asStringOrNull(gen.quality) ?? d.generation.quality,
      timeoutSeconds: asPositiveInt(gen.timeout_seconds, d.generation.timeoutSeconds),
      maxAttempts: asPositiveInt(gen.max_attempts, d.generation.maxAttempts),
      etaSeconds:
        gen.eta_seconds == null ? null : asPositiveInt(gen.eta_seconds, 180),
      allowSkip: asBool(gen.allow_skip, d.generation.allowSkip),
    },
    paywall: {
      enabled: asBool(pw.enabled, d.paywall.enabled),
      dismissable: asBool(pw.dismissable, d.paywall.dismissable),
      closeButtonDelaySeconds: asNonNegativeInt(
        pw.close_button_delay_seconds,
        d.paywall.closeButtonDelaySeconds
      ),
      reshowOnRelaunch: asBool(pw.reshow_on_relaunch, d.paywall.reshowOnRelaunch),
      offeringLookupKey: asStringOrNull(pw.offering_lookup_key),
      skipIfHasCoins: asBool(pw.skip_if_has_coins, d.paywall.skipIfHasCoins),
    },
    countries: countries && countries.length > 0 ? countries : null,
    excludedCountries:
      excludedCountries && excludedCountries.length > 0 ? excludedCountries : null,
  };
}

/**
 * Fetch the flow config. Order: network → AsyncStorage last-known-good →
 * hardcoded defaults (disabled). A successful network read refreshes the
 * offline cache.
 */
export async function getHardPaywallFlowConfig(): Promise<HardPaywallFlowConfig> {
  // Admin-only local force-on (dev-build iteration). Read once; applied to the
  // resolved config below — never to the `raw` value cached at the network tier,
  // so the offline last-known-good cache stays clean.
  const adminOverride = await getHardPaywallAdminOverride();
  const resolve = (config: HardPaywallFlowConfig): HardPaywallFlowConfig =>
    adminOverride ? applyAdminOverride(config) : config;

  try {
    const raw = await getAppConfigJson(HARD_PAYWALL_FLOW_CONFIG_KEY);
    if (raw !== undefined) {
      const config = parseHardPaywallFlowConfig(raw);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(raw)).catch(() => {});
      return resolve(config);
    }
  } catch {
    // fall through to cache
  }
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) return resolve(parseHardPaywallFlowConfig(JSON.parse(cached)));
  } catch {
    // fall through to defaults
  }
  return resolve(DEFAULT_HARD_PAYWALL_FLOW_CONFIG);
}
