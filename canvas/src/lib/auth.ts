import { supabase, SUPABASE_URL } from "./supabase";

// Deterministic identity: passphrase → SHA-256 → UUID-shaped deviceId → guest-auth.
// The same passphrase yields the same account in any browser. No secret ships in
// this bundle — a wrong passphrase simply lands on an empty zero-coin account.
async function passphraseToDeviceId(passphrase: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase.trim()));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function signInWithPassphrase(passphrase: string): Promise<{ error?: string }> {
  const deviceId = await passphraseToDeviceId(passphrase);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/guest-auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) return { error: `auth failed (${res.status})` };
  const json = await res.json();
  const session = json.session ?? json.data?.session;
  if (!session?.access_token) return { error: "auth failed (no session)" };
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return error ? { error: error.message } : {};
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
