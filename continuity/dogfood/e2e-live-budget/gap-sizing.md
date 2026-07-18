# Gap-sizing measurement — e2e-live-suite-exceeds-bedrock-daily-token-budget

- Run: `run-e2e-live-budget` · Work Item criterion: `e2elb-c1-gap-sizing`
- Measured (machine-captured UTC, `date -u`): 2026-07-18T20:14:06.000Z
- AWS account: 771924376645 · Profile: `nestfolio-dev` (from Nestfolio `.env`
  `AWS_PROFILE`, loaded by `.envrc` direnv `dotenv`) · Region: us-east-1
- Reference burn: 2026-06-26 UTC (the day recorded in the backlog dossier;
  total 7,513 invocations matches the dossier's ~7.2k / 7,444)

## Recording-mechanism note (honest provenance)

This file was written directly into the Run's Scope-declared write path
(`continuity/dogfood/e2e-live-budget/`), NOT through the engine effect API.
Reason: the Run's first-session artifacts were committed on Nestfolio main
(commit `79a15c6c`) before this measurement, which advanced `HEAD`. The engine
freshness check (`verifyFreshness` → `repositoryFingerprint`) binds to the git
HEAD SHA (`gitIdentity`), so `resume` returns `STALE_RUN`
(expected `94ff01f0…` at HEAD `6c75d4d1`, actual `c12f1d81…` at HEAD
`79a15c6c`). Verified that commit `79a15c6c` touched no `fingerprint_paths`
file — only the HEAD SHA changed. The Run `run-e2e-live-budget` is therefore
non-engine-resumable by staleness (the same accepted, documented consequence
class as `run-mi005` after MI-006-R1). This is recorded as a dogfooding
finding in the SD-001 ledger.

## Step 1 — Per-model consumption of one full live run (burn day 2026-06-26 UTC)

CloudWatch `AWS/Bedrock`, `--period 3600 --statistics Sum`, dimension
`ModelId`. Correct metric names are `InputTokenCount` / `OutputTokenCount` /
`Invocations` / `InvocationThrottles` (NOT the `Invocation*TokenCount` names
assumed in the measurement plan — corrected after `list-metrics`).

| Model (inference profile)                          | Input tok  | Output tok | Total tok  | Invocations | Throttles |
|----------------------------------------------------|-----------:|-----------:|-----------:|------------:|----------:|
| `us.anthropic.claude-haiku-4-5-20251001-v1:0`      | 14,194,922 |  2,908,825 | 17,103,747 |       4,723 |     1,789 |
| `us.anthropic.claude-sonnet-4-6`                   |    541,728 |    286,225 |    827,953 |         251 |         0 |
| `us.amazon.nova-pro-v1:0`                           | 10,354,157 |  1,250,016 | 11,604,173 |       2,539 |         0 |
| **Total**                                          | 25,090,807 |  4,445,066 | 29,535,873 |       7,513 |     1,789 |

Agents → models (from source, six production AgentConfigs): user-goals +
explainability → Haiku; risk-assessment + market-research → Sonnet 4-6;
portfolio-construction + rebalance-planner → Nova Pro.

**All 1,789 throttles were on Haiku 4.5. Sonnet and Nova Pro: zero throttles.**

## Step 2 — Current Bedrock quotas (queried 2026-07-18; all values `Applied`)

Tokens per DAY (all `Adjustable=false` — NOT user-increasable):

| Model         | tokens/day quota (applied) | QuotaCode    | Burn-day usage / quota |
|---------------|---------------------------:|--------------|------------------------|
| Haiku 4.5     | 357,141,600 (max/day; 714,283,200 global x-region) | L-6120CF2D / L-B5C049AE | 17.1M / 357.1M = **4.8%** |
| Sonnet 4.6    | 119,046,240 (max/day; 238,092,480 global x-region) | L-B29C9321 / L-248E47B7 | 0.83M / 119.0M = 0.7% |
| Nova Pro      | 1,440,000,000 (max/day)    | L-D690997B   | 11.6M / 1,440M = 0.8% |

Tokens per MINUTE (the adjustable axis):

| Model         | tokens/min quota (applied) | Adjustable | QuotaCode |
|---------------|---------------------------:|-----------|-----------|
| Haiku 4.5     | 5,000,000 (cross-region)   | **true**  | L-58BE175A / L-9A11C666 |
| Sonnet 4.6    | 6,000,000 (cross-region)   | true      | L-15B8E632 / L-7BEE40FB |
| Nova Pro      | 2,000,000 (cross-region); 1,000,000 (on-demand) | true / false | L-C0326783 / L-CE33604C |

`EstimatedTPMQuotaUsage` (Max %, hourly) on the burn day — a per-MINUTE
quota-usage metric AWS computes against the then-current quota:

| Model      | max hourly EstimatedTPMQuotaUsage |
|------------|-----------------------------------|
| Haiku 4.5  | **49,264 %** |
| Sonnet 4-6 | 9,487 % |
| Nova Pro   | 5,605 % |

Haiku burst shape: 18:00Z 6.67M input tok / 2,369 inv; 19:00Z 7.23M input tok /
2,178 inv (the entire day's burn is these two hours). Hourly-average peak
120,514 tok/min = 2.4% of the 5M TPM quota — so the >100% `EstimatedTPMQuotaUsage`
reflects SUB-minute concurrency bursts (the suite fires many decision cycles at
once) and/or a lower then-current quota, not a sustained hourly rate.

## Step 3 — Gap analysis and binding constraint

**The backlog dossier's framing (one full run exhausts a tokens-per-DAY quota)
is not what the current data shows.** At today's quotas:

- Tokens-per-DAY is not the constraint: peak model (Haiku) used **4.8%** of its
  daily quota. The per-day quotas are also `Adjustable=false`, so dossier fix
  option 1 as written ("request a tokens-per-day quota increase") targets the
  wrong axis AND is not requestable.
- The binding constraint is **Haiku 4.5 tokens-per-MINUTE / burst concurrency**:
  Haiku took 100% of the throttles and hit 49,264% of its per-minute quota
  metric during the 18:00–19:00Z burst. The only adjustable lever here is the
  Haiku cross-region TPM quota (`L-58BE175A`, currently 5,000,000, `Adjustable=true`).
- Dossier options 2/3/4 (reduce per-scenario consumption; scope live-AgentCore
  scenarios; split the suite) all reduce Haiku peak concurrency and remain valid.

**Material caveat (staleness vs mutable quota).** The burn evidence is 22 days
old and the relevant TPM quotas are `Adjustable=true` (mutable; AWS also raises
Bedrock defaults over time). The 2026-06-26 quota values are not retrievable, so
the measured overage cannot be projected onto a CURRENT run. Whether today's
quotas still throttle a full pass is unknown without re-measuring one live run
now. `list-metrics` shows no Bedrock activity in the last 14 days (no run since).

## Inputs to the fix-direction decision (`e2elb-c2`, owner's call — not asserted here)

1. Re-measure first: run the live-AgentCore suite once against CURRENT quotas
   and re-read per-model throttles before committing to any fix (cheapest, most
   decision-relevant, given 22-day staleness + mutable quotas).
2. Raise the Haiku cross-region TPM quota (`L-58BE175A`, adj=true) — the only
   quota lever the data supports (NOT a per-day increase).
3. Reduce Haiku burst concurrency (pace/limit the user-goals + explainability
   agent fan-out; reuse a shared onboarded tenant; scope or split the suite).

e2elb-c1-gap-sizing: MEASURED
