import { money } from "./util.js";

const NAMES = { vercel: "Vercel", supabase: "Supabase", aws: "AWS", selfhost: "Self-host", other: "Other" };
const CTA = "Built by BlitzHash: need a senior team to check or scale your AI-built app? Free assessment at https://blitzhash.com";

function colors(on) {
  const w = (c) => (s) => (on ? `\x1b[${c}m${s}\x1b[0m` : String(s));
  return { bold: w("1"), dim: w("2"), red: w("31"), yellow: w("33"), green: w("32"), cyan: w("36"), magenta: w("35"), blue: w("34") };
}

const savingText = (s) => s.kind === "estimate" ? `~${money(s.amount)}` : s.kind === "up_to" ? `up to ${money(s.amount)}` : "-";
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + "…" : s + " ".repeat(n - s.length); };
const lpad = (s, n) => { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; };

function wrap(textIn, width, indent) {
  const words = String(textIn).split(/\s+/);
  const out = [];
  let lineStr = "";
  for (const w of words) {
    if ((lineStr + " " + w).trim().length > width) { out.push(lineStr); lineStr = w; }
    else lineStr = (lineStr + " " + w).trim();
  }
  if (lineStr) out.push(lineStr);
  return out.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
}

export function renderText(r, { color = true, brief = false, top = 0 } = {}) {
  const c = colors(color);
  const sev = (s) => ({ high: c.red("HIGH"), medium: c.yellow("MED "), low: c.cyan("LOW "), info: c.blue("INFO") })[s];
  const L = [];
  L.push(`${c.bold(c.green("BlitzHash Cloud Cost Cutter"))}  ${c.dim(`prices checked ${r.pricingChecked} · estimates, not quotes`)}`);
  L.push("");
  L.push(`${c.dim("Read:")} ${r.files.map((f) => `${f.file} ${c.dim(`(${f.projects ? `${f.projects} project${f.projects === 1 ? "" : "s"}` : `${f.lines} lines`})`)}`).join(" · ")}`);
  const spendParts = Object.entries(r.spend).map(([k, v]) => `${NAMES[k] || k} ${money(v)}`);
  L.push(`${c.dim("Monthly spend:")} ${spendParts.join(" · ")} · ${c.bold(`Total ${money(r.totalMonthly)}`)}`);
  L.push("");
  if (!r.findings.length) {
    L.push(c.green("No cost flags found in these files. Nice."));
  } else {
    if (r.savings.upTo > 0) L.push(`${c.bold("Possible savings:")} ${c.green(c.bold(`~${money(r.savings.estimate)}/mo`))} estimated, ${c.bold(`up to ${money(r.savings.upTo)}/mo`)} if you also drop what you don't need`);
    else L.push(`${c.bold(`${r.findings.length} thing${r.findings.length === 1 ? "" : "s"} to look at.`)} Billing data alone can't put a number on ${r.findings.length === 1 ? "it" : "them"}; see what to check below.`);
    L.push("");
    L.push(c.dim(`${pad("#", 3)}${pad("", 5)}${pad("Finding", 54)}${lpad("Now/mo", 10)}${lpad("Save/mo", 18)}`));
    const shown = top ? r.findings.slice(0, top) : r.findings;
    shown.forEach((f, i) => {
      const save = savingText(f.saving);
      L.push(`${pad(i + 1, 3)}${sev(f.severity)} ${pad(`${NAMES[f.provider]}: ${f.title}`, 54)}${lpad(f.monthlyCost ? money(f.monthlyCost) : "-", 10)}${lpad(f.saving.kind === "none" ? c.dim(save) : c.green(save), f.saving.kind === "none" ? 18 + (color ? 8 : 0) : 18 + (color ? 9 : 0))}`);
    });
    if (shown.length < r.findings.length) L.push(c.dim(`   …and ${r.findings.length - shown.length} more (run without --top to see all)`));
  }
  if (r.selfhost) {
    L.push("");
    L.push(`${c.bold("Self-hosting estimate:")} ${wrap(r.selfhost.saw, 76, "  ")}`);
    L.push(`  ${c.dim(wrap(`Infrastructure only, excludes engineering time.${brief ? " Run without --brief for the details." : " Details at the end."}`, 92, "  "))}`);
  }
  if (!brief) {
    (top ? r.findings.slice(0, top) : r.findings).forEach((f, i) => {
      L.push("");
      L.push(`${c.bold(`${i + 1}. ${f.title}`)} ${c.dim(`[${NAMES[f.provider]} · ${f.id}]`)}`);
      L.push(`   ${c.dim("Saw:")}  ${wrap(f.saw, 88, "         ")}`);
      L.push(`   ${c.dim("Why:")}  ${wrap(f.why, 88, "         ")}`);
      for (const t of f.todo) L.push(`   ${c.green("→")}     ${wrap(t, 88, "         ")}`);
      if (f.saving.kind !== "none") L.push(`   ${c.dim("Save:")} ${c.green(savingText(f.saving) + "/mo")} ${c.dim(`(${f.saving.kind === "up_to" ? "upper bound" : "estimate"})`)}`);
      if (f.assumption) L.push(`   ${c.dim("Note:")} ${c.dim(wrap(f.assumption, 88, "         "))}`);
      L.push(`   ${c.dim("Price source:")} ${c.dim(f.source)}`);
    });
    if (r.selfhost) {
      const f = r.selfhost;
      L.push("");
      L.push(`${c.bold(f.title)}`);
      L.push(`   ${c.dim("Saw:")}  ${wrap(f.saw, 88, "         ")}`);
      L.push(`   ${c.dim("Why:")}  ${wrap(f.why, 88, "         ")}`);
      for (const t of f.todo) L.push(`   ${c.green("→")}     ${wrap(t, 88, "         ")}`);
      L.push(`   ${c.dim("Save:")} ${c.green(savingText(f.saving) + "/mo")} ${c.dim("(upper bound, not counted in the totals above)")}`);
      L.push(`   ${c.dim("Note:")} ${c.dim(wrap(f.assumption, 88, "         "))}`);
    }
    L.push("");
    L.push(c.dim(wrap("Savings are estimates from your export and public list prices checked on " + r.pricingChecked + ". They are not quotes, overlap in places, and exclude taxes, discounts and credits. Check each change before you make it.", 100, "")));
  }
  L.push("");
  L.push(c.bold(CTA));
  return L.join("\n");
}

