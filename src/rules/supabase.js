import { money, rate, finding, sum } from "../util.js";

// Org compute cost: each project pays its compute; Pro/Team include a monthly compute credit.
export function orgCompute(projects, P) {
  const s = P.supabase;
  const gross = sum(projects, (p) => s.compute_month[p.compute] ?? s.compute_month.micro);
  return Math.max(0, gross - Math.min(gross, s.compute_credit_month));
}

export function supabaseMonthly(snap, P) {
  const s = P.supabase;
  const plan = snap.plan === "team" ? s.team_plan_month : snap.plan === "free" ? 0 : s.pro_plan_month;
  if (snap.plan === "free") return { plan: 0, compute: 0, extras: 0, total: 0 };
  const compute = orgCompute(snap.projects, P);
  let extras = 0;
  for (const p of snap.projects) {
    extras += Math.max(0, p.egressGb - s.egress_included_gb) * s.egress_per_gb;
    extras += Math.max(0, p.cachedEgressGb - s.cached_egress_included_gb) * s.cached_egress_per_gb;
    extras += Math.ceil(p.pitrDays / 7) * s.pitr_per_7_days_month;
    extras += p.branchHours * s.branch_per_hour;
    extras += p.logDrains * s.log_drain_month;
    extras += p.customDomain ? s.custom_domain_month : 0;
    extras += Math.max(0, p.dbSizeGb - s.disk_included_gb) * s.disk_per_gb;
  }
  return { plan, compute, extras, total: plan + compute + extras };
}

