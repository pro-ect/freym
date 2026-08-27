import { supabase, SUPABASE_URL } from "./supabase";

/** Spendable coins = permanent balance + current subscription allowance. */
export async function fetchBalance(): Promise<number | null> {
  const { data } = await supabase
    .from("profiles")
    .select("coin_balance, subscription_coins")
    .maybeSingle();
  if (!data) return null;
  return (data.coin_balance ?? 0) + (data.subscription_coins ?? 0);
}

export type CoinPack = "1000" | "3000" | "5000";

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
