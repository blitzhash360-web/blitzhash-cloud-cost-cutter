import { money, finding, sum } from "../util.js";

// Rough infrastructure-only comparison: managed Vercel + Supabase spend vs one plain VPS.
export function selfhostEstimate({ vercelMonthly, supabase, snap }, P, A) {
  const s = P.selfhost;
  const current = vercelMonthly + (supabase ? supabase.total : 0);
  if (current < A.selfhost_min_spend) return null;
  const prodRam = snap ? Math.max(0, ...snap.projects.filter((p) => p.environment === "production").map((p) => P.supabase.compute_ram_gb[p.compute] || 1)) : 0;
  const need = Math.max(s.supabase_recommended_ram_gb, prodRam * 2);
  const box = s.droplets.find((d) => d.ram_gb >= need) || s.droplets[s.droplets.length - 1];
  const vps = box.month * (1 + s.weekly_backup_share);
  const saving = current - vps;
  if (saving <= 0) return null;
  return finding({
    id: "SELFHOST_ESTIMATE", provider: "selfhost", severity: "info",
    title: "Self-hosting estimate (infrastructure only)",
    saw: `Vercel + Supabase cost about ${money(current)}/mo. One ${box.ram_gb} GB / ${box.vcpu} vCPU VPS with weekly backups lists at about ${money(vps)}/mo.`,
    why: `Self-hosted Supabase recommends ${s.supabase_recommended_ram_gb} GB+ RAM. Your app and database could share one server at this size (${s.label}).`,
    todo: [
      "Only consider this once costs are steady and someone owns the server: updates, backups you test, monitoring, security patches.",
      "Start with the database staying managed and move the app first, or the reverse. Not both on day one.",
      "Guide: https://github.com/blitzhash360-web/blitzhash-supabase-selfhost-kit"
    ],
    monthlyCost: current,
    saving: { amount: saving, kind: "up_to" },
    assumption: "Server price only. Excludes engineering time (often the biggest cost), off-site backup storage, extra bandwidth, a CDN, monitoring and your time on call. Managed features like PITR, branching and edge regions need work to replace.",
    source: s.source
  });
}