export function supabaseRules(snap, P, A) {
  const s = P.supabase;
  const src = s.source;
  const out = [];
  if (snap.plan === "free") return out;
  const all = snap.projects;
  const base = orgCompute(all, P);
  const without = (proj) => base - orgCompute(all.filter((x) => x !== proj), P);

  if (snap.spendCap === false) {
    out.push(finding({
      id: "SUPABASE_SPEND_CAP_OFF", provider: "supabase", severity: "high",
      title: "Spend cap is off",
      saw: "Your Supabase org has the spend cap turned off.",
      why: "With the cap off, usage over your plan's quotas is billed with no ceiling. A bot, a bug or a viral day can run up the bill.",
      todo: ["Turn the spend cap back on unless you need to go over quotas, or set billing alerts you actually read."],
      saving: { amount: 0, kind: "none" },
      assumption: "This is a risk check, not a saving.",
      source: src
    }));
  }

  for (const p of all) {
    const price = s.compute_month[p.compute] ?? s.compute_month.micro;
    const idle = (p.requests30d !== null && p.requests30d <= A.idle_requests_30d) ||
      (p.daysSinceLastRequest !== null && p.daysSinceLastRequest >= A.idle_days);
    if (idle) {
      out.push(finding({
        id: "SUPABASE_IDLE_PROJECT", provider: "supabase", severity: "high",
        title: `Idle project: ${p.name}`,
        saw: `"${p.name}" (${p.compute}, ${money(price)}/mo compute) had ${p.requests30d ?? "?"} requests in 30 days${p.daysSinceLastRequest !== null ? `, last one ${p.daysSinceLastRequest} days ago` : ""}.`,
        why: "Projects on paid plans are never paused, so an abandoned test or old version keeps billing compute every hour.",
        todo: ["Back it up (pg_dump), then pause or delete it.", "If it's a dev copy, use a free org or a branch you delete after use."],
        monthlyCost: price,
        saving: { amount: without(p), kind: "estimate" },
        assumption: "Saving is this project's compute after your org's $10 compute credit is re-applied to the remaining projects.",
        source: src
      }));
      continue;
    }

    const order = s.compute_order;
    const idx = order.indexOf(p.compute);
    if (idx > 0 && p.environment === "production" && p.avgCpuPct !== null && p.avgRamPct !== null &&
        p.avgCpuPct < A.oversized_avg_cpu_pct && (p.peakCpuPct ?? 0) < A.oversized_peak_cpu_pct && p.avgRamPct < A.oversized_avg_ram_pct) {
      const down = order[idx - 1];
      const saving = (s.compute_month[p.compute] - s.compute_month[down]);
      out.push(finding({
        id: "SUPABASE_OVERSIZED_COMPUTE", provider: "supabase", severity: "high",
        title: `Oversized database: ${p.name} on ${p.compute.toUpperCase()}`,
        saw: `"${p.name}" runs ${p.compute} (${money(s.compute_month[p.compute])}/mo) at ${p.avgCpuPct}% average CPU${p.peakCpuPct !== null ? `, ${p.peakCpuPct}% peak` : ""} and ${p.avgRamPct}% RAM.`,
        why: `The next size down, ${down} (${s.compute_ram_gb[down]} GB RAM), is ${rate(s.compute_month[down])}/mo on Supabase's price list. Instances are often upsized during a launch scare and never brought back.`,
        todo: [`Check 30 days of CPU, RAM and connection peaks in Reports > Database first.`, `Downsize to ${down} in Settings > Compute and Disk at a quiet time (it restarts the database).`, "Watch it for a week; scale back up if needed."],
        monthlyCost: s.compute_month[p.compute],
        saving: { amount: saving, kind: "estimate" },
        assumption: `Rule: average CPU under ${A.oversized_avg_cpu_pct}%, peak under ${A.oversized_peak_cpu_pct}% and RAM under ${A.oversized_avg_ram_pct}%. Smaller sizes also allow fewer connections; check your peak.`,
        source: src
      }));
    }

    if (["dev", "development", "staging", "test", "preview"].includes(p.environment)) {
      out.push(finding({
        id: "SUPABASE_DEV_ON_PAID", provider: "supabase", severity: "medium",
        title: `Non-production project on a paid org: ${p.name}`,
        saw: `"${p.name}" is marked ${p.environment} and pays ${money(price)}/mo compute in your paid org.`,
        why: "Supabase's Free plan allows two active projects, and branches on Pro are billed by the hour, so a full-time dev project is often the most expensive option.",
        todo: ["Move dev/test to a free org, or use a branch you delete after each feature."],
        monthlyCost: price,
        saving: { amount: without(p), kind: "up_to" },
        assumption: "Upper bound: free projects pause after a week of inactivity and have smaller limits. A branch you keep running costs about $9.81/mo.",
        source: src
      }));
    }

    if (p.pitrDays > 0) {
      const cost = Math.ceil(p.pitrDays / 7) * s.pitr_per_7_days_month;
      out.push(finding({
        id: "SUPABASE_PITR", provider: "supabase", severity: p.environment === "production" ? "low" : "medium",
        title: `Point-in-time recovery on ${p.name}`,
        saw: `PITR (${p.pitrDays} days) costs ${money(cost)}/mo on "${p.name}" (${p.dbSizeGb} GB database).`,
        why: "Pro already includes daily backups kept for 7 days. PITR lets you restore to any second, which matters for busy production data, not for small or test databases.",
        todo: ["Keep PITR if losing a day of data would hurt customers.", "Otherwise rely on daily backups plus your own off-site pg_dump, and test a restore."],
        monthlyCost: cost,
        saving: { amount: cost, kind: "up_to" },
        assumption: "Only a saving if a day of data loss is acceptable. This is a business decision, not a technical one.",
        source: src
      }));
    }

    if (p.branchHours > 0) {
      const cost = p.branchHours * s.branch_per_hour;
      if (cost >= A.min_line_cost) out.push(finding({
        id: "SUPABASE_BRANCHES", provider: "supabase", severity: "low",
        title: `Preview branches left running on ${p.name}`,
        saw: `${Math.round(p.branchHours)} branch-hours this month (${money(cost)}).`,
        why: `Branches are billed ${rate(s.branch_per_hour)} per branch per hour while they exist.`,
        todo: ["Delete branches when the pull request merges; turn on automatic branch cleanup."],
        monthlyCost: cost,
        saving: { amount: cost * A.branch_waste_share, kind: "estimate" },
        assumption: `Assumes ${Math.round(A.branch_waste_share * 100)}% of branch-hours were stale branches.`,
        source: src
      }));
    }

    if (p.logDrains > 0) {
      const cost = p.logDrains * s.log_drain_month;
      out.push(finding({
        id: "SUPABASE_LOG_DRAINS", provider: "supabase", severity: "low",
        title: `${p.logDrains} log drain(s) on ${p.name}`,
        saw: `Log drains cost at least ${money(cost)}/mo before events and egress.`,
        why: `Each drain is ${rate(s.log_drain_month)}/mo per project on Supabase's price list.`,
        todo: ["Keep one drain to the tool you actually look at; remove the rest."],
        monthlyCost: cost,
        saving: { amount: Math.max(0, p.logDrains - 1) * s.log_drain_month, kind: "up_to" },
        assumption: "Assumes you keep one drain.",
        source: src
      }));
    }

    const over = p.egressGb - s.egress_included_gb;
    if (over > 0) {
      const cost = over * s.egress_per_gb;
      out.push(finding({
        id: "SUPABASE_EGRESS", provider: "supabase", severity: cost > 50 ? "high" : "medium",
        title: `Egress overage on ${p.name}`,
        saw: `${Math.round(p.egressGb)} GB egress, ${Math.round(over)} GB over the ${s.egress_included_gb} GB included (${money(cost)}/mo).`,
        why: `Uncached egress is ${rate(s.egress_per_gb)}/GB and cached egress is ${rate(s.cached_egress_per_gb)}/GB. Usual causes: \`select *\` on big tables, no pagination, and serving files without the CDN cache.`,
        todo: ["Select only the columns you show and paginate lists.", "Serve public files through Storage's CDN with cache headers.", "Cache repeated reads in your app."],
        monthlyCost: cost,
        saving: { amount: over * A.egress_cacheable_share * (s.egress_per_gb - s.cached_egress_per_gb), kind: "estimate" },
        assumption: `Assumes ${Math.round(A.egress_cacheable_share * 100)}% of the overage can move to cached egress. Trimming queries can save more.`,
        source: src
      }));
    }
  }
  return out;
}
