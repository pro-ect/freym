/**
 * Safe image sizing helpers.
 *
 * Aspect-ratio-driven image heights (masonry tiles, before/after cards, etc.)
 * are computed from source/DB dimensions and fed straight into native view
 * styles. If any input is missing, zero, non-finite, or arrives as a string,
 * the result can become NaN/Infinity — and iOS CoreAnimation throws an
 * uncatchable `CALayerInvalidGeometry: CALayer position contains NaN` the moment
 * such a value reaches a CALayer. These helpers guarantee finite, positive,
 * rounded dimensions so that can never happen.
 */

/** height/width ratio, guaranteed finite and positive (else `fallback`). */
export function safeAspectRatio(
  width?: number | string | null,
  height?: number | string | null,
  fallback = 1.4,
): number {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return fallback;
  const r = h / w;
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

/** Rounded, clamped, always-finite tile height for a given column width. */
export function safeTileHeight(
  columnWidth: number,
  ratio: number,
  min = 80,
  max = 1200,
): number {
  const w = Number.isFinite(columnWidth) && columnWidth > 0 ? columnWidth : 0;
  const raw = w * ratio;
  if (!Number.isFinite(raw)) return Math.round(min);
  return Math.round(Math.min(Math.max(raw, min), max));
}
