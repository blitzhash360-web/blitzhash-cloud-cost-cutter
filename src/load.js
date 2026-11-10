import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename } from "node:path";
import { parseCsv } from "./csv.js";

const num = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const pick = (o, keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== "") return o[k];
  return undefined;
};

// Parse a file into raw objects (CSV rows, JSON array/object, or JSONL lines).
export function readRaw(path) {
  const buf = readFileSync(path);
  // AWS Data Exports deliver .csv.gz files; read them as-is.
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  path = path.replace(/\.gz$/i, "");
  const trimmed = text.trim();
  if (/\.csv$/i.test(path) || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return { kind: "csv", data: parseCsv(text) };
  }
  try {
    return { kind: "json", data: JSON.parse(trimmed) };
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    return { kind: "jsonl", data: lines.map((l, i) => {
      try { return JSON.parse(l); } catch { throw new Error(`${basename(path)}: line ${i + 1} is not valid JSON`); }
    }) };
  }
}

// A normalized usage line. cost = what this line cost in the export period (USD).
function line(o) {
  return {
    provider: o.provider,
    service: o.service || "",
    sku: o.sku || "",
    description: o.description || "",
    usageType: o.usageType || "",
    quantity: num(o.quantity),
    unit: o.unit || "",
    cost: num(o.cost),
    resourceId: o.resourceId || "",
    resourceName: o.resourceName || "",
    start: o.start || "",
    end: o.end || ""
  };
}

function providerFromText(s) {
  const t = String(s || "").toLowerCase();
  if (t.includes("vercel")) return "vercel";
  if (t.includes("supabase")) return "supabase";
  if (t.includes("aws") || t.includes("amazon")) return "aws";
  return t || "other";
}

// FOCUS (Vercel /v1/billing/charges, AWS Data Exports FOCUS 1.x)
function isFocus(r) { return r && ("BilledCost" in r || "EffectiveCost" in r) && ("ServiceName" in r); }
function fromFocus(r) {
  return line({
    provider: providerFromText(pick(r, ["ServiceProviderName", "ProviderName", "PublisherName", "InvoiceIssuerName"])),
    service: r.ServiceName,
    sku: pick(r, ["SkuId", "SkuPriceId"]),
    description: r.ChargeDescription,
    usageType: pick(r, ["SkuMeter", "x_UsageType", "x_Operation"]),
    quantity: pick(r, ["ConsumedQuantity", "PricingQuantity"]),
    unit: pick(r, ["ConsumedUnit", "PricingUnit"]),
    cost: pick(r, ["EffectiveCost", "BilledCost"]),
    resourceId: r.ResourceId,
    resourceName: pick(r, ["ResourceName", "SubAccountName"]),
    start: pick(r, ["ChargePeriodStart", "BillingPeriodStart"]),
    end: pick(r, ["ChargePeriodEnd", "BillingPeriodEnd"])
  });
}

// AWS Cost and Usage Report (legacy CUR "lineItem/..." or CUR 2.0 "line_item_...")
function isCur(r) { return r && ("lineItem/UsageType" in r || "line_item_usage_type" in r); }
function fromCur(r) {
  return line({
    provider: "aws",
    service: pick(r, ["product/ProductName", "product_product_name", "lineItem/ProductCode", "line_item_product_code"]),
    sku: pick(r, ["product/sku", "product_sku"]),
    description: pick(r, ["lineItem/LineItemDescription", "line_item_line_item_description"]),
    usageType: pick(r, ["lineItem/UsageType", "line_item_usage_type"]),
    quantity: pick(r, ["lineItem/UsageAmount", "line_item_usage_amount"]),
    unit: pick(r, ["pricing/unit", "pricing_unit"]),
    cost: pick(r, ["lineItem/UnblendedCost", "line_item_unblended_cost"]),
    resourceId: pick(r, ["lineItem/ResourceId", "line_item_resource_id"]),
    start: pick(r, ["lineItem/UsageStartDate", "line_item_usage_start_date"]),
    end: pick(r, ["lineItem/UsageEndDate", "line_item_usage_end_date"])
  });
}

// BlitzHash simple template (templates/usage-template.csv)
function isSimple(r) { return r && "provider" in r && "cost" in r && ("service" in r || "metric" in r); }
function fromSimple(r) {
  return line({
    provider: providerFromText(r.provider),
    service: r.service,
    sku: r.metric,
    description: r.notes,
    usageType: r.metric,
    quantity: r.quantity,
    unit: r.unit,
    cost: r.cost,
    resourceId: r.resource_id,
    resourceName: r.resource_name,
    start: r.period_start,
    end: r.period_end
  });
}

