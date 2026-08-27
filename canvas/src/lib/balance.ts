import { supabase, SUPABASE_URL } from "./supabase";

/**
 * The wallet is denominated in coins at a fixed 500 coins = $1; the canvas
 * presents everything in dollars. Cheap generations keep a third decimal
 * ($0.034), larger amounts read like money ($1.15, $152.60).
 */
export function usd(coins: number): string {
  const dollars = coins / 500;
  const decimals = dollars > 0 && dollars < 0.1 ? 3 : 2;
  return "$" + dollars.toFixed(decimals);
}

/** Spendable coins = permanent balance + current subscription allowance. */
export async function fetchBalance(): Promise<number | null> {
  const { data } = await supabase
    .from("profiles")
    .select("coin_balance, subscription_coins")
    .maybeSingle();
  if (!data) return null;
  return (data.coin_balance ?? 0) + (data.subscription_coins ?? 0);
}

export type CoinPack = "freym-2500" | "freym-7500" | "freym-15000";

/**
 * One-time coin pack via the shared stripe-checkout-session function.
 * Redirects to Stripe; the stripe-webhook credits the coins and Stripe sends
 * the user back to /canvas/?checkout=coins_success.
 */
export async function startCoinCheckout(pack: CoinPack): Promise<{ error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { error: "not signed in" };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ pack, origin: `${window.location.origin}/canvas` }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.url) {
    window.location.assign(json.url);
    return {};
  }
  return { error: json.error ?? `checkout failed (${res.status})` };
}
