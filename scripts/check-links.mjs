#!/usr/bin/env node
// Markdown link check, zero dependencies.
//   node scripts/check-links.mjs                 relative links + #anchors in every .md/.mdc (offline)
//   node scripts/check-links.mjs --external      also request every http(s) link
//   --root DIR    folder to scan (default: repo root)   --skip REGEX  ignore matching URLs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const root = resolve(opt("--root") ?? join(here, ".."));
const external = args.includes("--external");
const skip = opt("--skip") ? new RegExp(opt("--skip")) : null;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(md|mdc)$/.test(name)) acc.push(p);
  }
  return acc;
}

// GitHub-style heading slug
export function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

export function extract(text) {
  const links = [];
  const anchors = new Set();
  const counts = {};
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const s = slug(h[1]);
      const n = counts[s] ?? 0;
      anchors.add(n ? `${s}-${n}` : s);
      counts[s] = n + 1;
    }
    const clean = line.replace(/`[^`]*`/g, "");
    for (const m of clean.matchAll(/!?\[(?:[^\]]|\][^(])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push({ url: m[1], line: i + 1 });
    for (const m of clean.matchAll(/<(https?:\/\/[^>\s]+)>/g)) links.push({ url: m[1], line: i + 1 });
  });
  return { links, anchors };
}

async function probe(url) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const method of ["HEAD", "GET"]) {
      try {
        const res = await fetch(url, {
          method,
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
          headers: { "user-agent": "blitzhash-link-check (+https://github.com/blitzhash360-web/blitzhash-cloud-cost-cutter)" },
        });
        if (res.ok) return { ok: true, status: res.status };
        last = String(res.status);
        if ([404, 410].includes(res.status) && method === "GET") return { ok: false, status: res.status };
        if ([401, 403, 429, 999].includes(res.status) && method === "GET") return { ok: true, warn: true, status: res.status };
      } catch (e) {
        last = e.cause?.code ?? e.name ?? String(e);
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return { ok: false, status: last };
}

async function main() {
  const files = walk(root);
  const cache = new Map();
  const problems = [];
  const warnings = [];
  const ext = new Map();
  let count = 0;
  const anchorsOf = (p) => {
    if (!cache.has(p)) cache.set(p, extract(readFileSync(p, "utf8")).anchors);
    return cache.get(p);
  };
  for (const file of files) {
    const rel = relative(root, file);
    const { links } = extract(readFileSync(file, "utf8"));
    for (const { url, line } of links) {
      count++;
      if (skip?.test(url)) continue;
      if (/^https?:\/\//.test(url)) {
        if (!ext.has(url)) ext.set(url, []);
        ext.get(url).push(`${rel}:${line}`);
        continue;
      }
      if (/^(mailto:|tel:)/.test(url)) continue;
      const [pathPart, anchor] = url.split("#");
      const target = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart.split("?")[0])) : file;
      if (!target.startsWith(root)) problems.push(`${rel}:${line} link leaves the repo: ${url}`);
      else if (!existsSync(target)) problems.push(`${rel}:${line} missing file: ${url}`);
      else if (anchor && /\.(md|mdc)$/.test(target) && !anchorsOf(target).has(anchor.toLowerCase()))
        problems.push(`${rel}:${line} missing anchor #${anchor} in ${relative(root, target) || rel}`);
    }
  }
  if (external) {
    // Also check every price source and rule source URL used in reports.
    const srcFiles = [join(root, "src", "pricing.json"), ...readdirSync(join(root, "src", "rules")).map((f) => join(root, "src", "rules", f))];
    for (const f of srcFiles) {
      for (const m of readFileSync(f, "utf8").matchAll(/https:\/\/[^\s"'`)]+/g)) {
        const u = m[0].replace(/[.,]$/, "");
        if (!ext.has(u)) ext.set(u, [relative(root, f)]);
      }
    }
    const urls = [...ext.keys()];
    let i = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (i < urls.length) {
          const url = urls[i++];
          const r = await probe(url);
          const where = ext.get(url)[0];
          if (!r.ok) problems.push(`${where} ${url} -> ${r.status}`);
          else if (r.warn) warnings.push(`${where} ${url} -> ${r.status} (site blocks bots; not a failure)`);
        }
      }),
    );
  }
  for (const w of warnings) console.log(`warn  ${w}`);
  for (const p of problems) console.error(`FAIL  ${p}`);
  console.log(`${files.length} files, ${count} links, ${ext.size} external${external ? " checked" : " (skipped; use --external)"}.`);
  if (problems.length) {
    console.error(`${problems.length} broken link(s).`);
    process.exit(1);
  }
  console.log("OK: no broken links.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
