import type { ModelNodeData, RateTable } from "../types";

const COINS_PER_CENT = 5; // 500 coins = $1, same constant as start-prediction-pika

/** Mirror of the server's billable-seconds rule so the displayed price matches
 *  what the run will reserve. Pika 2.5 uses duration_s, the aggregated vendor
 *  models use duration, Pikaframes bills per keyframe transition (shown here
 *  as one transition — the server multiplies by the wired image count). */
function billableSeconds(params: Record<string, unknown>): number {
  for (const key of ["duration_s", "duration"]) {
    const v = Number(params[key]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const transition = Number(params.transition_duration_s);
  if (Number.isFinite(transition) && transition > 0) return transition;
  return 5;
}

function perSecondCents(
  rateTable: RateTable | null | undefined,
  fallback: number | null | undefined,
  params: Record<string, unknown>,
): number {
  if (rateTable?.rates && Object.keys(rateTable.rates).length) {
    const res = String(params.resolution ?? "");
    const audioOff = params.generate_audio === false || params.audio === false;
    const rate = Number(
      (audioOff ? rateTable.audio_off_rates?.[res] : undefined) ?? rateTable.rates[res],
    );
    if (Number.isFinite(rate) && rate > 0) return rate;
    const max = Math.max(...Object.values(rateTable.rates).map(Number).filter(Number.isFinite));
    if (Number.isFinite(max) && max > 0) return max;
  }
  return Number(fallback) || 0;
}

/** Live coin cost for a model node given its current params — resolution,
 *  audio and duration all move the price. Falls back to the static coin_cost
 *  for flat-priced models (Omni, Pikaffects, all image models). */
export function estimateCoins(
  d: Pick<ModelNodeData, "costCoins" | "perSecondCents" | "rateTable" | "params">,
): number | null {
  const custom = (d.params?.custom ?? {}) as Record<string, unknown>;
  const cents = perSecondCents(d.rateTable, d.perSecondCents, custom);
  if (cents > 0) return Math.ceil(cents * billableSeconds(custom) * COINS_PER_CENT);
  return d.costCoins;
}
