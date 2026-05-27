# Playwright journey flake remediation (design)

**Workstream:** `playwright-rebalance-real-agents-maxvms-remediation`
**Status:** active
**Date:** 2026-05-27
**Lane:** Complex (worktree-first per [[feedback-worktree-first-no-commits-on-main]])

> **2026-05-27 — pivot history. READ THIS FIRST.** This workstream pivoted THREE times. Sections §1-§4 reflect the original framing; §6-bis recorded a (later-revised) interpretation; §6-bis-extended and §7 hold the **current, correct** mechanism. Read §6-bis-extended + §7 first, then loop back for context.
>
> **Pivot 1 (brainstorming):** Original target was the speculative `rebalance-trades-on-drift.spec.ts` scenario; brainstorming proved it tested a production feature (weight-drift detector) that doesn't exist. Workstream re-targeted to the two journeys.
>
> **Pivot 2 (Phase 1 measurements, see §6-bis):** I declared "maxVms hypothesis disproved" because M1 (1000-quota) ≫ M2 peak (11). **This was wrong — see Pivot 3 correction.** The 1000-quota is not the binding constraint.
>
> **Pivot 3 (Phase 2 investigation, see §6-bis-extended):** The maxVms framing was directionally correct all along. The binding constraint is **1 concurrent session per micro-VM** (per-runtime), not 1000 sessions per account. With `sqsMaxConcurrency=10` Lambdas competing for 1 micro-VM slot, 9/10 fail with "maxVms limit exceeded" on every burst drain. Original §4 Case B is the right mechanism. §6-bis's "hypothesis disproved" claim is hereby **corrected by §6-bis-extended I1**.

---

## 1. Reframed goal

AgentCore maxVms remediation so the JOURNEYS — `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` and `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts` — pass 2× consecutively against deployed dev, cost-positive (or neutral) for the dev account, with the speculative `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` deleted because its trigger (`PORTFOLIO_DRIFT_DETECTED` from weight-vs-target deviation) has no production emitter.

### What changed from the original dossier framing

The dossier originally framed this as "make the rebalance Playwright scenario pass with real agents per [[feedback-e2e-no-external-mocks]]." Brainstorming surfaced two findings that materially reframed scope:

1. **`reconciliation-ctrl` only handles Intent-vs-Settlement drift** (broker partial-fills / broker errors), NOT weight-vs-target drift. The rebalance scenario's `PORTFOLIO_DRIFT_DETECTED` synthetic injection is modeling a production feature that doesn't exist yet — no producer of the event from a user-driven path. Verified at `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:101-158` (Intent vs Settlement only).
2. **The journeys ALREADY exercise the deposit→initial-portfolio-build chain end-to-end with real agents** (`new-investor-happy-path.spec.ts:122-179` covers deposit form → confirm → detected → /advisory → rationale → confirm). The journey tests are the right surface to stabilize for real-agent maxVms coverage; the speculative rebalance scenario is dead weight.

### What this workstream does

1. Measurement pass against deployed dev (the first deliverable — the mechanism is its OUTPUT, not its input, per [[feedback-measure-before-proposing]]).
2. Mechanism implementation chosen by the decision tree in §4.
3. Deletion of `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` + `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts` (only consumer is the deleted test).
4. Validation: 2× consecutive `new-investor-happy-path` + `deposit-reload-mid-flight` passes per [[feedback-flake-means-broken]].
5. Two follow-up dossiers filed via `backlog-add`:
   - `weight-drift-detector` (queued) — the missing production feature.
   - `playwright-rebalance-after-weight-drift-detector` (parking) — re-add Playwright rebalance coverage once a real organic trigger exists.

## 2. Out of scope

- Production-account maxVms quota work — tracked separately in `agentcore-maxvms-prod-quota-increase`.
- Building the weight-drift detector itself — filed as `weight-drift-detector` follow-up.
- Rewriting any journey internals — only fixing the infra so the journeys pass.
- Any other Playwright scenario beyond the two journeys.
- Broad Lambda concurrency overhaul — only the agent-ingress knobs surfaced by the decision tree are in play.
- Building any application-level admission-controller or job-queue — concurrency capping lives at AWS-native knobs only.

## 3. Measurement plan (first deliverable)

Six quantities, each with its concrete collection command. Outputs land in §6 (`## Baseline measurements`).

### M1 — Dev maxVms quota (the hard ceiling)

```bash
aws service-quotas list-service-quotas \
  --service-code bedrock-agentcore \
  --query 'Quotas[?contains(QuotaName, `vm`) || contains(QuotaName, `concurrent`) || contains(QuotaName, `session`)].[QuotaCode,QuotaName,Value,Adjustable]' \
  --output table
```

