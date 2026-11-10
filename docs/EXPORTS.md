# Getting your usage files

The tool only reads files on your computer. It never logs in to Vercel, Supabase or AWS, and it needs no keys. You download the files; it reads them.

| Provider | Easiest file | Format the tool detects |
|---|---|---|
| Vercel | `vercel billing usage --json` | Vercel CLI JSON |
| Vercel | Billing charges API | FOCUS 1.3 JSONL |
| Supabase | Fill in the template from your dashboard | Supabase snapshot JSON |
| AWS | Data Exports, "FOCUS 1.2 with AWS columns" | FOCUS CSV (`.csv` or `.csv.gz`) |
| AWS | Cost and Usage Report (CUR or CUR 2.0) | CUR CSV (`.csv` or `.csv.gz`) |
| Anything | [templates/usage-template.csv](../templates/usage-template.csv) | Simple CSV |

Use one full month when you can. A file covering a calendar month (28 to 31 days) counts as one month. Other ranges are scaled to 30 days.

## Vercel

### Option A: Vercel CLI (2 minutes)

```bash
npm i -g vercel@latest
vercel login
vercel billing usage --since 2026-10-01 --until 2026-10-31 --json > vercel-usage.json
```

`vercel billing usage` needs Vercel CLI 65.11.0 or later (older versions call it `vercel usage`). You need the Owner, Member, Developer, Security, Billing or Enterprise Viewer role on the team. Docs: <https://vercel.com/docs/cli/usage>

### Option B: FOCUS billing charges API (more detail)

Create a token in Vercel account settings, then:

```bash
curl -sN "https://api.vercel.com/v1/billing/charges?teamId=YOUR_TEAM_ID&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Accept-Encoding: gzip" --compressed > vercel-focus.jsonl
```

Keep the token in your shell, not in a file you commit. Docs: <https://vercel.com/docs/rest-api/billing/list-focus-billing-charges>

## Supabase

Supabase shows usage in the dashboard. Copy the numbers into a copy of [templates/supabase-usage.template.json](../templates/supabase-usage.template.json):

| Field | Where to find it |
|---|---|
| `plan`, `spend_cap` | Organization > Billing |
| `compute` | Project > Settings > Compute and Disk (`micro`, `small`, `medium`, `large`, `xl`, ...) |
| `egress_gb`, `cached_egress_gb`, `storage_gb` | Organization > Usage, filtered to the project |
| `db_size_gb` | Organization > Usage > Database size |
| `avg_cpu_pct`, `peak_cpu_pct`, `avg_ram_pct`, `peak_connections` | Project > Reports > Database, last 30 days |
| `requests_30d`, `days_since_last_request` | Project home page (API requests) or Reports > API |
| `pitr_days`, `custom_domain` | Project > Settings > Add-ons |
| `branch_hours` | Organization > Usage > Branching compute hours |
| `log_drains` | Project > Settings > Log Drains |
| `environment` | Your label: `production`, `staging`, `dev`, `test` or `preview` |

Delete any field you don't know. The tool skips checks it can't do instead of guessing. Dashboard menu names were checked in November 2026 and can move.

## AWS

### Option A: Data Exports in FOCUS format

1. Open Billing and Cost Management > Data Exports > Create.
2. Choose **FOCUS 1.2 with AWS columns**, time granularity **Monthly**, format **CSV (GZIP)**, and an S3 bucket.
3. When the first delivery lands in the bucket, download the `.csv.gz` file. No need to unzip.

Docs: <https://docs.aws.amazon.com/cur/latest/userguide/table-dictionary-focus-1-2-aws-columns.html>

### Option B: Cost and Usage Report

If you already have a CUR (legacy or 2.0) in S3, download one month's CSV. Both the `lineItem/UsageType` and `line_item_usage_type` column styles work.

Not supported yet: the Cost Explorer "Download CSV" button (it drops the usage types the checks need).

## Any provider: simple CSV

Copy [templates/usage-template.csv](../templates/usage-template.csv) and fill in one row per bill line. Put the provider's wording in `service` and `metric` (for example `Build Minutes (Turbo)` or `PublicIPv4:IdleAddress`) so the checks can recognise it.

## Privacy

Exports can include project names, resource IDs and account IDs. The tool reads them locally and prints only what it found. Don't commit your real exports to a public repo. The `.gitignore` here has no rule for them, so keep them outside the project folder.
