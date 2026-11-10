import { match, sum, money, rate, finding } from "../util.js";

export function awsRules(lines, P, A) {
  const a = P.aws;
  const out = [];

  const idle = match(lines, /idleaddress|idle public ipv4|idle elastic ip|elasticip:idleaddress/);
  const idleCost = sum(idle, (l) => l.cost);
  if (idleCost > 0) {
    const n = new Set(idle.map((l) => l.resourceId).filter(Boolean)).size;
    out.push(finding({
      id: "AWS_IDLE_IPV4", provider: "aws", severity: "medium",
      title: "Idle public IP addresses",
      saw: `${n || "Some"} public IPv4 address${n === 1 ? "" : "es"} not attached to anything cost ${money(idleCost)}/mo.`,
      why: `AWS charges ${rate(a.public_ipv4_per_hour)}/hour for every public IPv4 address, used or idle. Idle ones do nothing.`,
      todo: ["EC2 > Elastic IPs: release addresses with no association (check DNS doesn't point at them first)."],
      monthlyCost: idleCost,
      saving: { amount: idleCost, kind: "estimate" },
      assumption: "Saving is the billed cost of these idle addresses.",
      source: a.sources.public_ipv4_and_nat
    }));
  }

  const natH = match(lines, /natgateway-hours|nat gateway.*hour|nat gateway-hour/);
  const natB = match(lines, /natgateway-bytes|nat gateway.*(gb|data processed)/);
  const natHCost = sum(natH, (l) => l.cost);
  const natGb = sum(natB, (l) => l.quantity);
  if (natHCost >= A.min_line_cost) {
    const quiet = natGb < A.nat_low_traffic_gb;
    out.push(finding({
      id: "AWS_NAT_GATEWAY", provider: "aws", severity: quiet ? "high" : "medium",
      title: quiet ? "NAT gateway running with almost no traffic" : "NAT gateway charges",
      saw: `NAT gateway hours cost ${money(natHCost)}/mo; ${Math.round(natGb)} GB went through it.`,
      why: `A NAT gateway costs about ${rate(a.nat_gateway_per_hour)}/hour just to exist, plus ${rate(a.nat_gateway_per_gb)}/GB processed (US East example). Traffic to S3 or DynamoDB can skip it with free gateway endpoints.`,
      todo: quiet
        ? ["Check what still needs outbound internet from private subnets. If nothing, delete the NAT gateway.", "Add S3/DynamoDB gateway endpoints so that traffic skips NAT."]
        : ["Add S3/DynamoDB gateway endpoints so that traffic skips NAT.", "Make sure you don't run one NAT per AZ in dev/staging."],
      monthlyCost: natHCost,
      saving: { amount: quiet ? natHCost : 0, kind: quiet ? "up_to" : "none" },
      assumption: quiet ? `Upper bound if nothing needs it (rule: under ${A.nat_low_traffic_gb} GB/mo processed). Deleting it cuts outbound internet for private subnets.` : "Saving depends on how much traffic can use endpoints.",
      source: a.sources.public_ipv4_and_nat
    }));
  }

  const gp2 = match(lines, /volumeusage\.gp2|\bgp2\b/);
  const gp2Cost = sum(gp2, (l) => l.cost);
  if (gp2Cost >= A.min_line_cost) {
    out.push(finding({
      id: "AWS_EBS_GP2", provider: "aws", severity: "medium",
      title: "Disks on older gp2 volumes",
      saw: `gp2 volumes cost ${money(gp2Cost)}/mo.`,
      why: `On AWS's EBS page, gp3 is ${rate(a.ebs_gp3_per_gb_month)}/GB-month vs gp2 ${rate(a.ebs_gp2_per_gb_month)}/GB-month in the example region, and gp3 includes 3,000 IOPS baseline.`,
      todo: ["Modify each volume to gp3 (online, no downtime). Check volumes over 1 TB that rely on gp2 burst IOPS."],
      monthlyCost: gp2Cost,
      saving: { amount: gp2Cost * (1 - a.ebs_gp3_per_gb_month / a.ebs_gp2_per_gb_month), kind: "estimate" },
      assumption: "Uses the gp3/gp2 price ratio from AWS's example region; your region's ratio may differ slightly.",
      source: a.sources.ebs
    }));
  }

  const snaps = sum(match(lines, /snapshotusage|ebs snapshot|snapshot storage/), (l) => l.cost);
  if (snaps >= A.min_line_cost) {
    out.push(finding({
      id: "AWS_SNAPSHOTS", provider: "aws", severity: "low",
      title: "Old disk snapshots piling up",
      saw: `EBS snapshots cost ${money(snaps)}/mo.`,
      why: "Snapshots are kept until someone deletes them. Snapshots of deleted volumes and old AMIs are common.",
      todo: ["Set a Data Lifecycle Manager or AWS Backup retention rule.", "Move long-term copies to the Snapshots Archive tier."],
      monthlyCost: snaps,
      saving: { amount: 0, kind: "none" },
      assumption: "We can't see snapshot ages in billing data, so no saving is estimated.",
      source: a.sources.ebs
    }));
  }

  const dto = match(lines, /datatransfer-out-bytes|data transfer out|to internet/, /nat/);
  const dtoCost = sum(dto, (l) => l.cost);
  if (dtoCost >= A.dto_flag_cost) {
    out.push(finding({
      id: "AWS_DATA_TRANSFER_OUT", provider: "aws", severity: "medium",
      title: "Data transfer out to the internet",
      saw: `Data transfer out costs ${money(dtoCost)}/mo.`,
      why: `AWS lists data out to the internet at around ${rate(a.data_transfer_out_per_gb)}/GB (first tier, US East example). Serving files and images straight from EC2 or S3 is the usual cause.`,
      todo: ["Put a CDN in front of static files and downloads.", "Compress responses and images."],
      monthlyCost: dtoCost,
      saving: { amount: 0, kind: "none" },
      assumption: "Saving depends on cache hit rate and CDN pricing, so none is estimated.",
      source: a.sources.public_ipv4_and_nat
    }));
  }

  const oldGen = match(lines, /boxusage:(t2|m4|c4|r4|m3|c3)\.|\b(t2|m4|c4|r4)\.(nano|micro|small|medium|large|xlarge|2xlarge)/);
  const oldCost = sum(oldGen, (l) => l.cost);
  if (oldCost >= A.min_line_cost) {
    const types = [...new Set(oldGen.map((l) => (`${l.usageType} ${l.description}`.match(/(t2|m4|c4|r4|m3|c3)\.[a-z0-9]+/i) || [""])[0]).filter(Boolean))];
    out.push(finding({
      id: "AWS_OLD_INSTANCE_TYPES", provider: "aws", severity: "low",
      title: "Previous-generation server types",
      saw: `${types.join(", ") || "Older instance types"} cost ${money(oldCost)}/mo.`,
      why: "Newer generations (for example t3/t4g instead of t2) usually cost the same or less per hour and are faster.",
      todo: ["Check the newer type's price for your region, then change instance type during a maintenance window."],
      monthlyCost: oldCost,
      saving: { amount: 0, kind: "none" },
      assumption: "We don't ship per-region instance prices, so no saving is estimated.",
      source: "https://aws.amazon.com/ec2/pricing/on-demand/"
    }));
  }

  const ec2 = match(lines, /boxusage/);
  const steady = ec2.filter((l) => /hrs?|hours?/i.test(l.unit) && l.quantity >= A.always_on_hours);
  const steadyCost = sum(steady, (l) => l.cost);
  if (steadyCost >= A.always_on_flag_cost) {
    out.push(finding({
      id: "AWS_ALWAYS_ON_ONDEMAND", provider: "aws", severity: "info",
      title: "Servers running all month at on-demand prices",
      saw: `${steady.length} server line(s) ran ${A.always_on_hours}+ hours at on-demand prices (${money(steadyCost)}/mo).`,
      why: "Servers that run all month can be cheaper with Savings Plans or Reserved capacity, but those are 1 or 3 year commitments.",
      todo: ["Right-size first, then look at a Compute Savings Plan for the steady part only."],
      monthlyCost: steadyCost,
      saving: { amount: 0, kind: "none" },
      assumption: "Commitment discounts depend on term and payment option. This is an expert step; we don't estimate it.",
      source: "https://aws.amazon.com/savingsplans/compute-pricing/"
    }));
  }

  const pc = sum(match(lines, /provisioned-concurrency|provisioned concurrency/), (l) => l.cost);
  if (pc >= A.min_line_cost) {
    out.push(finding({
      id: "AWS_LAMBDA_PROVISIONED", provider: "aws", severity: "medium",
      title: "Lambda provisioned concurrency left on",
      saw: `Provisioned concurrency costs ${money(pc)}/mo.`,
      why: "Provisioned concurrency bills for warm capacity whether or not requests arrive. It is meant for launch days and latency-critical paths.",
      todo: ["Remove it, or schedule it only for busy hours."],
      monthlyCost: pc,
      saving: { amount: pc, kind: "up_to" },
      assumption: "Upper bound if you can accept occasional cold starts.",
      source: a.sources.lambda
    }));
  }

  const logs = sum(match(lines, /dataprocessing-bytes|logs.*ingest|cloudwatch.*(log|ingest)/), (l) => l.cost);
  if (logs >= A.min_line_cost) {
    out.push(finding({
      id: "AWS_CLOUDWATCH_LOGS", provider: "aws", severity: "low",
      title: "Paying to collect lots of logs",
      saw: `CloudWatch Logs ingestion costs ${money(logs)}/mo.`,
      why: "Debug-level logging in production and logging whole requests are the usual causes.",
      todo: ["Lower log level in production.", "Set a retention period on every log group (the default keeps logs forever)."],
      monthlyCost: logs,
      saving: { amount: 0, kind: "none" },
      assumption: "",
      source: "https://aws.amazon.com/cloudwatch/pricing/"
    }));
  }

  return out;
}