(Fall back to `aws service-quotas get-service-quota` per quota code if the catalog filter misses; AgentCore is GA-recent so quota names may be terse.)

### M2 — Peak concurrent active sessions per runtime during a serial journey

Run in two terminals against deployed dev:

- **T1:** `pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path"` (single test, single worker — already the config per `apps/nestfolio-e2e/playwright.config.ts:55`).
- **T2:** every 5s for the test duration, list active sessions per runtime for the 5 runtimes (onboarding-bff, portfolio-engine-ctrl, advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl). Exact API shape pinned at run-time — `aws bedrock-agentcore-control list-agent-runtime-endpoints` + `aws bedrock-agentcore list-agent-runtime-sessions` are the candidates; the CLI may need `bedrock-agentcore` vs `bedrock-agentcore-control` split.

Record: peak concurrent count per runtime + timestamp of peak.

### M3 — ServiceQuotaExceeded retry rate over last 30 days

```bash
aws logs start-query \
  --log-group-names \
    /aws/lambda/dev-portfolio-engine-ctrl-PE \
    /aws/lambda/dev-advisory-narrative-ctrl-AN \
    /aws/lambda/dev-onboarding-bff \
  --start-time $(($(date +%s) - 2592000)) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ServiceQuotaExceeded/ | stats count() by bin(1h)'
```

Record: total occurrences, hourly distribution, which runtime dominates.

