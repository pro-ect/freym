import { Platform } from 'react-native';
import appsFlyer from 'react-native-appsflyer';

const DEV_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;
const APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_APP_ID;

let initialized = false;

export async function setAppsFlyerUserId(userId: string): Promise<void> {
  try {
    appsFlyer.setCustomerUserId(userId, (res) => {
      console.log('[AppsFlyer] setCustomerUserId result:', res);
    });
  } catch (error) {
    console.warn('[AppsFlyer] setCustomerUserId failed:', error);
  }
}

export async function initAppsFlyer(): Promise<void> {
  if (initialized) return;

  if (!DEV_KEY) {
    console.warn('[AppsFlyer] EXPO_PUBLIC_APPSFLYER_DEV_KEY missing — SDK not initialized');
    return;
  }
  if (Platform.OS === 'ios' && !APP_ID) {
    console.warn('[AppsFlyer] EXPO_PUBLIC_APPSFLYER_APP_ID missing — SDK not initialized on iOS');
    return;
  }

  return new Promise((resolve) => {
    appsFlyer.initSdk(
      {
        devKey: DEV_KEY,
        isDebug: __DEV__,
        appId: APP_ID,
        onInstallConversionDataListener: true,
        onDeepLinkListener: true,
        timeToWaitForATTUserAuthorization: 10,
      },
      (result) => {
        initialized = true;
        console.log('[AppsFlyer] initSdk success:', result);
        resolve();
      },
      (error) => {
        console.warn('[AppsFlyer] initSdk error:', error);
        resolve();
      }
    );
  });
}

export function logAFEvent(eventName: string, eventValues: Record<string, any> = {}): void {
  if (!initialized) {
    console.warn('[AppsFlyer] logAFEvent skipped — SDK not initialized:', eventName);
    return;
  }
  appsFlyer.logEvent(
    eventName,
    eventValues,
    (res) => console.log('[AppsFlyer] logEvent ok:', eventName, res),
    (err) => console.warn('[AppsFlyer] logEvent err:', eventName, err)
  );
}

export function logAFLogin(): void {
  logAFEvent('af_login', {});
}

export function logAFPurchase(params: {
  revenue: number;
  currency: string;
  productId: string;
  orderId?: string;
}): void {
  logAFEvent('af_purchase', {
    af_revenue: params.revenue,
    af_currency: params.currency,
    af_content_id: params.productId,
    ...(params.orderId ? { af_order_id: params.orderId } : {}),
  });
}
