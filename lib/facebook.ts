// Facebook SDK is not wired in freym (no FB app yet). These stubs keep the
// call sites compiling; swap back to react-native-fbsdk-next if FB ads return.

export async function setFBAdvertiserTracking(_enabled: boolean) {}

export async function initFacebookSDK(_attGranted: boolean) {}

export function logFBEvent(
  _eventName: string,
  _valueToSum?: number,
  _parameters?: Record<string, string | number>,
) {}