### M4 — DWC SF `TaskTimedOut` count over last 30 days

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/States \
  --metric-name ExecutionsTimedOut \
  --dimensions Name=StateMachineArn,Value=$(aws ssm get-parameter --name /nestfolio/dev-decision-workflow-ctrl/state-machine/arn --query Parameter.Value --output text) \
  --start-time $(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 --statistics Sum
```

Plus a Logs Insights pass on the SF execution history for `TaskTimedOut` events broken down by `Resource` (which agent state was the victim).

### M5 — Wall-clock per phase of the journey baseline

Single Playwright run with per-`test.step()` timestamp logging. Record total journey duration + per-step timing for the 4 heaviest phases (onboarding-wizard, deposit, decision-pipeline, confirm).

### M6 — Cost attribution from saturation churn (last 30 days)

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -v-30d +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE
```

Cross-reference: Lambda cost for PE/AN tagged `nestfolio-domain=advisory`. The cost-positive claim has to point to a line item that goes down after the fix.

### Estimated wall-clock

~25 minutes if AWS APIs respond promptly. M2 dominates (~5-7 min for the full journey run while polling).

## 4. Decision tree (measurements → mechanism)

The mechanism is fully derived from M1-M6. The spec commits to these rules in advance, so when the numbers come in the choice is mechanical.

### Primary branch — does saturation physically happen?

```
IF M1 (dev maxVms quota) > SUM(M2 peak concurrent across all 5 runtimes) × 1.2:
    saturation is not the cause.
    → No maxVms mechanism applies. Investigate other flake causes
      and either re-scope this workstream as "diagnose-other-causes"
      or mark it shipped-as-no-op with the measurements as evidence
      and pivot to the actual root cause workstream.
```

The 1.2× factor leaves slack for the timing skew between when sessions allocate vs when M2 polled (5s sample interval). If headroom is below 1.2×, fall through.

### Secondary branch — which runtime dominates the peak?

Three cases; if two are tied, apply both fixes.

#### Case A: `onboarding-bff` dominates (≥ 60% of total peak)

Tighten `onboarding-bff` `idleTimeout` from 5 min → 30 s.

Rationale: `onboarding-bff` is invoked per-phase (7 phases), each phase is short (~5-15s LLM call). The current 5-min `idleTimeout` (already tightened from the AgentCore 15-min default per the inline comment at `services/investor/onboarding-bff/src/service.stack.ts:72-74`) means each finished phase holds a micro-VM for ~20-60× its actual work duration, stacking sessions across the wizard. 30s is enough for the user to read the renderer + click the next CTA without losing the warm session.

- File: `services/investor/onboarding-bff/src/service.stack.ts:83`
- Change: one-line `Duration.minutes(5)` → `Duration.seconds(30)`.
- Optional companion: also lower `maxLifetime` from `Duration.hours(1)` to `Duration.minutes(15)` at line 84. Only apply if M2 shows MaxLifetime is being hit (sessions ageing out at 1h rather than being released via idle). Default: leave `maxLifetime` alone.

#### Case B: `portfolio-engine-ctrl` and/or `advisory-narrative-ctrl` dominate (≥ 50% of total peak)

Lower `expectedBurstSize` on PE+AN so the `agentProfile()` invariant derives `sqsMaxConcurrency = 1` (forces serial agent invocation account-wide, eliminating overlap between concurrent DWC SFs).

- Current: `expectedBurstSize: 40`, `agentLatencyP90Ms: 29_000` (PE) / `35_000` (AN), `uxBudgetSeconds: 120` → derives `sqsMaxConcurrency = 10` (PE) / `12` (AN). Verified at `services/advisory/portfolio-engine-ctrl/src/service.stack.ts:43-46` and `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:34-37`.
- Target: `expectedBurstSize: 4` (PE) → `ceil(4 × 29 / 120) = 1`; `expectedBurstSize: 4` (AN) → `ceil(4 × 35 / 120) = 2`. If 2 still too high, lower AN to `expectedBurstSize: 3` → `1`.
- Files: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`, `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`.
- `agentProfile()` synth-time invariant still passes (visibilityTimeoutSec ≤ uxBudgetSeconds × 2). Verified at `libs/cdk-constructs/src/utils/lambda-profiles.ts:231-251`.

Trade-off: blocks parallel DWC SFs at the SQS layer in sandbox only. NOT to ship to prod.

#### Case C: `investor-profile-ctrl` and/or `market-intelligence-ctrl` dominate (≥ 30% of total peak)

Surprise — Phase A of inter-agent-state-handoff (2026-05-14) was supposed to convert IP+MI to pre-computed snapshots so they don't run per-decision. They should be near-zero in M2. If they're not, regression. File as a blocker bug; don't paper over with concurrency caps.

Investigate: `services/advisory/investor-profile-ctrl/src` + `market-intelligence-ctrl/src` runtime invocation triggers vs the `SnapshotProjectorIngress` path. Expected post-Phase-A: IP+MI only invoked on snapshot-projector failures or rare cold-snapshot paths.

### Tertiary branch — AgentCore MemoryStrategies as hidden load

During M2 collection, also record memory strategy activity:

```bash
aws bedrock-agentcore-control list-memories ...
aws bedrock-agentcore-control list-memory-strategy-executions ...
```

The DWC has 3 long-term MemoryStrategies (InvestorPreferenceLearner, MarketSignalExtractor, RationaleArchivist) running async on Haiku inference profile. Determine whether they consume the same micro-VM pool as the primary runtimes. If yes, factor their peak into Case A/B/C selection. If no, exclude from the saturation analysis but record in M6.

### Quaternary branch — cost-positive validation

After implementing the mechanism, re-run M3 and M4 after 2× consecutive green journey runs + 24h of normal sandbox usage:

- If post-fix M3 (ServiceQuotaExceeded count) drops to 0 OR post-fix M4 (TaskTimedOut count) drops to 0 → cost-positive verified.
- If post-fix M3+M4 unchanged BUT journeys pass 2× consecutively → cost-NEUTRAL (acceptable per dossier; document residual saturation separately).
- If post-fix M3+M4 INCREASE → mechanism backfired. Revert; pick next mechanism. The backfire-fallback priority order is Case A (cheapest, no agent-pipeline change) → Case B (sandbox-only ESM cap) → Case A+B combined → maxVms quota increase as last resort. This priority applies ONLY when re-selecting after a backfire; the primary selection in the secondary branch uses M2 dominance.

### Mechanisms NOT to apply blindly

- **maxVms quota increase.** Only if all cheap mechanisms leave residual saturation AND M3+M4 are large AND M6 shows existing waste exceeds the marginal quota cost. Default: don't.
- **SF `TimeoutSeconds` widening.** Masks the symptom. Only acceptable if M5 shows journey wall-clock has headroom AND a measurement specifically shows that the 120s budget is too tight even without saturation. Default: don't.
- **Orphan SF gate.** Production SF change; not justified without the rebalance test driving it. Default: don't.

## 5. Follow-up dossiers (filed via `backlog-add`)

### `weight-drift-detector` (status: queued)

The production-feature gap this workstream surfaced. Body covers: where the detector lives (extend `reconciliation-ctrl` vs new service vs advisory-bff projection), what triggers the check (LedgerSnapshot CDC + MarketSnapshot CDC vs periodic timer), threshold contract (per-instrument vs portfolio-level), debouncing, per-tenant vs per-portfolio emission.

References: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`, `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`, `services/ledger/reconciliation-ctrl/src/domain/events.ts`.

Filed as queued (not parking) per [[feedback-e2e-gaps-queued-not-parking]] — without this, rebalance can never be exercised organically end-to-end.

### `playwright-rebalance-after-weight-drift-detector` (status: parking)

Re-add the Playwright rebalance coverage on top of a real organic trigger once `weight-drift-detector` ships. Properly parking per rule 8 (carries explicit promotion trigger: "Promote when `weight-drift-detector` ships").

Most likely future shape: extend `journeys/new-investor-happy-path.spec.ts` with a second-deposit + wait-for-organic-rebalance arm, rather than re-introducing a `scenarios/` file. Matches the journeys/scenarios philosophy in `apps/nestfolio-e2e/CLAUDE.md`.

Records the deleted test's last-seen SHA so it's recoverable from git history.

## 6. Baseline measurements (2026-05-27 11:30 UTC)

_Collected against deployed dev (account 771924376645, us-east-1) during a live `new-investor-happy-path` Playwright run. Journey PASSED (1/1 green, 2.6 min)._

| Quantity | Measured value | Source command |
|---|---|---|
| M1 dev maxVms quota | 1000 Active Session Workloads per account (QuotaCode=L-3E5722B2, Adjustable=True); InvokeAgentRuntime rate=25/s per agent (L-617C96C1, Adjustable=True) | `aws service-quotas list-service-quotas --service-code bedrock-agentcore` |
| M2 peak concurrent — onboarding-bff | 1 micro-VM (idleTimeout=5min; 1 new VM created at 11:20:13Z during journey) | CloudWatch Logs stream count on `/aws/bedrock-agentcore/runtimes/onboarding_agent-YZ0LJhFVyA-DEFAULT` |
| M2 peak concurrent — portfolio-engine-ctrl | 3 micro-VMs (idleTimeout=2min; VMs at 11:21:15, 11:21:40, 11:21:46Z) | same |
| M2 peak concurrent — advisory-narrative-ctrl | 4 micro-VMs (idleTimeout=2min; VMs at 11:21:45, 11:21:57, 11:22:08, 11:22:13Z) | same |
| M2 peak concurrent — investor-profile-ctrl | 1 micro-VM (idleTimeout=2min; VM at 11:21:07Z) | same |
| M2 peak concurrent — market-intelligence-ctrl | 2 micro-VMs (idleTimeout=2min; VMs at 11:20:35, 11:20:36Z) | same |
| M3 ServiceQuotaExceeded count (30d) | 694 total: PE=667 (96%), AN=27 (4%). Clustered: peaks at 2026-05-21 10:00Z (38/h), 22:00Z (32/h) and 2026-05-22 11:00Z (36/h) | `aws logs start-query` on PE+AN IngressHandler log groups |
| M4 SF TaskTimedOut count (30d) | 5291 TaskTimedOut events from SF logs, all at `putEvents.waitForTaskToken` resource. CloudWatch ExecutionsTimedOut metric: 308 over 30d (peaks: 2026-05-17 104, 2026-05-03 42) | `aws cloudwatch get-metric-statistics` + Logs Insights on SF execution log group |
| M5 journey wall-clock baseline | 156s total (2.6 min). Top phases: onboarding-wizard≈40s, decision-pipeline (MI+IP+PE+AN combined)≈101s, deposit≈35s, confirm+logout≈15s. Decision-pipeline breakdown: MI-snapshot 35s → IP-snapshot 8s → PE-agents 30s → AN-agents 28s | Playwright reporter + AgentCore micro-VM creation timestamps |
| M6 Bedrock 30d cost | $486.37 Claude total (Sonnet 4.6 $154.94 + Haiku 4.5 $120.19 + Opus 4.6 $92.06 + Opus 4.5 $0.77 + Sonnet 4.5 $0.47); AgentCore runtime $69.68; Amazon Bedrock (KB/NovaPro) $39.68. Total AWS: $595.57 (30d). No tag-based filter available (resources untagged in dev) | `aws ce get-cost-and-usage --group-by SERVICE` |
| Memory strategy activity (tertiary) | 376 extraction jobs in `nestfolio_dev_agent_memory`: 376/376 FAILED with CUSTOM_MODEL_BEDROCK_THROTTLING. Strategies: InvestorPreferenceLearner (212), RationaleArchivist (164). Memory strategies use SEPARATE Bedrock throttle pool — not the same micro-VM quota as M1. | `aws bedrock-agentcore list-memory-extraction-jobs` |

## 6-bis. Phase 1 finding (2026-05-27)

§4 primary branch (saturation-physically-possible check) **fired**: M1 quota (1000) ≫ Σ M2 peak (11) × 1.2 = 13.2. AgentCore maxVms is at 1.1% utilization — saturation cannot physically be the cause of journey flakes.

**But the flakes are real:** M3 + M4 + the memory-strategy tertiary measurement document significant production pain on a different axis:

- **694 `ServiceQuotaExceeded` events over 30d**, 96% in PE Lambda IngressHandler (667 events), 4% in AN (27 events). Clustered (peaks 38/h on 2026-05-21, 36/h on 2026-05-22) — suggests bursts of throttling, not sustained background load.
- **5291 `TaskTimedOut` events on the SF**, all at `putEvents.waitForTaskToken`. The CloudWatch `ExecutionsTimedOut` metric counts 308 SF-level execution timeouts (peak 104 on 2026-05-17). Discrepancy 5291 vs 308 = retries within the SF deadline; many timeouts get re-driven and only some bubble up to execution-level failure.
- **376/376 memory-strategy extraction jobs FAILED** with `CUSTOM_MODEL_BEDROCK_THROTTLING`. Separate Bedrock model throttle pool (NOT the AgentCore maxVms quota). InvestorPreferenceLearner: 212 failed; RationaleArchivist: 164 failed.

The dossier's original maxVms hypothesis assumed a deliberately-low quota; M1 disproved that. The real cause is somewhere in the Bedrock `InvokeModel` / `InvokeAgentRuntime` rate space (the L-617C96C1 quota measured 25/s per agent), the PE Ingress retry path, or both.

### ⚠️ Correction (2026-05-27 14:14 UTC) — this section was WRONG

The paragraph above is **superseded by §6-bis-extended I1**. Phase 2 investigation revealed that the binding maxVms constraint is **1 concurrent session per micro-VM** (per-runtime), not the account-wide 1000 quota. The error message literally says "maxVms limit exceeded" and references the 1000-quota by name, but the limit fires on the 2nd-Nth concurrent `InvokeAgentRuntime` call against the *same runtime*, not on the 1001st across the account. With `sqsMaxConcurrency=10` Lambdas competing for the 1 micro-VM slot, 9/10 fail on every burst drain. The maxVms framing in §1-§4 was directionally correct all along; the mistake was reading "M1 quota=1000, M2 peak=11" as "1.1% utilization → saturation impossible" when the real constraint scope is per-runtime not per-account.

The lesson: data-collection without correctly-scoped constraint interpretation yields false negatives. Recorded in memory as an extension of [[feedback-measure-before-proposing]].

## 4-bis. Investigation plan (replaces §4 for mechanism selection)

§4 (maxVms decision tree) is **superseded** for this workstream. The new investigation:

### I1 — Pin down which quota is throttling

The 694 `ServiceQuotaExceeded` events have an `errorCode` / `__type` / `message` field on the exception. Extract those from CloudWatch:

```bash
aws logs start-query \
  --log-group-names <PE+AN IngressHandler log groups> \
  --start-time $(($(date +%s) - 2592000)) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ServiceQuotaExceeded/ | parse @message /"__type":"(?<type>[^"]+)"/ | parse @message /"message":"(?<msg>[^"]+)"/ | stats count() by type, msg | sort count() desc'
```

Outcome: a histogram of which specific quotas are exceeded. Candidates by service:
- Bedrock `InvokeModel` tokens-per-minute (TPM) cap (per region, per model)
- Bedrock `InvokeModel` requests-per-minute (RPM) cap
- AgentCore `InvokeAgentRuntime` rate cap (25/s per agent — already known from M1)
- Bedrock cross-region inference profile cap (memory-strategy 376/376 throttle hint)

### I2 — Pin down the retry storm shape

If a single SF execution generates many `ServiceQuotaExceeded` retries inside its 120s deadline, the resulting `TaskTimedOut` is caused by retry exhaustion, not by the underlying agent latency. Verify by correlating timestamps:

```bash
# For each SF execution that ended in TaskTimedOut on 2026-05-17 (peak day),
# count the number of ServiceQuotaExceeded events in PE+AN logs within the
# execution's 120s window.
```

If avg retries per failed execution > ~5, the retry storm IS the binding issue and the fix is at the retry-policy layer (or the upstream rate cap). If retries are flat ~1-2, the timeout is caused by underlying slowness (M5 already shows decision-pipeline at 101s out of 120s budget — 16% headroom).

### I3 — Pin down the memory-strategy throttle

376/376 failures suggests the memory-strategy execution profile (cross-region Haiku inference) is hitting a Bedrock model TPM/RPM cap independently of the per-agent budget. Verify the strategy execution model + region:

```bash
aws bedrock-agentcore-control list-memory-strategies --memory-id <ID>
# inspect modelId + region for each strategy
```

Outcome: confirm whether the memory-strategy throttle is on the same model used by agents (compounding effect) or on a separate model (additive cost but orthogonal).

### Mechanism selection (from I1+I2+I3 outcomes)

The mechanism is one of:

- **F1 — Reduce PE Ingress retry attempts** if I2 shows retry storms. Lower the SQS visibility timeout or shorten the retry policy on the Lambda's outbound Bedrock client. Cost-positive (fewer throttled calls).
- **F2 — Increase the binding Bedrock quota** if I1 identifies a single dominant quota that's adjustable. The 25/s `InvokeAgentRuntime` cap is adjustable. Cost: ~$0 marginal (it's a rate cap, not a billed resource); risk: hides the underlying retry pattern.
- **F3 — Spread the request rate** if I1 shows TPM/RPM saturation. Add a backoff layer in the agent invocation chain, or batch-coalesce requests where possible. More invasive.
- **F4 — Decouple memory-strategy throttle** if I3 shows compounding. Move strategies to a different model or rate-limit them independently of the agent invocation path.
- **F5 — Reduce decision-pipeline latency** if M5's 101s/120s ratio is too tight even without saturation. Pursue separately — out of scope here, file follow-up dossier.

