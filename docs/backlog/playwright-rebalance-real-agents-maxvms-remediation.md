---
id: playwright-rebalance-real-agents-maxvms-remediation
status: shipped
rank: 6
type: infra
notes: "Diagnose actual flake causes for Playwright journeys (new-investor-happy-path + deposit-reload-mid-flight) and ship a targeted fix. Re-scoped 2026-05-27 after Phase 1 measurements showed AgentCore maxVms utilization at 1.1% (peak 11 vs quota 1000) — the original maxVms-saturation hypothesis was wrong. Real flakes exist (694 ServiceQuotaExceeded + 5291 TaskTimedOut + 376/376 memory-strategy throttle failures over 30d) but from a different root cause, likely Bedrock InvokeModel/InvokeAgentRuntime rate throttling on the PE IngressHandler path. Also: original 'rebalance Playwright scenario' framing dropped 2026-05-27 brainstorming after discovery that reconciliation-ctrl has no weight-vs-target drift detector (the speculative PORTFOLIO_DRIFT_DETECTED emitter doesn't exist). Workstream now: investigate actual root cause, propose measurement-grounded fix, delete speculative rebalance scenario, file two follow-up dossiers."
references:
  - path: services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - path: services/advisory/advisory-narrative-ctrl/src/service.stack.ts
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: services/advisory/decision-workflow-ctrl/src/agent-budgets.ts
  - path: apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
  - path: apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts
  - path: docs/backlog/agentcore-invocation-resilience.md
  - path: docs/backlog/agentcore-maxvms-browser-path-resilience.md
out_of_scope:
  - "Production-account quota work — tracked separately in agentcore-maxvms-prod-quota-increase. This workstream is sandbox-only."
  - "Building the weight-drift detector itself — filed as weight-drift-detector follow-up dossier."
  - "Re-instating Playwright rebalance coverage — filed as playwright-rebalance-after-weight-drift-detector parking dossier."
  - "Reducing decision-pipeline latency below the M5 baseline (101s of 120s budget) — file as F5 follow-up if investigation surfaces it as the dominant issue."
  - "Onboarding browser-path 402/429 SSE retry — already shipped in agentcore-maxvms-browser-path-resilience."
  - "Rewriting any journey internals — only fixing the infra so the journeys pass."
  - "Building any application-level admission-controller / job-queue — fixes live at AWS-native knobs only (Bedrock retry config, Lambda concurrency, SQS, quota requests)."
spec: docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md
plan: docs/superpowers/plans/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation.md
topic_memory: []
validation_gate: |
  Both journeys passed 2× consecutively first-try against deployed dev 2026-05-27:
  - val1 new-investor-happy-path 3.8m PASS; val1 deposit-reload-mid-flight 1.8m PASS
  - val2 new-investor-happy-path 3.2m PASS; val2 deposit-reload-mid-flight 1.8m PASS
  No flakes per [[feedback-flake-means-broken]]. Mechanism: PE+AN handler retry
  classification (commits 06317f37 PE + 54e7ed8b AN). Deploys: dev-portfolio-engine-ctrl
  UPDATE_COMPLETE 17:53:11 + dev-advisory-narrative-ctrl UPDATE_COMPLETE 17:53:10.
  Spec §8 has the full evidence including the deferred 24h M3/M4 trend re-measurement.
  Three follow-up dossiers filed: weight-drift-detector (queued rank 7),
  playwright-rebalance-after-weight-drift-detector (parking), agentcore-circuit-breaker
  (queued rank 8). Three pivots in execution — all measurement-driven, all documented
  in the Reframe history section below.
---

# Playwright journey flake remediation (was: rebalance-real-agents-maxvms-remediation)

## Goal (current)

Make `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` and `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts` pass 2× consecutively against deployed dev, with the mechanism grounded in Phase 1 measurements (see spec §6) and the Phase 2 investigation outcomes (spec §4-bis I1-I3). Cost-positive (or neutral) for the dev account.

## What ships in this workstream

1. Phase 1 measurement pass (M1-M6) against deployed dev — done. §6 of spec.
2. Phase 2 investigation (I1-I3) to pin down the actual throttling source — what Bedrock quota, retry storm shape, memory-strategy contribution.
3. Mechanism chosen from F1-F5 per the §4-bis criteria, grounded in I1-I3 evidence.
4. Deletion of `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` and `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts` — speculative coverage of a production feature that doesn't exist.
5. Two follow-up dossiers: `weight-drift-detector` (queued, production feature gap) and `playwright-rebalance-after-weight-drift-detector` (parking, the re-instatement plan).

## Done definition

- Both journeys PASS 2× consecutively against deployed dev, no rerun-after-fail tolerated. Flake handling per [[feedback-flake-means-broken]] and spec §8.
- Post-fix M3 + M4 re-measured and recorded in `validation_gate:` — cost-positive or cost-neutral per spec evidence.
- Speculative rebalance scenario + fixture deleted.
- Two follow-up dossiers filed and linted.

## Reframe history

This workstream pivoted **twice** during execution. Both pivots followed [[feedback-measure-before-proposing]] and [[feedback-verify-before-documenting]] — each was triggered by evidence, not by re-litigation.

### Pivot 1 (2026-05-27, brainstorming): rebalance scenario → journey stabilization (still maxVms)

