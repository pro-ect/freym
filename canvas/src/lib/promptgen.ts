import { supabase, SUPABASE_URL } from "./supabase";

/** Ask canvas-prompt-gen for N image prompts built from a one-line brief. */
export async function generatePrompts(opts: {
  brief: string;
  count: number;
  context?: string[];
  /** canvas_models `text` slug; omitted → the server's default writer. */
  model?: string;
}): Promise<string[]> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("not signed in");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/canvas-prompt-gen`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(opts),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402 || json?.code === "COINS_INSUFFICIENT_BALANCE") {
      window.dispatchEvent(new CustomEvent("fc-buy-coins"));
    }
    throw new Error(json?.error ?? `request failed (${res.status})`);
  }
  // A run is paid — refresh the wallet pill.
  window.dispatchEvent(new CustomEvent("fc-balance-refresh"));

  const prompts = (json?.prompts ?? []) as string[];
  if (!prompts.length) throw new Error("no prompts returned");
  return prompts;
}
