import Purchases, {
  PurchasesConfiguration,
  LOG_LEVEL,
  CustomerInfo,
  PurchasesEntitlementInfo
} from 'react-native-purchases';
import { Platform } from 'react-native';
import { getRevenueCatApiKey } from '../config/appVariant';

// Entitlement identifiers (set these in RevenueCat dashboard)
export const ENTITLEMENTS = {
  SUBSCRIPTION: 'Monthly coins',      // Active monthly subscription entitlement
} as const;

export interface SubscriptionStatus {
  isSubscribed: boolean;
  activeEntitlements: string[];
  expirationDate: Date | null;
  willRenew: boolean;
  productIdentifier: string | null;
  // RC period type: 'NORMAL' | 'INTRO' | 'TRIAL' | 'PREPAID' (uppercase on RN SDK).
  // During TRIAL / INTRO, `expirationDate` is the trial/intro end — the first
  // charge happens then; renewal doesn't start yet.
  periodType: string | null;
  // False when getCustomerInfo() threw, i.e. `isSubscribed: false` means "we don't
  // know", not "no subscription". Callers that REVOKE entitlements off this status
  // must require fetchOk — otherwise a network blip zeroes a paying user's coins.
  fetchOk: boolean;
}

/**
 * Initialize RevenueCat SDK
 * Should be called once when the app starts
 * Uses variant-specific API key from appVariant config
 */
export async function initializeRevenueCat(userId?: string): Promise<void> {
  try {
    const apiKey = getRevenueCatApiKey();
    if (!apiKey) {
      console.warn('[RevenueCat] No API key configured — purchases disabled');
      return;
    }
    const configuration: PurchasesConfiguration = {
      apiKey,
      appUserID: userId,
    };

    await Purchases.configure(configuration);

    if (Platform.OS === 'ios') {
      Purchases.enableAdServicesAttributionTokenCollection();
    }

    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    console.log('RevenueCat SDK initialized successfully');
  } catch (error) {
    console.error('Failed to initialize RevenueCat SDK:', error);
    throw error;
  }
}

/**
 * Set the user ID for RevenueCat
 * Call this when a user logs in
 */
export async function setRevenueCatUserId(userId: string): Promise<void> {
  try {
    await Purchases.logIn(userId);
    console.log('RevenueCat user ID set:', userId);
  } catch (error) {
    console.error('Failed to set RevenueCat user ID:', error);
    throw error;
  }
}

/**
 * Log out the current RevenueCat user
 * Call this when a user signs out
 */
export async function logOutRevenueCat(): Promise<void> {
  try {
    await Purchases.logOut();
    console.log('RevenueCat user logged out');
  } catch (error) {
    console.error('Failed to log out RevenueCat user:', error);
  }
}

/**
 * Get RevenueCat Purchases instance
 */
export function getPurchases(): typeof Purchases {
  return Purchases;
}

/**
 * Get the current RevenueCat app user ID.
 * For guest/anonymous users this is RevenueCat's internal anonymous ID
 * (e.g. `$RCAnonymousID:...`), which is the only stable handle support can
 * use to look the guest up in the RevenueCat dashboard.
 */
export async function getRevenueCatUserId(): Promise<string | null> {
  try {
    return await Purchases.getAppUserID();
  } catch (error) {
    console.error('Failed to get RevenueCat app user ID:', error);
    return null;
  }
}

/**
 * Get current customer info from RevenueCat
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (error) {
    console.error('Failed to get customer info:', error);
    return null;
  }
}

/**
 * Get subscription status for the current user
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const entitlements = customerInfo.entitlements.active;

    const subscriptionEntitlement = entitlements[ENTITLEMENTS.SUBSCRIPTION];

    return {
      isSubscribed: !!subscriptionEntitlement,
      activeEntitlements: Object.keys(entitlements),
      expirationDate: subscriptionEntitlement?.expirationDate
        ? new Date(subscriptionEntitlement.expirationDate)
        : null,
      willRenew: subscriptionEntitlement?.willRenew ?? false,
      productIdentifier: subscriptionEntitlement?.productIdentifier ?? null,
      periodType: subscriptionEntitlement?.periodType ?? null,
      fetchOk: true,
    };
  } catch (error) {
    console.error('Failed to get subscription status:', error);
    return {
      isSubscribed: false,
      activeEntitlements: [],
      expirationDate: null,
      willRenew: false,
      productIdentifier: null,
      periodType: null,
      fetchOk: false,
    };
  }
}

/**
 * Check if user has an active subscription
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const status = await getSubscriptionStatus();
  return status.isSubscribed;
}

/**
 * Restore purchases - useful if user reinstalls or switches devices
 */
export async function restorePurchases(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const hasActiveEntitlements = Object.keys(customerInfo.entitlements.active).length > 0;
    console.log('Purchases restored:', hasActiveEntitlements ? 'Found active purchases' : 'No active purchases');
    return hasActiveEntitlements;
  } catch (error) {
    console.error('Failed to restore purchases:', error);
    return false;
  }
}

/**
 * Add listener for customer info updates
 * Returns unsubscribe function
 */
export function addCustomerInfoUpdateListener(
  callback: (customerInfo: CustomerInfo) => void
): () => void {
  const listener = Purchases.addCustomerInfoUpdateListener(callback);
  return () => {
    // Guard against undefined listener (RevenueCat not initialized)
    if (listener && typeof listener.remove === 'function') {
      listener.remove();
    }
  };
}
