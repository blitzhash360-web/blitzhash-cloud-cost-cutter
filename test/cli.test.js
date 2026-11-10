import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "cost-cutter.js");
const run = (...a) => execFileSync(process.execPath, [bin, ...a], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

test("--demo prints a plain-English report with the CTA", () => {
  const out = run("--demo", "--no-color");
  assert.match(out, /Possible savings: ~\$\d/);
  assert.match(out, /Oversized database: app-prod on LARGE/);
  assert.match(out, /estimates, not quotes/);
  assert.match(out, /Free assessment at https:\/\/blitzhash\.com/);
  assert.doesNotMatch(out, /\x1b\[/);
});

test("--json is valid JSON", () => {
  const r = JSON.parse(run("--demo", "--json"));
  assert.ok(r.findings.length > 10);
});

test("--markdown writes a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "bcc-"));
  run("--demo", "--brief", "--markdown", join(dir, "r.md"));
  const md = readFileSync(join(dir, "r.md"), "utf8");
  assert.match(md, /^# Cloud cost report/);
  assert.match(md, /\| 1 \| high \|/);
});

test("--top limits the table", () => {
  const out = run("--demo", "--brief", "--top", "3", "--no-color");
  assert.match(out, /…and \d+ more/);
});

test("bad input exits 2", () => {
  const r = spawnSync(process.execPath, [bin, join(root, "fixtures", "cases", "unknown.json")], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /could not recognise/);
  const m = spawnSync(process.execPath, [bin, "nope.csv"], { encoding: "utf8" });
  assert.equal(m.status, 2);
  const a = spawnSync(process.execPath, [bin, "--demo", "--assume", "bogus=1"], { encoding: "utf8" });
  assert.equal(a.status, 2);
});

test("no fake $0 savings headline when nothing can be estimated", () => {
  const out = run(join(root, "fixtures", "cases", "vercel-cli.json"), "--no-color");
  assert.match(out, /1 thing to look at\./);
  assert.doesNotMatch(out, /Possible savings/);
});
