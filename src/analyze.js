import { createRequire } from "node:module";
import { loadFile, periodDays } from "./load.js";
import { vercelRules } from "./rules/vercel.js";
import { supabaseRules, supabaseMonthly } from "./rules/supabase.js";
import { awsRules } from "./rules/aws.js";
import { selfhostEstimate } from "./rules/selfhost.js";
import { sum, r2 } from "./util.js";

const require = createRequire(import.meta.url);
export const PRICING = require("./pricing.json");

export const DEFAULT_ASSUMPTIONS = {
  min_line_cost: 1,
  functions_share_flag: 0.3,
  functions_cacheable_share: 0.3,
  idle_requests_30d: 0,
  idle_days: 14,
  oversized_avg_cpu_pct: 25,
  oversized_peak_cpu_pct: 60,
  oversized_avg_ram_pct: 50,
  egress_cacheable_share: 0.5,
  branch_waste_share: 0.5,
  nat_low_traffic_gb: 10,
  dto_flag_cost: 10,
  always_on_hours: 700,
  always_on_flag_cost: 20,
  selfhost_min_spend: 100
};

const SEV = { high: 0, medium: 1, low: 2, info: 3 };

export function analyze(files, opts = {}) {
  const A = { ...DEFAULT_ASSUMPTIONS, ...(opts.assume || {}) };
  const P = opts.pricing || PRICING;
  const loaded = files.map((f) => loadFile(f));
  const lines = loaded.flatMap((x) => x.lines);
  const snap = loaded.find((x) => x.supabase)?.supabase || null;

  // Scale each provider's lines to a 30-day month.
  const byProvider = {};
  for (const l of lines) (byProvider[l.provider] ||= []).push(l);
  const scaled = {};
  const periods = {};
  for (const [prov, ls] of Object.entries(byProvider)) {
    const days = periodDays(ls);
    periods[prov] = days;
    // A calendar month (28-31 days) counts as one month; other ranges are scaled to 30 days.
    const f = !days || (days >= 28 && days <= 31) ? 1 : 30 / days;
    scaled[prov] = ls.map((l) => ({ ...l, cost: l.cost * f, quantity: l.quantity * f }));
  }

  const findings = [];
  if (scaled.vercel) findings.push(...vercelRules(scaled.vercel, P, A));
  const supa = snap ? supabaseMonthly(snap, P) : null;
  if (snap) findings.push(...supabaseRules(snap, P, A));
  if (scaled.aws) findings.push(...awsRules(scaled.aws, P, A));

  const spend = {};
  for (const [prov, ls] of Object.entries(scaled)) spend[prov] = r2(sum(ls, (l) => l.cost));
  if (supa) spend.supabase = r2((spend.supabase || 0) + supa.total);

  const selfhost = (scaled.vercel || snap)
    ? selfhostEstimate({ vercelMonthly: spend.vercel || 0, supabase: supa, snap }, P, A)
    : null;

  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.saving.amount - a.saving.amount);
  const estimate = r2(sum(findings.filter((f) => f.saving.kind === "estimate"), (f) => f.saving.amount));
  const upTo = r2(estimate + sum(findings.filter((f) => f.saving.kind === "up_to"), (f) => f.saving.amount));
  const total = r2(sum(Object.values(spend)));

  return {
    tool: "blitzhash-cloud-cost-cutter",
    pricingChecked: P.checked,
    files: loaded.map((x) => ({ file: x.file, format: x.format, lines: x.lines.length, projects: x.supabase?.projects.length })),
    periods,
    spend,
    totalMonthly: total,
    findings,
    savings: { estimate, upTo },
    selfhost,
    assumptions: A
  };
}
