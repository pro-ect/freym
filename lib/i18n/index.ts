import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { resources, AVAILABLE_LOCALES } from './resources';

/**
 * v1 shipped languages (LTR). The device resolver maps any device locale to
 * one of these tags; i18next then loads its catalog if registered in
 * resources.ts, otherwise falls back to English. ar/he are deferred (RTL).
 */
export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'it', 'pt-BR', 'ru', 'ja', 'ko',
  'zh-Hans', 'zh-Hant', 'nl', 'tr', 'pl', 'uk', 'hi', 'th', 'id', 'vi', 'sv',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGES);

/** Native names (autonyms) for the language picker. */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  nl: 'Nederlands',
  tr: 'Türkçe',
  pl: 'Polski',
  uk: 'Українська',
  hi: 'हिन्दी',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt',
  sv: 'Svenska',
};

/** Languages whose script is covered by the bundled Latin font (Manrope). */
const LATIN_LANGUAGES = new Set<string>([
  'en', 'es', 'fr', 'de', 'it', 'pt-BR', 'nl', 'tr', 'pl', 'id', 'vi', 'sv',
]);

/** True when the active language renders correctly in the Latin UI font. */
export function isLatinLanguage(lang: string | undefined | null): boolean {
  if (!lang) return true;
  return LATIN_LANGUAGES.has(lang) || LATIN_LANGUAGES.has(lang.split('-')[0]);
}

/** Map one device locale descriptor to a supported app tag, or null. */
function mapLocale(loc: Localization.Locale): string | null {
  const tag = loc.languageTag; // e.g. "pt-BR", "es-419", "zh-Hant-TW"
  const code = (loc.languageCode || '').toLowerCase(); // e.g. "pt", "zh"
  const region = (loc.regionCode || '').toUpperCase();

  // Exact tag match (e.g. pt-BR)
  if (SUPPORTED.has(tag)) return tag;

  if (code === 'pt') return 'pt-BR';
  if (code === 'es') return 'es';
  if (code === 'zh') {
    // expo-localization's Locale has no scriptCode field; derive script from
    // the BCP-47 tag, falling back to region (TW/HK/MO are Traditional).
    if (/hant/i.test(tag) || ['TW', 'HK', 'MO'].includes(region)) return 'zh-Hant';
    return 'zh-Hans';
  }

  // Bare language code (de-AT -> de, fr-CA -> fr, …)
  if (SUPPORTED.has(code)) return code;
  return null;
}

/** Resolve the best supported language from the device preference list. */
export function resolveDeviceLanguage(): string {
  try {
    for (const loc of Localization.getLocales()) {
      const mapped = mapLocale(loc);
      if (mapped) return mapped;
    }
  } catch {
    // expo-localization unavailable — fall through to default
  }
  return 'en';
}

/**
 * Resolve a language to one that actually has a registered catalog.
 * Unregistered (translation not landed yet) collapses to English.
 */
function toAvailable(lang: string): string {
  if (AVAILABLE_LOCALES.includes(lang)) return lang;
  const base = lang.split('-')[0];
  if (AVAILABLE_LOCALES.includes(base)) return base;
  return 'en';
}

// Synchronous init — all catalogs are statically bundled.
i18n.use(initReactI18next).init({
  resources,
  lng: toAvailable(resolveDeviceLanguage()),
  fallbackLng: 'en',
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
  compatibilityJSON: 'v4',
});

/**
 * Apply a language. Pass a specific tag to override, or null to follow the
 * device locale. Called from SettingsContext on load and on user change.
 */
export function applyLanguage(lang: string | null): void {
  const target = toAvailable(lang ?? resolveDeviceLanguage());
  if (i18n.language !== target) i18n.changeLanguage(target);
}

export default i18n;
