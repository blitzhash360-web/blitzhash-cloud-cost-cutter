# Prices used and how savings are worked out

All list prices live in [src/pricing.json](../src/pricing.json), with the date they were checked (`checked`). Every finding in a report prints the page it came from.

**Checked: 2026-11-10.** Prices are USD, before tax, and change over time. If a page below shows a different number, the page wins. Pull requests that update `src/pricing.json` with the new date are welcome.

| Provider | Page | Used for |
|---|---|---|
| Vercel | <https://vercel.com/pricing> | Pro seats ($20/mo developer, viewer seats free), build minutes (Standard $0.014, Enhanced $0.028, Turbo $0.105 per minute), Fast Data Transfer (1 TB included, then from $0.15/GB), ISR reads/writes, add-ons |
| Supabase | <https://supabase.com/pricing> | Pro $25/mo with $10 compute credit, compute sizes (Micro $10 to 16XL $3,730), egress ($0.09/GB, cached $0.03/GB, 250 GB each included), PITR ($100/mo per 7 days), branching ($0.01344/branch-hour), log drains ($60/mo) |
| AWS | <https://aws.amazon.com/vpc/pricing/> | Public IPv4 ($0.005/hour, in-use or idle), NAT gateway ($0.045/hour + $0.045/GB, US East example), data transfer out example ($0.09/GB) |
| AWS | <https://aws.amazon.com/ebs/pricing/> | gp3 $0.08 vs gp2 $0.10 per GB-month (example region) |
| AWS | <https://aws.amazon.com/lambda/pricing/> | Provisioned concurrency explanation |
| Self-host | <https://www.digitalocean.com/pricing/droplets> | One public example of plain VPS prices (Basic Droplets $12 to $96/mo, weekly backups 20% of the Droplet price) |
| Self-host | <https://supabase.com/docs/guides/self-hosting/docker> | Self-hosted Supabase system requirements (4 GB RAM minimum, 8 GB+ recommended) |

## Three kinds of saving

- **Estimate (`~$`)**: worked out from your own bill lines and the list prices above, with the assumption printed next to it. Example: an idle public IP's saving is exactly what it cost you.
- **Upper bound (`up to $`)**: what you would save if you turned the thing off completely. Only real if you don't need it (extra seats, PITR, add-ons).
- **No number (`-`)**: we can see the cost but not the cause (bandwidth, images, snapshots). The report says what to look at instead of inventing a figure.

The headline "estimated" total adds up only estimates. The "up to" total adds upper bounds on top. Some fixes overlap (downsizing a database and then self-hosting it), so treat totals as a ceiling, not a promise.

## Assumptions you can change

Run `cost-cutter --list-assumptions` to see them all. Change any with `--assume key=value`:

| Key | Default | Meaning |
|---|---|---|
| `functions_cacheable_share` | 0.3 | Share of Vercel function cost that caching and fixes remove |
| `functions_share_flag` | 0.3 | Flag functions when they are at least this share of Vercel usage |
| `egress_cacheable_share` | 0.5 | Share of Supabase egress overage that can move to cached egress |
| `branch_waste_share` | 0.5 | Share of Supabase branch-hours that were stale branches |
| `oversized_avg_cpu_pct` / `oversized_peak_cpu_pct` / `oversized_avg_ram_pct` | 25 / 60 / 50 | Below all three, a production database is flagged as one size too big |
| `idle_days` / `idle_requests_30d` | 14 / 0 | When a Supabase project counts as idle |
| `nat_low_traffic_gb` | 10 | NAT gateway "almost no traffic" threshold per month |
| `selfhost_min_spend` | 100 | Only show the self-hosting estimate above this monthly spend |
| `min_line_cost` | 1 | Ignore bill lines under this many dollars a month |

## What the self-hosting estimate is (and isn't)

It compares your monthly Vercel + Supabase spend with the list price of one VPS big enough for self-hosted Supabase plus your app, with weekly backups. It does **not** include engineering time, someone on call, off-site backup storage, a CDN, monitoring, or the work to replace managed features. For many small apps those costs are larger than the server. It's a "worth a conversation?" number, not a plan.
