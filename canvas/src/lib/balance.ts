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

export type CoinTxn = {
  id: string;
  amount: number; // signed coins: deduct negative, purchase/bonus positive
  transaction_type: string;
  description: string | null;
  created_at: string;
};

/**
 * Wallet history for the top-up modal: the last few settled money movements
 * (holds and hold-releases are noise, so only deduct/purchase/bonus/adjust)
 * plus total spend over the last 30 days.
 */
export async function fetchHistory(): Promise<{ recent: CoinTxn[]; spent30d: number }> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [recentRes, spendRes] = await Promise.all([
    supabase
      .from("coin_transactions")
      .select("id, amount, transaction_type, description, created_at")
      .in("transaction_type", ["deduct", "purchase", "bonus", "admin_adjust"])
      .eq("transaction_status", "completed")
      .neq("amount", 0)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("coin_transactions")
      .select("amount")
      .eq("transaction_type", "deduct")
      .eq("transaction_status", "completed")
      .gte("created_at", since)
      .limit(1000),
  ]);
  const spent30d = (spendRes.data ?? []).reduce((s, r) => s + Math.abs(r.amount ?? 0), 0);
  return { recent: (recentRes.data ?? []) as CoinTxn[], spent30d };
}

/** Human label for a ledger row: model slug for generations, plain words otherwise. */
export function txnLabel(t: CoinTxn): string {
  if (t.transaction_type === "deduct") {
    const m = t.description?.match(/completed (\S+) generation/);
    if (m) return m[1].replace(/-(fal|pika)$/, "");
    return "generation";
  }
  if (t.transaction_type === "purchase") {
    return /subscription/i.test(t.description ?? "") ? "subscription" : "top up";
  }
  if (t.transaction_type === "bonus") return "bonus";
  return "adjustment";
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