Phase 2 deliverable: I1+I2+I3 outputs land in §6-bis-extended (one extra subsection per investigation), then §7 records the chosen F mechanism + rationale grounded in the investigation evidence.

## 6-bis-extended. Investigation findings (I1-I3) — 2026-05-27

### I1: Dominant throttling quota

**Finding:** The 694 `ServiceQuotaExceeded` events all carry `errorType=ServiceQuotaExceededException` and `errorMessage="maxVms limit exceeded for account 771924376645"`. This maps to quota **L-3E5722B2 "Active Session Workloads per Account"** (Value=1000, Adjustable=True). However, the account-wide 1000-session quota is NOT the binding constraint — the binding constraint is that each AgentCore runtime micro-VM can serve **only 1 concurrent session at a time**. When `sqsMaxConcurrency=10` PE Lambda invocations run concurrently, the first one claims the micro-VM, and the other 9 immediately receive "maxVms limit exceeded" for their attempt to create a new session on the same runtime.

Confirmed by CloudWatch `Sessions` metric (Max=1 throughout all burst windows) — the account is never above 1 concurrent session per runtime even during a 276-invocation/minute burst.

| Quota | Code | Value | Adjustable | Binding? |
|---|---|---|---|---|
| Active Session Workloads per Account | L-3E5722B2 | 1000 | Yes | No (actual binding: 1 session per micro-VM) |
| InvokeAgentRuntime rate per agent | L-617C96C1 | 25/s | Yes | No (max observed: 4.6/s) |