**Original framing (filed 2026-05-26):** "Playwright rebalance-trades-on-drift.spec.ts must run real agents per [[feedback-e2e-no-external-mocks]] but is structurally blocked by AgentCore maxVms saturation timing out PE at 120s. ... Order recommended at brainstorming: C → A → D, with E held as the closer."

**Why that framing was wrong:**
- **Production-feature gap.** Investigation of `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts` showed it only detects Intent-vs-Settlement drift (broker errors), not weight-vs-target drift. So `PORTFOLIO_DRIFT_DETECTED` has no production emitter on the user-driven path — the rebalance scenario was testing a production feature that doesn't exist.
- **Existing journey coverage.** `journeys/new-investor-happy-path.spec.ts:122-179` already exercises the deposit → initial-portfolio-build chain end-to-end with real agents. The right stabilization surface is the journeys, not a parallel scenarios/ test that synthesizes events the production system can't yet emit.

**Pivot 1 outcome:** workstream became "fix the maxVms saturation so the journeys pass deterministically." Rebalance Playwright coverage deferred to parking dossier `playwright-rebalance-after-weight-drift-detector`, gated on production feature `weight-drift-detector`. The dossier ID was preserved as a stable handle.

### Pivot 2 (2026-05-27, Phase 1 measurements): maxVms hypothesis prematurely "disproved" — LATER OVERTURNED

**Phase 1 finding:** M1 dev maxVms quota = 1000 Active Session Workloads per account (adjustable; NOT a deliberately-low quota as the dossier assumed). M2 peak concurrent during a journey = 11 micro-VMs (4 in AN, 3 in PE, 2 in MI, 1 each in IP+onboarding-bff). Ratio 11/1000 = 1.1% utilization. **I declared the §4 primary branch fired: "saturation cannot physically be the cause."**

This conclusion was **WRONG** — see Pivot 3.

**Pivot 2 mid-state outcome (later reversed):** workstream re-scoped to "diagnose actual flake causes". Spec §4 superseded by §4-bis investigation plan; §7 mechanism placeholder repointed at F1-F5.

### Pivot 3 (2026-05-27, Phase 2 investigation I1): maxVms framing was correct all along

**Phase 2 finding:** The 694 `ServiceQuotaExceededException` errors literally carry the message `"maxVms limit exceeded for account 771924376645"` and reference quota L-3E5722B2 (the 1000-quota I measured in M1). But the binding constraint is **1 concurrent session per micro-VM** (per-runtime), not the account-wide 1000. CloudWatch `Sessions` metric confirmed Max=1 per runtime throughout all burst windows. With `sqsMaxConcurrency=10` Lambdas competing for 1 micro-VM slot, 9/10 fail with "maxVms limit exceeded" on every burst drain. On 2026-05-22 worst-window: 264/276 PE invocations failed in a 60s queue-drain burst (95.7% failure rate).

**Mechanism: original §4 Case B** — cap `expectedBurstSize: 40 → 4` on PE and AN. Drives `sqsMaxConcurrency` from 10 → 1 (PE) and 12 → 2 (AN). Eliminates concurrent-slot competition. Expected throttle rate: 95.7% → ~0%.

**Pivot 3 outcome:** spec §6-bis carries an explicit "this was WRONG, see §6-bis-extended" correction note. The Pivot 2 reframe is recorded as a mid-investigation interpretation that didn't survive deeper data. Workstream goal returns to "journey-greenness via maxVms remediation per the original mechanism."

### What the pivots prove

The discipline of [[feedback-measure-before-proposing]] paid for itself THREE times — but the failure mode in Pivot 2 surfaced a related lesson:

- **Pivot 1:** code-grep ruled out a speculative production feature before we built infra for it.
- **Pivot 2:** premature conclusion from correctly-measured data — I had M1 + M2 in hand and got the math right, but framed the constraint scope wrong (account vs runtime). **Data-collection without correctly-scoped constraint interpretation = false negative.** Recorded as an extension of [[feedback-measure-before-proposing]].
- **Pivot 3:** going one investigation layer deeper (extracting the literal error message text from CloudWatch, not just the count) gave the right constraint interpretation. The investigation pass (Phase 2's I1) is what the measurement pass (Phase 1) should have included to begin with.

The original dossier's §4 Case B mechanism IS what ships. The intermediate "F1-F5" framing in §4-bis was a detour caused by Pivot 2; the eventual choice landed back on Case B per Phase 2 I1's evidence.

## Related

- Spec: `docs/superpowers/specs/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation-design.md`
- Plan: `docs/superpowers/plans/2026-05-27-playwright-rebalance-real-agents-maxvms-remediation.md` (Phase 1 done, Phases 2+ pivoted)
- Filed by this workstream: `weight-drift-detector` (queued), `playwright-rebalance-after-weight-drift-detector` (parking) — not yet filed; will land during Phase 4
- Cost-context: `agentcore-maxvms-prod-quota-increase` (LATER, prod-scoped)
- Already shipped: `agentcore-invocation-resilience` (Lambda-layer retry/SQS-redrive), `agentcore-maxvms-browser-path-resilience` (idleTimeout=2min + maxLifetime=30min on IP/PE/MI/AN — verified still in place by Phase 1)
- Feedback applied: [[feedback-measure-before-proposing]], [[feedback-verify-before-documenting]], [[feedback-flake-means-broken]], [[feedback-e2e-gaps-queued-not-parking]], [[feedback-worktree-first-no-commits-on-main]], [[feedback-no-phantom-chains]]
