import AsyncStorage from '@react-native-async-storage/async-storage';
import { showConfirm } from '../utils/webAlert';

const AI_CONSENT_KEY = '@ai_data_consent';
const AI_CONSENT_VERSION = 1;

export const AI_CONSENT_TITLE = 'AI Photo Processing';

// Disclosure shown before any image/prompt is sent off-device. It names the
// exact data shared (selfies/face photos + prompts), the recipient (Fal.ai),
// the sole purpose, and the retention/biometric stance — the things App Review
// 5.1.1(i)/5.1.2(i) require before sharing personal data.
export const AI_CONSENT_MESSAGE =
  'To create your photos, Copy Shot sends the selfies and photos you choose ' +
  '(which may contain your face) together with your text prompts to Fal.ai, our ' +
  'third-party cloud AI provider. They are used solely to generate your images, ' +
  'are deleted after generation, and are never used for facial recognition, ' +
  'identification, advertising, or to train AI models.';

type StoredConsent = {
  agreed?: boolean;
  version?: number;
  timestamp?: string;
};

export async function hasAIConsent(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as StoredConsent;
    return parsed?.agreed === true;
  } catch {
    return false;
  }
}

export async function persistAIConsent(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      AI_CONSENT_KEY,
      JSON.stringify({
        agreed: true,
        version: AI_CONSENT_VERSION,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {}
}

// Presents the AI data-sharing consent dialog (Allow / Not Now). Resolves true
// only if the user taps Allow. Does NOT persist — callers decide when to record
// consent (onboarding records on Allow; ensureAIConsent records below).
// showConfirm works on both platforms (Alert.alert is a no-op on web).
export async function promptAIConsentDialog(): Promise<boolean> {
  return showConfirm(AI_CONSENT_TITLE, AI_CONSENT_MESSAGE, {
    confirmText: 'Allow',
    cancelText: 'Not Now',
  });
}

export async function ensureAIConsent(): Promise<boolean> {
  if (await hasAIConsent()) return true;
  const agreed = await promptAIConsentDialog();
  if (agreed) await persistAIConsent();
  return agreed;
}
