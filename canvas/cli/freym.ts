// freym — make freym canvas boards (freym.app/canvas) from any project.
// Boards only: nothing here starts a model run or spends coins.
import type { Edge, Node } from "@xyflow/react";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boardForAgent, catalogForAgent, handleMap } from "../src/lib/agentPlan";
import { fetchModels } from "../src/lib/models";
import { usd } from "../src/lib/balance";
import { CliError } from "./errors";
import { buildBoard, parsePlan, type ImageSrc } from "./plan";
import { loginGoogle, loginOwner, loginPassphrase, logout, requireUser, sb } from "./session";

const SITE = "https://freym.app/canvas/";
const MAX_DIM = 2048; // the canvas downscales uploads to this (lib/upload.ts)
const MAX_BYTES = 8 * 1024 * 1024;

const HELP = `freym — make freym canvas boards (${SITE}) from any project

Usage
  freym login                     sign in with Google in the browser (once per machine)
  freym login --owner             sign in as this Mac's owner, no browser (~/.config/freym/owner);
                                  every command does this by itself when no one is signed in
  freym login --passphrase        the legacy passphrase account (reads FREYM_PASSPHRASE or stdin)
  freym logout | freym whoami
  freym models [--kind image|video]   the canvas models: slug, inputs, params, price
  freym boards                    your boards (newest first)
  freym show <board>              a board's nodes with handles (n1, n2…) to wire into
  freym check <plan.json> [--board <board>]   run every check, write nothing
  freym new "<name>" <plan.json> [--open]     a new board from a plan
  freym add <board> <plan.json>   add a plan to a board (close the board in the browser first)
  freym open <board> | freym share <board>    open it / a read-only link
  freym plan-help                 the plan format, for an agent

Every command accepts --json. Exit codes: 0 ok, 1 usage or a plan that fails a check,
2 not found, 3 network or IO, 4 sign-in. Boards only: the user starts runs in the canvas.`;

const PLAN_HELP = `A plan is a JSON file: {"name": "optional", "ops": [ … ]}. Keys are your own short names.

  {"op": "add_text",   "key": "t",  "text": "Hero key images", "size": 48}      a title (size 8–400 px, default 48)
  {"op": "add_image",  "key": "r1", "src": "refs/product.jpg"}                  a reference image: a local file (uploaded) or an https URL
  {"op": "add_prompt", "key": "p1", "text": "…"}
  {"op": "add_model",  "key": "m1", "slug": "<slug from freym models>", "params": {"aspect_ratio": "16:9"}}
  {"op": "connect",    "from": "p1", "to": "m1"}                                a prompt, image or model into a model
  {"op": "set_prompt", "id": "n3", "text": "…"} / {"op": "set_params", "id": "n4", "params": {…}}   (freym add: n3 = a handle from freym show)

Layout is automatic: titles on top, reference images in a column on the left, then one row per prompt
with the models it feeds; on \`freym add\` the new block goes under everything. Give no positions.
Checks (the canvas agent's own): the slug exists, params are ones the model declares with allowed values,
a model takes no more images than it can, wires end on a model. Any failed check = nothing written.
Consistent sets: wire the SAME reference images and the same prompt into each model you compare.`;

type Flags = Record<string, string | boolean>;
function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (["json", "open", "passphrase", "owner", "help"].includes(k) || next === undefined || next.startsWith("--")) flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

let JSON_OUT = false;
function out(data: unknown, text: string) {
  process.stdout.write((JSON_OUT ? JSON.stringify(data, null, 2) : text) + "\n");
}

const boardUrl = (id: string) => `${SITE}?project=${id}`;

async function loadBoard(id: string) {
  await requireUser();
  const { data, error } = await sb()
    .from("canvas_projects")
    .select("id, name, nodes, edges, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new CliError(`could not read the board: ${error.message}`, 3);
  if (!data) throw new CliError(`no board ${id} on this account (see \`freym boards\`)`, 2);
  return data as { id: string; name: string; nodes: Node[]; edges: Edge[]; updated_at: string };
}

function readPlan(file: string | undefined) {
  if (!file) throw new CliError("a plan file is required (see `freym plan-help`)", 1);
  let text: string;
  try {
    text = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(file), "utf8");
  } catch {
    throw new CliError(`cannot read ${file}`, 2);
  }
  return { plan: parsePlan(text), dir: file === "-" ? process.cwd() : path.dirname(path.resolve(file)) };
}

