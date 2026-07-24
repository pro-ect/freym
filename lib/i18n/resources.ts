/**
 * Static catalog map. Metro inlines these JSON imports at bundle time,
 * so i18n init is fully synchronous (no async load / no untranslated flash).
 *
 * v1 registered locales (LTR). Any device language that resolves to an
 * unregistered locale falls back to English (see fallbackLng in ./index.ts).
 * ar/he are authored but intentionally NOT registered until RTL ships.
 */
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import it from './locales/it.json';
import ptBR from './locales/pt-BR.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';
import nl from './locales/nl.json';
import tr from './locales/tr.json';
import pl from './locales/pl.json';
import uk from './locales/uk.json';
import hi from './locales/hi.json';
import th from './locales/th.json';
import id from './locales/id.json';
import vi from './locales/vi.json';
import sv from './locales/sv.json';

export const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  it: { translation: it },
  'pt-BR': { translation: ptBR },
  ru: { translation: ru },
  ja: { translation: ja },
  ko: { translation: ko },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
  nl: { translation: nl },
  tr: { translation: tr },
  pl: { translation: pl },
  uk: { translation: uk },
  hi: { translation: hi },
  th: { translation: th },
  id: { translation: id },
  vi: { translation: vi },
  sv: { translation: sv },
} as const;

/** Locales that have a registered catalog right now. */
export const AVAILABLE_LOCALES = Object.keys(resources);
