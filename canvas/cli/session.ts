// The freym CLI's Supabase session: the user's own sign-in (RLS applies), never a service key.
// Stored in ~/.config/freym/session.json (mode 600). Tokens are never printed.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../src/lib/supabase";
import { CliError } from "./errors";

const DIR = process.env.FREYM_CONFIG_DIR ?? path.join(os.homedir(), ".config", "freym");
const FILE = path.join(DIR, "session.json");
// The auth allow list has http://localhost:5173/** (the canvas dev server port).
const PORT = 5173;
const CALLBACK = `http://localhost:${PORT}/freym-cli`;

function readStore(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// supabase-js writes rotated refresh tokens back through this, so the file stays current.
const fileStorage = {
  getItem: (k: string) => readStore()[k] ?? null,
  setItem: (k: string, v: string) => writeStore({ ...readStore(), [k]: v }),
  removeItem: (k: string) => {
    const s = readStore();
    delete s[k];
    writeStore(s);
  },
};

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: fileStorage,
      storageKey: "freym-cli",
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** The signed-in user, or an error that says how to sign in. */
export async function requireUser(): Promise<{ id: string; email: string | null; isGuest: boolean }> {
  const { data } = await sb().auth.getSession(); // refreshes an expired session
  const u = data.session?.user;
  if (!u) throw new CliError("not signed in: run `freym login` (it opens the browser once)", 4);
  const isGuest = !u.email || u.app_metadata?.provider === "anonymous" || !!u.is_anonymous;
  return { id: u.id, email: u.email ?? null, isGuest };
}

function openUrl(url: string) {
  execFile("open", [url], () => {});
}

/** Google sign-in in the browser: PKCE, a one-shot callback server on localhost:5173. */
export async function loginGoogle(log: (s: string) => void): Promise<void> {
  const servers: http.Server[] = [];
  const gotCode = new Promise<string>((resolve, reject) => {
    const handler: http.RequestListener = (req, res) => {
      const u = new URL(req.url ?? "/", CALLBACK);
      if (u.pathname !== "/freym-cli") {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error_description") ?? u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>freym</title><body style="font:16px system-ui;padding:48px">` +
          (code ? "Signed in to freym. You can close this tab." : `Sign-in failed: ${String(err ?? "no code").replace(/[<>&]/g, "")}`) +
          `</body>`,
      );
      if (code) resolve(code);
      else reject(new CliError(`sign-in failed: ${err ?? "no code"}`, 4));
    };
    for (const host of ["127.0.0.1", "::1"]) {
      const s = http.createServer(handler);
      s.on("error", (e: NodeJS.ErrnoException) => {
        if (host === "127.0.0.1")
          reject(
            new CliError(
              e.code === "EADDRINUSE"
                ? `port ${PORT} is busy (the canvas dev server?): stop it and run \`freym login\` again`
                : `cannot listen on ${host}:${PORT}: ${e.message}`,
              3,
            ),
          );
      });
      s.listen(PORT, host);
      servers.push(s);
    }
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new CliError("sign-in timed out after 5 minutes", 4)), 5 * 60_000).unref(),
  );
  try {
    const { data, error } = await sb().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new CliError(`sign-in failed: ${error?.message ?? "no url"}`, 4);
    log("Opening the browser for Google sign-in. If it does not open, visit:");
    log(data.url);
    openUrl(data.url);
    const code = await Promise.race([gotCode, timeout]);
    const { error: exErr } = await sb().auth.exchangeCodeForSession(code);
    if (exErr) throw new CliError(`sign-in failed: ${exErr.message}`, 4);
  } finally {
    for (const s of servers) s.close();
  }
}

/** Legacy passphrase account (passphrase → SHA-256 → deviceId → guest-auth), as the canvas does. */
export async function loginPassphrase(passphrase: string): Promise<void> {
  const hex = createHash("sha256").update(passphrase.trim()).digest("hex").slice(0, 32);
  const deviceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/guest-auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new CliError(`sign-in failed (${res.status})`, 4);
  const json = (await res.json()) as { session?: { access_token: string; refresh_token: string }; data?: { session?: { access_token: string; refresh_token: string } } };
  const session = json.session ?? json.data?.session;
  if (!session?.access_token) throw new CliError("sign-in failed (no session)", 4);
  const { error } = await sb().auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) throw new CliError(`sign-in failed: ${error.message}`, 4);
}

export async function logout(): Promise<void> {
  await sb().auth.signOut({ scope: "local" });
  try {
    fs.rmSync(FILE);
  } catch {
    /* already gone */
  }
}