### I2: Retry storm shape

**Finding: queue-drain burst, NOT per-execution retry storm.**

The 5291 TaskTimedOut events and M4 SF-level timeouts are caused by a queue-backlog drain pattern, not within-execution retries. Evidence from 2026-05-22 11:25-11:35Z (worst observed window):

| Metric | Value |
|---|---|
| PE IngressQueue depth at 13:20-13:26 UTC+2 | 127–173 messages (building backlog) |
| PE IngressQueue depth at 13:27 UTC+2 | Drains to 0 |
| PE `Invocations` in 13:27 minute | 276 |
| PE `Throttles` in 13:27 minute | 264 (95.7% failure rate) |
| Successful PE invocations in 13:27 minute | 12 (4.3%) |
| AN Throttles in same window | 6 (negligible vs PE) |

**Mechanism:** The PE handler wraps `ServiceQuotaExceededException` in a `try/catch` that emits an `AgentFailure` CDC row and returns cleanly — the SQS message is consumed (not re-queued). Each failed invocation permanently fails its SF task token. There are no within-execution retries. The "storm" is 10 concurrent Lambda slots all competing for the same single micro-VM, draining a 173-message backlog in one burst: ~10 batches fire simultaneously, 9/10 fail per batch.

**Conclusion: storm, not slowness.** The 5291 TaskTimedOut events are permanent failures, not retries within a 120s window.