// `vercel billing usage --json` (tolerant: field names are read loosely)
function isVercelCliJson(d) { return d && !Array.isArray(d) && Array.isArray(d.services); }
function fromVercelCli(d) {
  return d.services.map((s) => line({
    provider: "vercel",
    service: pick(s, ["name", "serviceName", "service", "id"]),
    sku: pick(s, ["id", "sku", "name"]),
    quantity: pick(s, ["usage", "quantity", "consumedQuantity", "value"]),
    unit: pick(s, ["unit", "usageUnit"]),
    cost: pick(s, ["cost", "effectiveCost", "billedCost", "amount"]),
    start: d.period?.start || d.period?.from,
    end: d.period?.end || d.period?.to
  }));
}

// Supabase snapshot (templates/supabase-usage.template.json)
function isSupabaseSnapshot(d) { return d && !Array.isArray(d) && (d.provider === "supabase" || Array.isArray(d.projects)) && d.plan; }

export function loadFile(path) {
  const { data } = readRaw(path);
  const name = basename(path);
  if (isSupabaseSnapshot(data)) return { file: name, format: "supabase-snapshot", supabase: normalizeSupabase(data), lines: [] };
  if (data && !Array.isArray(data) && data.provider === "supabase") throw new Error(`${name}: Supabase snapshot needs "plan" and "projects". Start from templates/supabase-usage.template.json.`);
  if (isVercelCliJson(data)) return { file: name, format: "vercel-cli-json", lines: fromVercelCli(data) };
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.charges) ? data.charges : [data];
  const first = rows.find((r) => r && typeof r === "object") || {};
  if (isFocus(first)) return { file: name, format: "focus", lines: rows.filter(isFocus).map(fromFocus) };
  if (isCur(first)) return { file: name, format: "aws-cur", lines: rows.filter(isCur).map(fromCur) };
  if (isSimple(first)) return { file: name, format: "simple-csv", lines: rows.filter(isSimple).map(fromSimple) };
  throw new Error(`${name}: could not recognise this file. Supported: FOCUS (Vercel billing API, AWS Data Exports), AWS CUR, \`vercel billing usage --json\`, the Supabase snapshot template, or templates/usage-template.csv. See docs/EXPORTS.md.`);
}

function normalizeSupabase(d) {
  const projects = (d.projects || []).map((p) => ({
    name: p.name || p.ref || "project",
    environment: String(p.environment || "production").toLowerCase(),
    compute: String(p.compute || "micro").toLowerCase(),
    dbSizeGb: num(p.db_size_gb),
    egressGb: num(p.egress_gb),
    cachedEgressGb: num(p.cached_egress_gb),
    storageGb: num(p.storage_gb),
    requests30d: p.requests_30d === undefined ? null : num(p.requests_30d),
    daysSinceLastRequest: p.days_since_last_request === undefined ? null : num(p.days_since_last_request),
    avgCpuPct: p.avg_cpu_pct === undefined ? null : num(p.avg_cpu_pct),
    peakCpuPct: p.peak_cpu_pct === undefined ? null : num(p.peak_cpu_pct),
    avgRamPct: p.avg_ram_pct === undefined ? null : num(p.avg_ram_pct),
    peakConnections: p.peak_connections === undefined ? null : num(p.peak_connections),
    pitrDays: num(p.pitr_days),
    branchHours: num(p.branch_hours),
    logDrains: num(p.log_drains),
    customDomain: Boolean(p.custom_domain)
  }));
  return {
    org: d.org || "",
    plan: String(d.plan || "pro").toLowerCase(),
    spendCap: d.spend_cap === undefined ? null : Boolean(d.spend_cap),
    month: d.month || "",
    projects
  };
}

// Days covered by a set of lines (for scaling to a 30-day month).
export function periodDays(lines) {
  let min = Infinity, max = -Infinity;
  for (const l of lines) {
    const s = Date.parse(l.start), e = Date.parse(l.end);
    if (Number.isFinite(s)) min = Math.min(min, s);
    if (Number.isFinite(e)) max = Math.max(max, e);
    else if (Number.isFinite(s)) max = Math.max(max, s + 86400000);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return Math.max(1, Math.round((max - min) / 86400000));
}
