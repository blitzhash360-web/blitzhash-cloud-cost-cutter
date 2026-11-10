import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, PRICING } from "../src/analyze.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (p) => join(root, "fixtures", p);
const DEMO = ["demo/vercel-focus.jsonl", "demo/supabase-usage.json", "demo/aws-focus.csv"].map(fx);
const ids = (r) => r.findings.map((f) => f.id);
const byId = (r, id) => r.findings.filter((f) => f.id === id);

test("demo fixtures produce exactly the expected flags and savings", () => {
  const r = analyze(DEMO);
  const expected = JSON.parse(readFileSync(fx("expected/demo-flags.json"), "utf8"));
  const actual = r.findings.map((f) => ({ id: f.id, title: f.title, monthlyCost: f.monthlyCost, saving: f.saving }));
  assert.deepEqual(actual, expected.findings);
  assert.deepEqual(r.savings, expected.savings);
  assert.deepEqual(r.spend, expected.spend);
});

test("demo: key flags present with list-price math", () => {
  const r = analyze(DEMO);
  // Supabase Large ($110) -> Medium ($60) from supabase.com/pricing
  assert.equal(byId(r, "SUPABASE_OVERSIZED_COMPUTE")[0].saving.amount, 50);
  // Idle micro project: $10 compute
  assert.equal(byId(r, "SUPABASE_IDLE_PROJECT")[0].saving.amount, 10);
  // Enhanced build minutes $29.40 -> Standard at half the per-minute price
  assert.equal(byId(r, "VERCEL_BUILD_MACHINES")[0].saving.amount, 14.7);
  // gp2 -> gp3: 20% of $20
  assert.equal(byId(r, "AWS_EBS_GP2")[0].saving.amount, 4);
  // Two idle IPv4 addresses, 744 h x $0.005
  assert.equal(byId(r, "AWS_IDLE_IPV4")[0].saving.amount, 7.44);
  assert.ok(ids(r).includes("SUPABASE_SPEND_CAP_OFF"));
  assert.ok(ids(r).includes("VERCEL_FUNCTIONS"));
  assert.ok(r.selfhost && r.selfhost.saving.kind === "up_to");
});

test("staging project is flagged as non-production, not as oversized", () => {
  const r = analyze(DEMO);
  assert.ok(byId(r, "SUPABASE_DEV_ON_PAID").some((f) => f.title.includes("app-staging")));
  assert.ok(!byId(r, "SUPABASE_OVERSIZED_COMPUTE").some((f) => f.title.includes("app-staging")));
});

test("every finding is labelled and cites a price source", () => {
  const r = analyze(DEMO);
  for (const f of [...r.findings, r.selfhost]) {
    assert.match(f.source, /^https:\/\//, f.id);
    assert.ok(["estimate", "up_to", "none"].includes(f.saving.kind), f.id);
    if (f.saving.kind !== "none") assert.ok(f.assumption.length > 10, `${f.id} needs an assumption`);
    assert.ok(f.todo.length > 0, f.id);
  }
  assert.equal(r.pricingChecked, PRICING.checked);
});

test("AWS legacy CUR CSV", () => {
  const r = analyze([fx("cases/aws-cur-legacy.csv")]);
  assert.equal(r.files[0].format, "aws-cur");
  assert.deepEqual(ids(r).sort(), ["AWS_EBS_GP2", "AWS_IDLE_IPV4"]);
  assert.equal(byId(r, "AWS_EBS_GP2")[0].saving.amount, 10); // gp3 line is not counted
});

test("simple CSV template", () => {
  const r = analyze([fx("cases/simple.csv")]);
  assert.equal(r.files[0].format, "simple-csv");
  const b = byId(r, "VERCEL_BUILD_MACHINES")[0];
  assert.equal(b.saving.amount, 36.4); // $42 * (1 - 0.014/0.105)
  assert.ok(ids(r).includes("VERCEL_BANDWIDTH"));
  assert.ok(ids(r).includes("AWS_IDLE_IPV4"));
});

test("vercel billing usage --json", () => {
  const r = analyze([fx("cases/vercel-cli.json")]);
  assert.equal(r.files[0].format, "vercel-cli-json");
  assert.deepEqual(ids(r), ["VERCEL_BANDWIDTH"]);
  assert.equal(r.findings[0].severity, "high");
});

test("healthy Supabase org: no flags, no self-host pitch", () => {
  const r = analyze([fx("cases/supabase-healthy.json")]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.selfhost, null);
});

test("partial periods are scaled to 30 days", () => {
  const r = analyze([fx("cases/vercel-15-days.jsonl")]);
  assert.equal(r.periods.vercel, 15);
  assert.equal(r.spend.vercel, 60); // $30 over 15 days -> $60 / 30 days
  assert.equal(byId(r, "VERCEL_DEPLOY_STORAGE")[0].monthlyCost, 60);
});

test("assumptions can be changed", () => {
  const r = analyze(DEMO, { assume: { functions_cacheable_share: 0.1 } });
  assert.equal(byId(r, "VERCEL_FUNCTIONS")[0].saving.amount, 8.36);
});

test("unknown files fail with a helpful message", () => {
  assert.throws(() => analyze([fx("cases/unknown.json")]), /could not recognise/);
});

test("gzipped exports (AWS Data Exports deliver .csv.gz)", () => {
  const r = analyze([fx("cases/aws-cur-legacy.csv.gz")]);
  assert.equal(r.files[0].format, "aws-cur");
  assert.deepEqual(ids(r).sort(), ["AWS_EBS_GP2", "AWS_IDLE_IPV4"]);
});