### I3: Memory-strategy throttle attribution

**Finding: separate model, orthogonal throttle pool.**

Memory strategies confirmed from `services/advisory/decision-workflow-ctrl/src/service.stack.ts`:

| Strategy | Type | Model |
|---|---|---|
| InvestorPreferenceLearner | USER_PREFERENCE_MEMORY | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Haiku) |
| MarketSignals | SEMANTIC_MEMORY | AWS-managed extraction (no explicit model) |
| RationaleArchivist | SEMANTIC_MEMORY | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Haiku) |

The 376/376 extraction failures carry error `CUSTOM_MODEL_BEDROCK_THROTTLING` — a separate Bedrock InvokeModel TPM/RPM limit for Haiku inference profiles. The agent invocation path uses **Opus 4.6 + Sonnet 4.6** (PE runtime) — a completely different model family. The memory strategy throttle is **orthogonal to the agent invocation path**. Decoupling (F4) would not affect the journey flake rate; the two throttle pools don't compete.

The CloudWatch `Throttles` metric for PE (`InvokeAgentRuntime`) is the binding constraint, not the memory Haiku throttle.

**Summary of root cause:** `sqsMaxConcurrency=10` on the PE IngressHandler means 10 Lambda invocations compete for the same PE micro-VM simultaneously. One wins; 9 fail immediately with "maxVms limit exceeded" (the per-micro-VM single-session constraint). When the queue builds (e.g., during parallel Playwright runs or integration test blasts), a drain burst causes 264/276 PE invocations to fail in a single minute — each failure permanently kills a SF task token and contributes to the M4 TaskTimedOut count.

