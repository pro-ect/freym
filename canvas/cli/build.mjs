// Bundle the freym-aigen CLI into one Node file (esbuild comes with vite).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

// `node cli/build.mjs` builds the CLI; `node cli/build.mjs test` builds and runs the self-test.
const test = process.argv[2] === "test";
const name = test ? "selftest" : "freym";
// The command is `freym-aigen` (2026-11-26: `freym` is now the freym.design CLI, ~/freym-design).
const outfile = new URL(`../cli-dist/${test ? "selftest" : "freym-aigen"}.mjs`, import.meta.url).pathname;
// The build id in every feedback report: the commit, and "+dirty" if the CLI source has changes.
const here = new URL(".", import.meta.url).pathname;
const git = (...a) => spawnSync("git", ["-C", here, ...a], { encoding: "utf8" }).stdout?.trim() ?? "";
const sha = git("rev-parse", "--short", "HEAD") || "unknown";
const dirty = git("status", "--porcelain", "--", "../cli", "../src") ? "+dirty" : "";
await build({
  define: { __FREYM_BUILD__: JSON.stringify(sha + dirty) },
  entryPoints: [new URL(`./${name}.ts`, import.meta.url).pathname],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "warning",
  // CommonJS dependencies inside an ESM bundle need a require().
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
fs.chmodSync(outfile, 0o755);
if (test) {
  const { status } = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exit(status ?? 1);
}
console.log(`built ${outfile} (${Math.round(fs.statSync(outfile).size / 1024)} KB)`);
