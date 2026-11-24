// `freym feedback`: agents report problems with freym itself (the CLI, its defaults, the skill).
// A report goes to a local outbox FIRST, then to the freym_cli_reports table through the
// freym_report() RPC — so a report survives the failure it reports (no sign-in, no network).
// Facts only: the command, exit code, error and problem list, build id. Never plan text or prompts.
import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors";
import { CONFIG_DIR, requireUser, sb } from "./session";

export const KINDS = ["bug", "default", "slow", "missing", "docs"] as const;
export type Kind = (typeof KINDS)[number];

declare const __FREYM_BUILD__: string;
/** The git commit the CLI was built from (+dirty): `cli-dist` is built by hand and can be stale. */
export const BUILD = typeof __FREYM_BUILD__ === "string" ? __FREYM_BUILD__ : "dev";

const OUTBOX = path.join(CONFIG_DIR, "outbox.jsonl");
const LAST = path.join(CONFIG_DIR, "last-error.json");

type Report = { kind: Kind; summary: string; details: string | null; context: Record<string, unknown> };
export type LastFailure = { argv: string[]; code: number; message: string; problems: string[]; at: string; build: string };

function writePrivate(file: string, text: string) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Every failed command leaves its facts here, for `freym feedback … --last`. */
export function recordFailure(argv: string[], code: number, message: string, problems: string[]) {
  try {
    const last: LastFailure = {
      argv: argv.slice(0, 20).map((a) => clip(a, 200)),
      code,
      message: clip(message, 2000),
      problems: problems.slice(0, 30).map((p) => clip(p, 300)),
      at: new Date().toISOString(),
      build: BUILD,
    };
    writePrivate(LAST, JSON.stringify(last));
  } catch {
    /* a report helper must never hide the real error */
  }
}

export function lastFailure(): LastFailure | null {
  try {
    return JSON.parse(fs.readFileSync(LAST, "utf8"));
  } catch {
    return null;
  }
}

function readOutbox(): Report[] {
  try {
    return fs
      .readFileSync(OUTBOX, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function writeOutbox(list: Report[]) {
  if (!list.length) {
    fs.rmSync(OUTBOX, { force: true });
    return;
  }
  writePrivate(OUTBOX, list.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function outboxSize(): number {
  return readOutbox().length;
}

/** Check and queue a report. Nothing leaves the Mac here. */
export function queueReport(kind: string, summary: string, details: string | undefined, withLast: boolean, project: string) {
  if (!(KINDS as readonly string[]).includes(kind))
    throw new CliError(`the kind must be one of: ${KINDS.join(", ")} (or list, show, close, send)`, 1);
  const s = summary.trim().replace(/\s+/g, " ");
  if (s.length < 3 || s.length > 300) throw new CliError("the summary must be 3–300 characters: one line, what you expected and what happened", 1);
  const context: Record<string, unknown> = {
    build: BUILD,
    node: process.version,
    os: process.platform,
    project, // the folder the agent works in
    at: new Date().toISOString(),
  };
  if (withLast) {
    const last = lastFailure();
    if (!last) throw new CliError("no failed freym command is recorded on this Mac (drop --last)", 2);
    context.last = last;
  }
  const report: Report = { kind: kind as Kind, summary: s, details: details?.trim() ? clip(details.trim(), 8000) : null, context };
  writeOutbox([...readOutbox(), report]);
}

export type Sent = { id: string; count: number; is_new: boolean; summary: string };

/** Send what the outbox holds. A report the database refuses for its content is dropped (and named);
 *  one that fails for sign-in or the network stays for the next time. */
export async function flushOutbox(): Promise<{ sent: Sent[]; dropped: string[]; left: number; error?: string }> {
  const list = readOutbox();
  if (!list.length) return { sent: [], dropped: [], left: 0 };
  try {
    await requireUser();
  } catch (e) {
    return { sent: [], dropped: [], left: list.length, error: (e as Error).message };
  }
  const sent: Sent[] = [];
  const dropped: string[] = [];
  const rest: Report[] = [];
  let error: string | undefined;
  for (const r of list) {
    const { data, error: err } = await sb().rpc("freym_report", {
      p_kind: r.kind,
      p_summary: r.summary,
      p_details: r.details,
      p_context: r.context,
    });
    if (!err && Array.isArray(data) && data[0]) sent.push({ ...(data[0] as Omit<Sent, "summary">), summary: r.summary });
    else if (err?.code?.startsWith("23") || err?.code === "22001") dropped.push(`${r.summary} (${err.message})`);
    else {
      rest.push(r);
      error = err?.message ?? "no answer";
    }
  }
  writeOutbox(rest);
  return { sent, dropped, left: rest.length, error };
}

export type Row = {
  id: string;
  kind: Kind;
  summary: string;
  details: string | null;
  context: Record<string, unknown>;
  count: number;
  status: string;
  resolution: string | null;
  created_at: string;
  last_seen_at: string;
};

export async function listReports(all: boolean): Promise<Row[]> {
  await requireUser();
  let q = sb().from("freym_cli_reports").select("*").order("last_seen_at", { ascending: false }).limit(200);
  if (!all) q = q.eq("status", "open");
  const { data, error } = await q;
  if (error) throw new CliError(`could not read the reports: ${error.message}`, 3);
  return (data ?? []) as Row[];
}

/** A report by its id or the first characters of it (as `list` prints them). */
export async function findReport(prefix: string): Promise<Row> {
  const p = prefix.replace(/^#/, "").toLowerCase();
  if (p.length < 4) throw new CliError("give at least 4 characters of the report id", 1);
  const hits = (await listReports(true)).filter((r) => r.id.startsWith(p));
  if (!hits.length) throw new CliError(`no report ${prefix}`, 2);
  if (hits.length > 1) throw new CliError(`${prefix} matches ${hits.length} reports: give more characters`, 1);
  return hits[0];
}

export async function closeReport(prefix: string, status: string, note: string): Promise<Row> {
  if (!["fixed", "wontfix", "duplicate", "open"].includes(status)) throw new CliError("--status fixed|wontfix|duplicate (or open to reopen)", 1);
  const r = await findReport(prefix);
  const { data, error } = await sb()
    .from("freym_cli_reports")
    .update({ status, resolution: note ? clip(note, 2000) : null, resolved_at: status === "open" ? null : new Date().toISOString() })
    .eq("id", r.id)
    .select("*")
    .single();
  if (error) throw new CliError(`could not change the report: ${error.message}`, 3);
  return data as Row;
}