function sipsDims(file: string): { w: number; h: number } | null {
  try {
    const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const w = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1]);
    const h = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1]);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null; // not macOS, or not an image sips reads
  }
}

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif", ".tif", ".tiff"];

/** A local image as the canvas uploads it: JPEG, at most 2048 px and 8 MB. */
function asUploadJpeg(file: string, dims: { w: number; h: number } | null): { file: string; tmp?: string } {
  const ext = path.extname(file).toLowerCase();
  const jpeg = ext === ".jpg" || ext === ".jpeg";
  if (jpeg && fs.statSync(file).size <= MAX_BYTES && (!dims || Math.max(dims.w, dims.h) <= MAX_DIM)) return { file };
  if (!dims) throw new Error("cannot convert this image here (sips not found or unreadable): use a JPEG");
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "freym-")), "image.jpg");
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", "-Z", String(MAX_DIM), file, "--out", tmp], { stdio: "ignore" });
  return { file: tmp, tmp };
}

/** Download an https image to a temp file, to check it and read its shape. */
async function fetchImage(url: string): Promise<string> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) throw new Error(`cannot download ${url} (${res?.status ?? "network error"})`);
  if (!/^image\//.test(res.headers.get("content-type") ?? "")) throw new Error(`not an image: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error(`image over 25 MB: ${url}`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "freym-")), "remote");
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function imageResolver(baseDir: string, upload: boolean) {
  return async (img: ImageSrc) => {
    if (/^https:\/\//i.test(img.src)) {
      // A URL goes on the board as is; it is downloaded once to check it and read its shape.
      const tmp = await fetchImage(img.src);
      try {
        const d = sipsDims(tmp);
        return { url: img.src, ratio: d ? d.h / d.w : 1 };
      } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      }
    }
    if (/^[a-z]+:\/\//i.test(img.src)) throw new Error("only https URLs or local files");
    const file = path.resolve(baseDir, img.src.replace(/^~(?=\/)/, os.homedir()));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`file not found: ${img.src}`);
    if (!IMAGE_EXT.includes(path.extname(file).toLowerCase())) throw new Error(`not an image file: ${path.basename(file)}`);
    const dims = sipsDims(file);
    const ratio = dims ? dims.h / dims.w : 1;
    if (!upload) {
      return { url: `file://${file}`, fileName: path.basename(file), ratio };
    }
    const ready = asUploadJpeg(file, dims);
    try {
      const user = await requireUser();
      const key = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb().storage.from("generation-inputs").upload(key, fs.readFileSync(ready.file), { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(`upload failed: ${error.message}`);
      return { url: sb().storage.from("generation-inputs").getPublicUrl(key).data.publicUrl, fileName: path.basename(file), ratio };
    } finally {
      if (ready.tmp) fs.rmSync(path.dirname(ready.tmp), { recursive: true, force: true });
    }
  };
}

function summary(r: Awaited<ReturnType<typeof buildBoard>>) {
  const c = r.counts;
  const parts = [`${c.titles} title${c.titles === 1 ? "" : "s"}`, `${c.images} image${c.images === 1 ? "" : "s"}`, `${c.prompts} prompt${c.prompts === 1 ? "" : "s"}`, `${c.models} model${c.models === 1 ? "" : "s"}`, `${c.wires} wire${c.wires === 1 ? "" : "s"}`];
  const runs = r.runs.map((x) => `  ${x.model.padEnd(28)} ${x.coins == null ? "price unknown" : `${x.coins} coins (${usd(x.coins)})`}`).join("\n");
  return `${parts.join(", ")}\n${runs}${r.runs.length ? `\none run of every model ≈ ${r.coins} coins (${usd(r.coins)}); runs start in the canvas` : ""}`;
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  JSON_OUT = !!flags.json;
  const cmd = pos.shift();
  if (!cmd || cmd === "help" || flags.help) return out({ help: HELP }, HELP);

  switch (cmd) {
    case "plan-help":
      return out({ help: PLAN_HELP }, PLAN_HELP);

    case "login": {
      if (flags.owner) await loginOwner();
      else if (flags.passphrase) {
        const p = process.env.FREYM_PASSPHRASE ?? fs.readFileSync(0, "utf8").split("\n")[0];
        if (!p?.trim()) throw new CliError("no passphrase (set FREYM_PASSPHRASE or pipe it on stdin)", 1);
        await loginPassphrase(p);
      } else await loginGoogle((s) => process.stderr.write(s + "\n"));
      const u = await requireUser();
      return out({ id: u.id, email: u.email }, `signed in as ${u.email ?? `a passphrase account (${u.id.slice(0, 8)}…)`}`);
    }

    case "logout":
      await logout();
      return out({ ok: true }, "signed out");

    case "whoami": {
      const u = await requireUser();
      const { data } = await sb().from("profiles").select("coin_balance, subscription_coins").eq("id", u.id).maybeSingle();
      const coins = data ? (data.coin_balance ?? 0) + (data.subscription_coins ?? 0) : null;
      return out(
        { id: u.id, email: u.email, coins },
        `${u.email ?? `passphrase account ${u.id.slice(0, 8)}…`}${coins == null ? "" : `  ·  ${coins} coins (${usd(coins)})`}`,
      );
    }

    case "models": {
      const kind = flags.kind as string | undefined;
      if (kind && kind !== "image" && kind !== "video") throw new CliError("--kind image|video", 1);
      const list = catalogForAgent(await fetchModels(sb()), new Set()).filter((m) => !kind || m.category === kind);
      return out(
        { models: list },
        list
          .map((m) => {
            const params = Object.entries(m.params)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
              .join("  ");
            return `${m.slug.padEnd(34)} ${m.category.padEnd(6)} ${m.name.padEnd(28)} images≤${m.max_images}${m.frames ? " frames" : ""}  ${m.coins ?? "~"} coins\n${" ".repeat(35)}${params}`;
          })
          .join("\n"),
      );
    }

    case "boards": {
      await requireUser();
      const { data, error } = await sb().from("canvas_projects").select("id, name, nodes, updated_at").order("updated_at", { ascending: false });
      if (error) throw new CliError(`could not list boards: ${error.message}`, 3);
      const rows = (data ?? []).map((b) => ({ id: b.id, name: b.name, nodes: (b.nodes as unknown[]).length, updated_at: b.updated_at, url: boardUrl(b.id) }));
      return out({ boards: rows }, rows.map((b) => `${b.id}  ${b.updated_at.slice(0, 16).replace("T", " ")}  ${String(b.nodes).padStart(3)} nodes  ${b.name}`).join("\n") || "no boards yet");
    }

    case "show": {
      const b = await loadBoard(need(pos[0], "freym show <board>"));
      const { toHandle } = handleMap(b.nodes);
      const nodes = boardForAgent(b.nodes, b.edges, toHandle);
      return out(
        { id: b.id, name: b.name, url: boardUrl(b.id), nodes },
        `${b.name}  ${boardUrl(b.id)}\n` +
          nodes
            .map((n) => `${String(n.handle).padEnd(4)} ${String(n.type).padEnd(7)} ${n.label}${"slug" in n && n.slug ? `  [${n.slug}]` : ""}${n.inputs ? `  ← ${n.inputs.join(", ")}` : ""}`)
            .join("\n"),
      );
    }

    case "check": {
      const { plan, dir } = readPlan(pos[0]);
      const base = flags.board ? await loadBoard(String(flags.board)) : { nodes: [] as Node[], edges: [] as Edge[] };
      const r = await buildBoard(plan, { nodes: base.nodes, edges: base.edges, models: await fetchModels(sb()), resolveImage: imageResolver(dir, false) });
      return out({ ok: true, counts: r.counts, runs: r.runs, coins: r.coins }, `ok — ${summary(r)}`);
    }

    case "new": {
      const name = need(pos[0], 'freym new "<name>" <plan.json>');
      const { plan, dir } = readPlan(pos[1]);
      const user = await requireUser();
      const models = await fetchModels(sb());
      // Every check first, with no upload; then the real build uploads the images.
      await buildBoard(plan, { nodes: [], edges: [], models, resolveImage: imageResolver(dir, false) });
      const r = await buildBoard(plan, { nodes: [], edges: [], models, resolveImage: imageResolver(dir, true) });
      const { data, error } = await sb()
        .from("canvas_projects")
        .insert({ user_id: user.id, name: name || plan.name || "Untitled", nodes: r.nodes, edges: r.edges })
        .select("id")
        .single();
      if (error) throw new CliError(`could not save the board: ${error.message}`, 3);
      if (flags.open) execFile("open", [boardUrl(data.id)], () => {});
      return out({ id: data.id, url: boardUrl(data.id), counts: r.counts, runs: r.runs, coins: r.coins }, `created ${data.id}\n${boardUrl(data.id)}\n${summary(r)}`);
    }

    case "add": {
      const id = need(pos[0], "freym add <board> <plan.json>");
      const { plan, dir } = readPlan(pos[1]);
      const b = await loadBoard(id);
      const models = await fetchModels(sb());
      await buildBoard(plan, { nodes: b.nodes, edges: b.edges, models, resolveImage: imageResolver(dir, false) });
      const r = await buildBoard(plan, { nodes: b.nodes, edges: b.edges, models, resolveImage: imageResolver(dir, true) });
      // Compare-and-set: refuse if the board was saved (by an open canvas tab) since we read it.
      const { data, error } = await sb()
        .from("canvas_projects")
        .update({ nodes: r.nodes, edges: r.edges, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("updated_at", b.updated_at)
        .select("id");
      if (error) throw new CliError(`could not save the board: ${error.message}`, 3);
      if (!data?.length) throw new CliError("the board changed while the plan was built (is it open in the browser?): close it and run again", 3);
      return out(
        { id, url: boardUrl(id), counts: r.counts, runs: r.runs, coins: r.coins },
        `added to ${b.name}\n${boardUrl(id)}\n${summary(r)}\nIf the board is open in a browser tab, reload it before you edit there: the tab's next save would drop these nodes.`,
      );
    }

    case "open": {
      const id = need(pos[0], "freym open <board>");
      execFile("open", [boardUrl(id)], () => {});
      return out({ url: boardUrl(id) }, boardUrl(id));
    }

    case "share": {
      const b = await loadBoard(need(pos[0], "freym share <board>"));
      const { data } = await sb().from("canvas_projects").select("share_token").eq("id", b.id).maybeSingle();
      let token = data?.share_token as string | null;
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "");
        const { error } = await sb().from("canvas_projects").update({ share_token: token }).eq("id", b.id);
        if (error) throw new CliError(`could not make a share link: ${error.message}`, 3);
      }
      const url = `${SITE}?share=${token}`;
      return out({ url }, url);
    }

    default:
      throw new CliError(`unknown command "${cmd}" (see \`freym help\`)`, 1);
  }
}

function need(v: string | undefined, usage: string): string {
  if (!v) throw new CliError(`usage: ${usage}`, 1);
  return v;
}

main().then(
  () => process.exit(0),
  (e) => {
    const err = e instanceof CliError ? e : new CliError(String((e as Error)?.message ?? e), 3);
    const details = Array.isArray(err.details) ? (err.details as string[]) : [];
    if (JSON_OUT) process.stdout.write(JSON.stringify({ error: err.message, problems: details, code: err.code }, null, 2) + "\n");
    else process.stderr.write(`freym: ${err.message}${details.map((d) => `\n  - ${d}`).join("")}\n`);
    process.exit(err.code);
  },
);
