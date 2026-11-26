// The freym CLI's Supabase session: the user's own sign-in (RLS applies), never a service key.
// Stored in ~/.config/freym/session.json (mode 600). Tokens are never printed.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../src/lib/supabase";
import { CliError } from "./errors";

const DIR = process.env.FREYM_CONFIG_DIR ?? path.join(os.homedir(), ".config", "freym");
export const CONFIG_DIR = DIR;
const FILE = path.join(DIR, "session.json");
const OWNER_FILE = path.join(DIR, "owner");
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
  let { data } = await sb().auth.getSession(); // refreshes an expired session
  if (!data.session && fs.existsSync(OWNER_FILE)) {
    // The owner's own Mac: sign in with no browser (see loginOwner), once; the session then renews.
    try {
      await loginOwner();
      process.stderr.write("freym-aigen: signed in as this Mac's owner (no browser)\n");
    } catch (e) {
      throw new CliError(`not signed in, and the owner sign-in failed: ${(e as Error).message}. Run \`freym-aigen login\` (browser).`, 4);
    }
    ({ data } = await sb().auth.getSession());
  }
  const u = data.session?.user;
  if (!u) throw new CliError("not signed in: run `freym-aigen login` (it opens the browser once)", 4);
  const isGuest = !u.email || u.app_metadata?.provider === "anonymous" || !!u.is_anonymous;
  return { id: u.id, email: u.email ?? null, isGuest };
}

function openUrl(url: string) {
  execFile("open", [url], () => {});
}

/** Google sign-in in the browser: PKCE, a one-shot callback server on localhost:5173. */
export async function loginGoogle(log: (s: string) => void): Promise<void> {
  const servers: http.Server[] = [];
  let listening!: Promise<void>;
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
    const ipv4 = http.createServer(handler);
    const ipv6 = http.createServer(handler);
    servers.push(ipv4, ipv6);
    // The IPv4 server must listen before the browser opens; IPv6 is a bonus (localhost may be ::1).
    listening = new Promise<void>((ok, fail) => {
      ipv4.once("listening", () => ok());
      ipv4.on("error", (e: NodeJS.ErrnoException) =>
        fail(
          new CliError(
            e.code === "EADDRINUSE"
              ? `port ${PORT} is busy (the canvas dev server?): stop it and run \`freym-aigen login\` again`
              : `cannot listen on 127.0.0.1:${PORT}: ${e.message}`,
            3,
          ),
        ),
      );
    });
    ipv6.on("error", () => {});
    ipv4.listen(PORT, "127.0.0.1");
    ipv6.listen(PORT, "::1");
  });
  gotCode.catch(() => {}); // awaited below; this only stops an early "unhandled rejection"
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new CliError("sign-in timed out after 5 minutes", 4)), 5 * 60_000).unref(),
  );
  try {
    await listening;
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

/**
 * Sign in as this Mac's owner with no browser. `~/.config/freym/owner` holds the owner's user id
 * (no email or secret in the repo). The Supabase CLI login in the macOS keychain reads the
 * project's service key (kept in memory only), which mints a one-time magic-link token for the
 * owner's own account; verifying it gives an ordinary user session, saved like `freym-aigen login`'s.
 * RLS still applies to everything the CLI does after that.
 */
export async function loginOwner(): Promise<void> {
  let owner = "";
  try {
    owner = fs.readFileSync(OWNER_FILE, "utf8").trim();
  } catch {
    throw new CliError(`no owner set: put your user id in ${OWNER_FILE}`, 4);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner)) throw new CliError(`${OWNER_FILE} must hold a user id (uuid)`, 4);
  let raw = "";
  try {
    raw = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new CliError("no Supabase CLI login in the keychain (run `supabase login`)", 4);
  }
  const cliToken = raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice(18), "base64").toString("utf8").trim() : raw;
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { authorization: `Bearer ${cliToken}` } });
  if (!res.ok) throw new CliError(`the Supabase CLI login cannot read this project's keys (${res.status})`, 4);
  const keys = (await res.json()) as { name?: string; type?: string; api_key?: string }[];
  const service = keys.find((k) => k.name === "service_role")?.api_key ?? keys.find((k) => k.type === "secret")?.api_key;
  if (!service) throw new CliError("no service key on this project", 4);
  const admin = createClient(SUPABASE_URL, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: found, error: findErr } = await admin.auth.admin.getUserById(owner);
  if (findErr || !found.user?.email) throw new CliError(`owner ${owner.slice(0, 8)}… not found`, 4);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: found.user.email });
  const hash = link?.properties?.hashed_token;
  if (linkErr || !hash) throw new CliError(`could not mint a sign-in token: ${linkErr?.message ?? "no token"}`, 4);
  const { data: s, error } = await sb().auth.verifyOtp({ token_hash: hash, type: "magiclink" });
  if (error || s.session?.user.id !== owner) {
    await logout();
    throw new CliError(`owner sign-in failed: ${error?.message ?? "another user came back"}`, 4);
  }
}

export async function logout(): Promise<void> {
  await sb().auth.signOut({ scope: "local" });
  try {
    fs.rmSync(FILE);
  } catch {
    /* already gone */
  }
}
