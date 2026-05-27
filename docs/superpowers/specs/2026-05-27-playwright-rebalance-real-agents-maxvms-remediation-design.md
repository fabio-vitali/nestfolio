# Playwright rebalance — real-agents path & maxVms remediation (design)

**Workstream:** `playwright-rebalance-real-agents-maxvms-remediation`
**Status:** active
**Date:** 2026-05-27
**Lane:** Complex (worktree-first per [[feedback-worktree-first-no-commits-on-main]])

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

## 6. Baseline measurements

_To be populated as the first commit in execution (per §3)._

| Quantity | Measured value | Source command |
|---|---|---|
| M1 dev maxVms quota | _TBD_ | `aws service-quotas list-service-quotas` |
| M2 peak concurrent — onboarding-bff | _TBD_ | `list-agent-runtime-sessions` |
| M2 peak concurrent — portfolio-engine-ctrl | _TBD_ | same |
| M2 peak concurrent — advisory-narrative-ctrl | _TBD_ | same |
| M2 peak concurrent — investor-profile-ctrl | _TBD_ | same |
| M2 peak concurrent — market-intelligence-ctrl | _TBD_ | same |
| M3 ServiceQuotaExceeded count (30d) | _TBD_ | logs insights |
| M4 SF TaskTimedOut count (30d) | _TBD_ | cloudwatch + insights |
| M5 journey wall-clock baseline | _TBD_ | instrumented Playwright run |
| M6 Bedrock 30d cost | _TBD_ | cost explorer |
| Memory strategy activity (tertiary) | _TBD_ | `list-memory-strategy-executions` |

## 7. Mechanism selected

_To be populated after §6, deriving from §4 decision tree._

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
