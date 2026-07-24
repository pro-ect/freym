import i18n from './index';

/** Locale-aware date/number formatting keyed to the active app language.
 *  Hermes ships full Intl on RN 0.83, so no polyfill is needed. */

export function formatDate(
  date: Date | number | string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat(i18n.language, options).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(i18n.language, options).format(value);
  } catch {
    return value.toLocaleString();
  }
}

export function formatCurrency(value: number, currency: string): string {
  return formatNumber(value, { style: 'currency', currency });
}
