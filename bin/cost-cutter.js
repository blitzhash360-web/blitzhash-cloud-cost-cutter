#!/usr/bin/env node
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { analyze, DEFAULT_ASSUMPTIONS } from "../src/analyze.js";
import { renderText, renderMarkdown } from "../src/report.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(import.meta.url)("../package.json");
const DEMO = ["vercel-focus.jsonl", "supabase-usage.json", "aws-focus.csv"].map((f) => join(here, "..", "fixtures", "demo", f));

const HELP = `BlitzHash Cloud Cost Cutter v${pkg.version}
Find waste in your Vercel, Supabase and AWS bills from export files. Nothing is uploaded; no keys needed.

Usage:
  cost-cutter --demo                      run on the sample files
  cost-cutter <file> [file...]            your exports (CSV, JSON or JSONL)

Files it understands (see docs/EXPORTS.md):
  Vercel   FOCUS JSONL from /v1/billing/charges, or \`vercel billing usage --json\`
  Supabase templates/supabase-usage.template.json (copy numbers from the Usage page)
  AWS      FOCUS export or Cost and Usage Report (CUR) CSV
  Any      templates/usage-template.csv

Options:
  --brief              summary table only
  --top <n>            show only the top n findings
  --json               machine-readable output
  --markdown <file>    also write a Markdown report
  --assume key=value   change an assumption (repeatable), e.g. --assume functions_cacheable_share=0.2
  --list-assumptions   print assumptions and defaults
  --no-color           plain text
  -h, --help | -v, --version
`;

function main(argv) {
  const files = [];
  const assume = {};
  let json = false, brief = false, top = 0, md = null, color = process.stdout.isTTY && !process.env.NO_COLOR;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { process.stdout.write(HELP); return 0; }
    if (a === "-v" || a === "--version") { console.log(pkg.version); return 0; }
    if (a === "--demo") files.push(...DEMO);
    else if (a === "--json") json = true;
    else if (a === "--brief") brief = true;
    else if (a === "--top") { top = parseInt(argv[++i], 10); if (!(top > 0)) { console.error("--top needs a number"); return 2; } }
    else if (a === "--no-color") color = false;
    else if (a === "--color") color = true;
    else if (a === "--markdown") md = argv[++i];
    else if (a === "--assume") {
      const [k, v] = String(argv[++i] || "").split("=");
      if (!(k in DEFAULT_ASSUMPTIONS) || v === undefined || !Number.isFinite(Number(v))) {
        console.error(`Unknown or invalid assumption "${k}". Run --list-assumptions.`); return 2;
      }
      assume[k] = Number(v);
    } else if (a === "--list-assumptions") {
      for (const [k, v] of Object.entries(DEFAULT_ASSUMPTIONS)) console.log(`${k}=${v}`);
      return 0;
    } else if (a.startsWith("-")) { console.error(`Unknown option ${a}\n`); process.stderr.write(HELP); return 2; }
    else files.push(a);
  }
  if (!files.length) { process.stdout.write(HELP); return 2; }
  for (const f of files) if (!existsSync(f)) { console.error(`File not found: ${f}`); return 2; }
  let r;
  try { r = analyze(files, { assume }); } catch (e) { console.error(e.message); return 2; }
  if (md) writeFileSync(md, renderMarkdown(r));
  if (json) console.log(JSON.stringify(r, null, 2));
  else console.log(renderText(r, { color, brief, top }));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