export function renderMarkdown(r) {
  const L = [];
  L.push(`# Cloud cost report`, "");
  L.push(`Prices checked ${r.pricingChecked}. Estimates, not quotes.`, "");
  L.push(`**Monthly spend (30-day):** ${Object.entries(r.spend).map(([k, v]) => `${NAMES[k] || k} ${money(v)}`).join(", ")}. **Total ${money(r.totalMonthly)}**`, "");
  L.push(`**Possible savings:** ~${money(r.savings.estimate)}/mo estimated, up to ${money(r.savings.upTo)}/mo if you also drop what you don't need.`, "");
  L.push("| # | Severity | Finding | Now/mo | Save/mo |", "|---|---|---|---:|---:|");
  r.findings.forEach((f, i) => L.push(`| ${i + 1} | ${f.severity} | ${NAMES[f.provider]}: ${f.title} | ${f.monthlyCost ? money(f.monthlyCost) : "-"} | ${savingText(f.saving)} |`));
  for (const [i, f] of [...r.findings, ...(r.selfhost ? [r.selfhost] : [])].entries()) {
    L.push("", `## ${i + 1}. ${f.title}`, "", `- **Saw:** ${f.saw}`, `- **Why:** ${f.why}`);
    for (const t of f.todo) L.push(`- **Do:** ${t}`);
    if (f.saving.kind !== "none") L.push(`- **Saving:** ${savingText(f.saving)}/mo (${f.saving.kind === "up_to" ? "upper bound" : "estimate"})`);
    if (f.assumption) L.push(`- **Assumption:** ${f.assumption}`);
    L.push(`- **Price source:** ${f.source}`);
  }
  L.push("", "---", "", CTA, "");
  return L.join("\n");
}
