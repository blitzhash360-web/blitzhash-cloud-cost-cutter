import { match, sum, money, rate, finding } from "../util.js";

export function vercelRules(lines, P, A) {
  const p = P.vercel;
  const src = p.source;
  const out = [];
  // Usage-based spend only (exclude seats/plan fees) for share calculations.
  const usage = sum(lines.filter((l) => !/seat|plan fee|subscription|pro plan/i.test(`${l.service} ${l.sku}`)), (l) => l.cost);

  // Developer seats: viewers are free on Pro.
  const seatLines = match(lines, /developer seat|\bseats?\b/);
  if (seatLines.length) {
    const cost = sum(seatLines, (l) => l.cost);
    const seats = Math.max(Math.round(sum(seatLines, (l) => l.quantity)), Math.round(cost / p.developer_seat_month));
    if (seats > 1) {
      out.push(finding({
        id: "VERCEL_EXTRA_SEATS", provider: "vercel", severity: "medium",
        title: `${seats} paid developer seats`,
        saw: `You pay for ${seats} developer seats (${money(cost)}/mo).`,
        why: `Each developer seat on Pro is ${rate(p.developer_seat_month)}/mo. People who only look at dashboards, analytics or previews can be Viewer seats, which Vercel lists as free on Pro.`,
        todo: ["In Team Settings > Members, switch anyone who never deploys or changes settings to the Viewer role."],
        monthlyCost: cost,
        saving: { amount: (seats - 1) * p.developer_seat_month, kind: "up_to" },
        assumption: "Upper bound: assumes everyone except one person only needs to view. Count only the seats that really don't deploy.",
        source: src
      }));
    }
  }

  // Expensive build machines.
  const buildLines = match(lines, /build/, /cpu minute|vercel ci/).filter((l) => /enhanced|turbo/.test(`${l.service} ${l.sku} ${l.description}`.toLowerCase()));
  const buildCost = sum(buildLines, (l) => l.cost);
  if (buildCost >= A.min_line_cost) {
    let saving = 0;
    for (const l of buildLines) {
      const tier = /turbo/i.test(`${l.service} ${l.sku} ${l.description}`) ? "turbo" : "enhanced";
      saving += l.cost * (1 - p.build_minute.standard / p.build_minute[tier]);
    }
    out.push(finding({
      id: "VERCEL_BUILD_MACHINES", provider: "vercel", severity: "medium",
      title: "Builds run on Enhanced/Turbo machines",
      saw: `Build minutes on bigger machines cost ${money(buildCost)}/mo.`,
      why: `Vercel lists Standard build minutes at ${rate(p.build_minute.standard)}/min, Enhanced at ${rate(p.build_minute.enhanced)}/min and Turbo at ${rate(p.build_minute.turbo)}/min. Small apps rarely need the big machines.`,
      todo: ["Try Standard machines on one project and compare build times.", "Skip builds for commits that don't touch the app (Ignored Build Step)."],
      monthlyCost: buildCost,
      saving: { amount: saving, kind: "estimate" },
      assumption: "Assumes the same number of build minutes on Standard machines. Builds may take longer on smaller machines, which uses more minutes.",
      source: src
    }));
  }

  // Paid add-ons you may not use.
  const addons = [
    [/observability plus|observability event/, "Observability Plus"],
    [/speed insights plus|speed insights/, "Speed Insights Plus"],
    [/web analytics plus/, "Web Analytics Plus"],
    [/password protection/, "Password Protection"],
    [/static ip/, "Static IPs"],
    [/saml|single sign-on|\bsso\b/, "SAML SSO"],
    [/hipaa/, "HIPAA BAA"],
    [/preview deployment suffix/, "Preview Deployment Suffix"],
    [/drain/, "Drains"]
  ];
  for (const [re, name] of addons) {
    const ls = match(lines, re);
    const cost = sum(ls, (l) => l.cost);
    if (cost >= A.min_line_cost) {
      out.push(finding({
        id: "VERCEL_ADDON", provider: "vercel", severity: "low",
        title: `Paid add-on: ${name}`,
        saw: `${name} costs ${money(cost)}/mo.`,
        why: "Add-ons are easy to switch on during a launch and forget. If nobody uses it, it is pure cost.",
        todo: [`Ask who uses ${name}. If nobody, turn it off in the project or team settings.`],
        monthlyCost: cost,
        saving: { amount: cost, kind: "up_to" },
        assumption: "Only a saving if you don't need it. Keep it if it protects users or you rely on the data.",
        source: src
      }));
    }
  }

  // Bandwidth (Fast Data Transfer) overage.
  const fdt = match(lines, /fast data transfer/);
  const fdtCost = sum(fdt, (l) => l.cost);
  const fdtGb = sum(fdt, (l) => (/gb/i.test(l.unit) ? l.quantity : 0));
  if (fdtCost >= A.min_line_cost) {
    out.push(finding({
      id: "VERCEL_BANDWIDTH", provider: "vercel", severity: fdtCost > 100 ? "high" : "medium",
      title: "Paying for bandwidth over the included amount",
      saw: `Fast Data Transfer costs ${money(fdtCost)}/mo${fdtGb ? ` (${Math.round(fdtGb).toLocaleString("en-US")} GB)` : ""}.`,
      why: `Pro includes ${p.fast_data_transfer_included_gb.toLocaleString("en-US")} GB/mo, then Vercel lists it from ${rate(p.fast_data_transfer_per_gb)}/GB. Big images, videos, downloads and bots are the usual causes.`,
      todo: ["Find the heavy paths in Usage > Fast Data Transfer (top paths).", "Serve large files (video, downloads) from object storage or a CDN built for them.", "Compress and resize images; block abusive bots with Firewall rules."],
      monthlyCost: fdtCost,
      saving: { amount: 0, kind: "none" },
      assumption: "We can't tell from billing data which files are heavy, so no saving is estimated.",
      source: src
    }));
  }

  // Functions.
  const cpu = sum(match(lines, /active cpu/, /sandbox|daemon/), (l) => l.cost);
  const mem = sum(match(lines, /provisioned memory|gb-hr|function duration/, /sandbox|daemon/), (l) => l.cost);
  const inv = sum(match(lines, /function invocation/), (l) => l.cost);
  const fnCost = cpu + mem + inv;
  if (fnCost >= A.min_line_cost && usage > 0 && fnCost / usage >= A.functions_share_flag) {
    const waiting = mem > cpu * 3 && cpu > 0;
    out.push(finding({
      id: "VERCEL_FUNCTIONS", provider: "vercel", severity: "high",
      title: "Server functions are your biggest Vercel cost",
      saw: `Functions cost ${money(fnCost)}/mo, ${Math.round((fnCost / usage) * 100)}% of your Vercel usage.${waiting ? ` Memory time (${money(mem)}) is more than 3x CPU time (${money(cpu)}): your functions mostly wait on a database or an API.` : ""}`,
      why: "Every uncached page or API call runs a function. Slow database calls, calls made one after another, and pages that could be cached all add up.",
      todo: [
        "Cache pages and API responses that are the same for everyone.",
        waiting ? "Run independent database/API calls in parallel and add timeouts." : "Check the slowest routes in Observability first.",
        "Move long background jobs (emails, AI calls, imports) to a queue or worker."
      ],
      monthlyCost: fnCost,
      saving: { amount: fnCost * A.functions_cacheable_share, kind: "estimate" },
      assumption: `Assumes caching and fixes remove ${Math.round(A.functions_cacheable_share * 100)}% of function cost (change with --assume functions_cacheable_share=0.2). Real results depend on your code.`,
      source: src
    }));
  }

  // Image Optimization.
  const img = sum(match(lines, /image optimization|image transformation/), (l) => l.cost);
  if (img >= A.min_line_cost) {
    out.push(finding({
      id: "VERCEL_IMAGES", provider: "vercel", severity: "low",
      title: "Image optimization charges",
      saw: `Image Optimization costs ${money(img)}/mo.`,
      why: "Each new image size or format is a paid transformation. Lots of sizes, remote images from anywhere, or SVGs going through the optimizer drive this up.",
      todo: ["Limit `images.remotePatterns` to your own domains.", "Use fewer `sizes`/`deviceSizes`.", "Mark SVGs and tiny icons `unoptimized`."],
      monthlyCost: img,
      saving: { amount: 0, kind: "none" },
      assumption: "Saving depends on how many transformations you can avoid, so none is estimated.",
      source: src
    }));
  }

  // ISR writes > reads.
  const isrW = sum(match(lines, /isr write/), (l) => l.cost);
  const isrR = sum(match(lines, /isr read/), (l) => l.cost);
  if (isrW >= A.min_line_cost && isrW > isrR) {
    out.push(finding({
      id: "VERCEL_ISR_WRITES", provider: "vercel", severity: "low",
      title: "Pages are re-generated more often than they are read",
      saw: `ISR writes cost ${money(isrW)}/mo vs ISR reads ${money(isrR)}/mo.`,
      why: `Vercel lists ISR writes at ${rate(p.isr_writes_per_million)} per 1M vs reads at ${rate(p.isr_reads_per_million)} per 1M. A very short revalidate time re-builds pages nobody has looked at yet.`,
      todo: ["Raise `revalidate` times, or revalidate on demand when data really changes."],
      monthlyCost: isrW,
      saving: { amount: 0, kind: "none" },
      assumption: "",
      source: src
    }));
  }

  // Deployment storage.
  const dep = sum(match(lines, /deployment storage/), (l) => l.cost);
  if (dep >= A.min_line_cost) {
    out.push(finding({
      id: "VERCEL_DEPLOY_STORAGE", provider: "vercel", severity: "low",
      title: "Paying to keep old deployments",
      saw: `Deployment storage costs ${money(dep)}/mo.`,
      why: "Every old deployment is kept for rollback until a retention policy removes it.",
      todo: ["Set a Deployment Retention Policy (for example, keep previews for 30 days)."],
      monthlyCost: dep,
      saving: { amount: dep, kind: "up_to" },
      assumption: "Upper bound. You will keep some deployments for rollback.",
      source: src
    }));
  }

  return out;
}