## 7. Mechanism selected

**Selected: Case B from §4 (which maps to F1 in §4-bis, reframed) — reduce `sqsMaxConcurrency` to 1 on PE and AN by lowering `expectedBurstSize` to 4**

**Evidence:**
- I1: The binding constraint is per-micro-VM (1 concurrent session per runtime), not the account-wide 1000 quota. Increasing the quota (F2) would not help — the account quota is irrelevant.
- I2: 95.7% of PE invocations fail during a burst drain. Each failure permanently kills a SF task token. Reducing concurrency from 10→1 eliminates the 9 competing slots and drops the failure rate to near-zero.
- I3: Memory strategy throttle is orthogonal (Haiku vs Opus/Sonnet, separate pool). F4 would not improve journey pass rate.
- F3 (spread request rate) and F5 (reduce pipeline latency) are out of scope — the cause is structural concurrency, not rate or latency.

**Implementation:**

Two service-stack changes only. Both use the `agentProfile()` formula:
`sqsMaxConcurrency = max(1, ceil(expectedBurstSize × agentLatencyP90Ms/1000 / uxBudgetSeconds))`

- **PE** (`services/advisory/portfolio-engine-ctrl/src/service.stack.ts:45`):
  Change `expectedBurstSize: 40` → `expectedBurstSize: 4`.
  Formula: `ceil(4 × 29 / 120) = ceil(0.967) = 1` → `sqsMaxConcurrency=1`.
  Invariant: `visibilityTimeoutSec = ceil(29 × 1.5) + 5 = 49` × `visibilityMultiplier=4` = 196s ≤ 240 (120×2). Passes.

- **AN** (`services/advisory/advisory-narrative-ctrl/src/service.stack.ts` — line to be confirmed at write time):
  Change `expectedBurstSize: 40` → `expectedBurstSize: 4`.
  Formula: `ceil(4 × 35 / 120) = ceil(1.167) = 2`. If 2 still causes contention, lower to `expectedBurstSize: 3` → `ceil(3 × 35 / 120) = ceil(0.875) = 1`.
  Invariant: AN `visibilityTimeoutSec = ceil(35 × 1.5) + 5 = 58` × 4 = 232s ≤ 240. Passes.

**Effect:** At most 1 Lambda invocation processes a PE job at any time → no concurrent-slot competition → `maxVms limit exceeded` rate drops from 95.7% → ~0%. Queue drain is serialised; each job takes ~30s (PE) or ~35s (AN). Throughput is lower (~2/min for PE), but that is acceptable in sandbox where there is no concurrent multi-tenant load; the journeys run single-tenant sequentially.

**Cost-positive claim:** The 264/minute PE throttle events (from `AWS/Bedrock-AgentCore Throttles`) go to ~0. M6 AgentRuntime cost ($69.68/30d) drops because failed invocations that hold micro-VMs are eliminated. Bedrock cost also drops (fewer failed agent starts that consume tokens before failing). Exact delta measurable via M3+M4 re-measurement ≥24h post-deploy.

**Trade-off acknowledged:** Sandbox-only change. Not appropriate for production where multiple concurrent decisions are expected (would create queue backlog under real multi-tenant load). Production fix requires maxVms-per-runtime quota increase or multiple runtime endpoints — tracked in `agentcore-maxvms-prod-quota-increase` (LATER).

**Alternatives considered + rejected:**
- **F2 (increase L-3E5722B2 quota):** The account-wide 1000 quota is not the binding constraint; the per-micro-VM single-session limit is. A quota increase would not help.
- **F3 (backoff layer):** More invasive, requires code changes in agent-orchestrator. The structural cause (10 concurrent slots competing for 1 micro-VM) persists even with backoff — backoff would just spread the failures over time, not eliminate them.
- **F4 (decouple memory strategy throttle):** Orthogonal to journey flakes per I3. The Haiku throttle pool is separate.
- **F5 (reduce decision-pipeline latency):** The pipeline is 101s/120s even with serial invocations. Latency reduction may help margin but does not address the 95.7% structural failure rate from concurrency. File as follow-up if serialisation leaves journey still marginal.

