# Re-measurement — e2e-live-suite-exceeds-bedrock-daily-token-budget

- Run: `run-e2e-live-budget` (non-engine-resumable by staleness, see
  `gap-sizing.md`'s recording-mechanism note) · Work Item criterion:
  `e2elb-c2-fix-direction` input (this file does NOT set `e2elb-c2` to a fix
  direction; the owner's decision is recorded separately in
  `fix-direction-decision.json` — `re-measure-current-run-first`)
- This is a NEW file, not an edit of `gap-sizing.md` (which stays MEASURED
  and untouched), per the session instructions.
- Suite invocation (machine-captured UTC start): 2026-07-18T20:56:19.000Z
- Suite invocation (machine-captured UTC end, Jest process exit): 2026-07-18T21:44:48.000Z
- AWS account: 771924376645 · Profile: `nestfolio-dev` · Region: us-east-1
- Command run:
  ```bash
  AWS_PROFILE=nestfolio-dev AWS_REGION=us-east-1 \
    NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
    pnpm nx run e2e-feature-tests:test-e2e-features
  ```
  Full log: not committed (local scratch); Jest summary: 7 failed test
  suites, 21 passed (28 total); 24 failed tests, 1 skipped, 31 passed (56
  total); wall time 2877.9 s (≈48 min).

## Material caveat — this run is NOT a clean full-budget burn (read before the numbers)

During this run, several test suites failed early with
`AWS SDK error wrapper for Error: getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com`
(and one occurrence against `771924376645.ddb.us-east-1.amazonaws.com`) —
a local DNS-resolution failure against AWS EventBridge/DynamoDB endpoints
during the run, unrelated to Bedrock quotas. This hit
`advisory-contract-emission`, `execution-contract-emission`, and
`ledger-contract-emission` at the fixture-setup step, i.e. **before** those
scenarios could reach any Bedrock/AgentCore call — so this run's measured
Bedrock volume is genuinely lower than a full clean pass, not just lower
because quotas stopped throttling.

Separately, three scenarios that DO drive the live AgentCore decision cycle
timed out waiting on `withProfileSnapshot()` ("InvestorProfileSnapshot not
materialised within 360s"): `first-decision`, `rebalance-on-drift`, and all
three cases of `operating-mode-recommendation-shape` (which alone ran
1113.3 s before failing). Whether these are downstream of the same DNS
issue (the poller reads DynamoDB, which also errored elsewhere in this run)
or reflect genuine AgentCore/Bedrock-side slowness cannot be distinguished
from the Jest log alone — the CloudWatch numbers below are the only clean
signal.

**Conclusion of the caveat: this measurement is informative but not
decisive.** It cannot confirm "today's quotas no longer throttle a full
clean run" — it can only report what CloudWatch shows for the (partial,
DNS-degraded) traffic this run actually generated.

## Step 1 — Per-model CloudWatch Bedrock metrics for the run window

Window queried: 2026-07-18T20:55:00Z–2026-07-18T21:50:00Z (`--period 3300
--statistics Sum`), same metric names as `gap-sizing.md`
(`InputTokenCount` / `OutputTokenCount` / `Invocations` / `InvocationThrottles`).

| Model (inference profile)                      | Input tok | Output tok | Total tok | Invocations | Throttles |
|--------------------------------------------------|----------:|-----------:|----------:|-------------:|----------:|
| `us.anthropic.claude-haiku-4-5-20251001-v1:0`    | 9,595,207 | 1,757,824 | 11,353,031 |        3,389 |         0 |
| `us.anthropic.claude-sonnet-4-6`                 |    95,113 |    57,243 |    152,356 |           67 |         0 |
| `us.amazon.nova-pro-v1:0`                        | 6,390,140 |   878,450 |  7,268,590 |        1,717 |         0 |
| **Total**                                        | 16,080,460 | 2,693,517 | 18,773,977 |        5,173 |         0 |

**Zero throttles on all three models this run** (vs. 1,789 Haiku throttles /
7,513 total invocations on the 2026-06-26 reference burn — this run reached
5,173 invocations, 68.9% of the reference volume, consistent with the DNS
caveat above suppressing part of the load rather than quotas being clean).

## Step 2 — Current Bedrock TPM quotas (queried 2026-07-18, post-run)

Unchanged from `gap-sizing.md` — no quota increase occurred between the two
measurements:

| Model      | QuotaCode  | Value (TPM) | Adjustable |
|------------|-----------|------------:|-----------|
| Haiku 4.5  | L-58BE175A | 5,000,000  | true |
| Haiku 4.5 (global) | L-9A11C666 | 5,000,000 | true |
| Sonnet 4.6 | L-15B8E632 | 6,000,000  | true |
| Nova Pro   | L-C0326783 | 2,000,000  | true |
| Nova Pro (on-demand) | L-CE33604C | 1,000,000 | false |

## Step 3 — `EstimatedTPMQuotaUsage` during the run window (5-min Maximum)

| Model      | Peak (5-min Max, raw metric value) |
|------------|------------------------------------|
| Haiku 4.5  | 24,371 (23,361 / 19,483 / 18,651 also in-window; rest 6.4k–10k) |
| Sonnet 4-6 | 8,627 |
| Nova Pro   | 5,454 |

For reference, `gap-sizing.md`'s 2026-06-26 burn peaked at 49,264 (Haiku).
This run's Haiku peak (24,371) is about half that — but with 68.9% of the
reference invocation volume and the DNS-caused fixture failures removing
some of the heaviest early scenarios, a like-for-like comparison is not
possible from this data alone.

**Notable finding regardless of the caveat:** even at these still deeply
elevated `EstimatedTPMQuotaUsage` readings (thousands of percent over the
metric's nominal 100 baseline, same order of magnitude as the throttling
burn day), **zero throttles occurred this run**. This is the one clean,
caveat-independent signal from this measurement: high
`EstimatedTPMQuotaUsage` values alone did not reproduce the 2026-06-26
throttling this time, at unchanged quota values.

## What this does and does not tell us

- Does NOT confirm the fix is unnecessary: this run did not complete a full
  clean pass (DNS failures suppressed volume; two decision-cycle scenarios
  timed out for an undetermined reason).
- DOES show that a partial run at 68.9% of reference volume, at unchanged
  quota values, produced zero throttles — weak evidence that a full clean
  pass today would throttle less than the reference burn, not proof that it
  would throttle zero.
- The DNS failures and the two 360s `withProfileSnapshot` timeouts are new
  findings independent of the budget question; they are NOT diagnosed
  further here (out of this session's authorized scope) and are not fixed
  or filed as a backlog item in this session.

e2elb-c2-remeasurement: RECORDED (informative, not decisive — see caveat
above). `e2elb-c2-fix-direction` itself is decided in
`fix-direction-decision.json` as `re-measure-current-run-first`, already
executed by this file; whether a further fix (TPM quota increase / reduce
burst concurrency) is still warranted is unresolved and deferred to the
owner in a future session, informed by this file.
