import { supabase, SUPABASE_URL } from "./supabase";

/** Ask canvas-prompt-gen for N image prompts built from a one-line brief. */
export async function generatePrompts(opts: {
  brief: string;
  count: number;
  context?: string[];
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
  if (!res.ok) throw new Error(json?.error ?? `request failed (${res.status})`);

  const prompts = (json?.prompts ?? []) as string[];
  if (!prompts.length) throw new Error("no prompts returned");
  return prompts;
}
