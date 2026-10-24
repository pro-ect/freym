import { supabase, SUPABASE_URL } from "./supabase";
import type { Plan } from "./agentPlan";

export type AgentTurn = { role: "user" | "assistant"; text: string };

/** One planning call to canvas-agent. Paid per message (flat coins). */
export async function askAgent(body: {
  message: string;
  mentions: unknown[];
  images: { handle: string; url: string }[];
  board: unknown[];
  catalog: unknown[];
  history: AgentTurn[];
}): Promise<Plan & { coins?: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("not signed in");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/canvas-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402 || json?.code === "COINS_INSUFFICIENT_BALANCE") {
      window.dispatchEvent(new CustomEvent("fc-buy-coins"));
    }
    throw new Error(json?.error ?? `request failed (${res.status})`);
  }
  window.dispatchEvent(new CustomEvent("fc-balance-refresh"));
  return { reply: String(json.reply ?? ""), questions: json.questions ?? [], ops: json.ops ?? [], coins: json.coins };
}