## 8. Validation gate

Acceptance:

```bash
# Two consecutive passes — both must be green, no rerun-after-fail tolerated.
pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path"
pnpm nx run nestfolio-e2e:e2e -- --grep "deposit-reload-mid-flight"
# (... wait for clean results ...)
pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path"
pnpm nx run nestfolio-e2e:e2e -- --grep "deposit-reload-mid-flight"
```

- **Required:** all 4 runs in the cadence above PASS first-try. A rerun-pass after a fail does NOT count as evidence and does NOT close the gate — see [[feedback-flake-means-broken]].
- **If a flake surfaces** (any single run fails then passes on rerun): pull CloudWatch evidence from the failure window into `## Flake investigation`, then run a SEPARATE confirmation pair (2 more consecutive runs, first-try green) before declaring shipped. The original failing run is recorded as evidence the system still flakes; the confirmation pair is the gate, not the rerun.
- Post-fix M3 + M4 re-measured ≥ 24h after deploy. Numbers land in §7's cost-positive vs cost-neutral classification per §4 quaternary branch.

_To be populated with concrete commit SHAs, deploy log line, run identifiers, and post-fix M3/M4 delta._

## 9. Shipping checklist

All commits land on `worktree-playwright-rebalance-real-agents-maxvms-remediation`. `finishing-a-development-branch` handles merge; do NOT run `gh pr create` + `gh pr merge` manually.

1. **Measurement pass commit** — populate §6, commit `docs(spec): baseline maxVms measurements`.
2. **Mechanism implementation commit** — one of Case A/B/C from §4. Commit scoped to affected service(s).
3. **Speculative test deletion commit** — delete `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` + `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts`. Verify via `grep -r inject-portfolio-updated apps/` that fixture has no other consumer. Commit `chore(nestfolio-e2e): delete speculative rebalance scenario — no production weight-drift trigger`.
4. **Backlog follow-up commits** — `backlog-add weight-drift-detector` + `backlog-add playwright-rebalance-after-weight-drift-detector` (parking with trigger language). Two separate commits + regenerated `BACKLOG.md`.
5. **Dossier rewrite commit** — Option A: keep ID, rewrite body. Title + Origin + Done Definition rewritten; `## Reframe history` section added linking original framing → why wrong → current scope. Frontmatter `notes:` updated. Commit `docs(backlog): reframe playwright-rebalance-real-agents-maxvms-remediation — workstream now targets journey maxVms remediation`.
6. **Deploy to dev** — `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<affected> 2>&1 | tee /tmp/deploy-rebalance-maxvms.log` (pre-authorized per CLAUDE.md).
7. **Validation runs** per §8. If multiple flakes surface, iterate on mechanism (escalate Case A → Case A+B if onboarding-bff tightening alone isn't enough).
8. **Ship-the-backlog-file commit** — set `status: shipped`, fill `validation_gate:` with mechanism commit SHA, deploy log line, 4 green journey run identifiers, M3/M4 post-fix delta.
9. **Regen BACKLOG.md** — `node .claude/skills/backlog-lint/lint.mjs --fix`.
10. **finishing-a-development-branch** per `/backlog-next` Step 6.7.
11. **ExitWorktree** with `discard_changes: true` after merge verified ancestor of main (per `/backlog-next` Step 6.8).
12. **Postflight** — `node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=worktree-playwright-rebalance-real-agents-maxvms-remediation`.

### Closing-phase derived-doc check

This workstream deletes a Playwright test file and modifies at most 2 service stacks. `detect-doc-derivation.mjs` should exit clean. If Case B is selected, the PE-ctrl and/or AN-ctrl `CLAUDE.md` cards may need a one-line update reflecting the new sandbox-derived `sqsMaxConcurrency`; the audit step catches this.

## 10. Related

- Parent dossier: `playwright-rebalance-real-agents-maxvms-remediation`.
- Follow-ups filed by this workstream: `weight-drift-detector`, `playwright-rebalance-after-weight-drift-detector`.
- Cost-context: `agentcore-maxvms-prod-quota-increase` (LATER, prod-scoped).
- Already shipped: `agentcore-invocation-resilience` (Lambda-layer retry/SQS-redrive — doesn't recover SF state whose 120s timer has expired), `agentcore-maxvms-browser-path-resilience` (idleTimeout=2min + maxLifetime=30min on IP/PE/MI/AN).
- Feedback applied: [[feedback-measure-before-proposing]], [[feedback-flake-means-broken]], [[feedback-e2e-gaps-queued-not-parking]], [[feedback-worktree-first-no-commits-on-main]], [[feedback-no-phantom-chains]], [[feedback-verify-before-documenting]].
