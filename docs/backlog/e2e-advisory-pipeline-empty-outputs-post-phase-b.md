---
id: e2e-advisory-pipeline-empty-outputs-post-phase-b
status: shipped
type: bug
notes: "e2e gate: 2/22 suites red on main 2026-05-15 — root cause: AssemblePacket read obsolete portfolio['portfolio-construction'] key while Phase A renamed it to top-level allocations. Plus a parallel deploy-skew on portfolio-engine + ledger services. Fixed + redeployed; 4/4 GREEN."
references:
  - services/advisory/portfolio-engine-ctrl/src/agent-service.ts
  - services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts
  - libs/agent-orchestrator/src/wrap-agent-output.ts
  - libs/agent-orchestrator/src/memory/memory-client.ts
out_of_scope:
  - "ServiceUnavailableException FAILED execs from Bedrock throttling (separate parking: portfolio-engine-service-unavailable-asymmetric-handling)"
  - "LookupMandateSnapshot JSONPath miss on rows lacking operatingMode (separate regression — file once isolated)"
  - "30+ RUNNING-stuck SF executions from earlier integration runs (orphan SFs, separate cleanup)"
  - "Re-tuning mode envelope tolerances or POM polling intervals (UI/test-side band-aids)"
  - "Reverting Phase B commit d1fadfc1 wholesale (find the specific regression first)"
spec: null
plan: docs/superpowers/plans/2026-05-15-assemble-packet-agent-output-key-rename.md
topic_memory:
  - project_agent_runtime_structured_output.md
  - project_inter_agent_state_handoff.md
validation_gate: |
  Two distinct contributors, both addressed:

  (1) Deploy-skew. Portfolio-engine AgentCore runtime + 4 advisory Lambdas
  were last deployed 2026-05-14 14:17-14:18 UTC, predating Phase A (Phase A
  merged 2026-05-14 15:49 UTC). Redeployed advisory-{portfolio-engine,
  investor-profile, market-intelligence, narrative}-ctrl and decision-
  workflow-ctrl. After this redeploy, rebalance-on-drift went GREEN (98s)
  but operating-mode still timed out — same empty proposedTrades —
  surfacing the second contributor.

  (2) AssemblePacket consumer-side key-rename bug. Phase A renamed the
  top-level agent output keys in
  services/advisory/portfolio-engine-ctrl/src/agent-service.ts:146-151
  from the LangGraph node names (portfolio-construction / rebalance-planner)
  to semantic names (allocations / trades), but the AssemblePacket handler
  was never updated to follow the rename. It kept reading
  portfolio['portfolio-construction'].allocations, which is now undefined
  → defence-in-depth `?? {}` masked the error → allocationsArray = [] →
  every DecisionPacket landed with proposedTrades=[] in dev. Fix at
  commit 9f0fd468 changed the lookup to portfolio.allocations.allocations
  and renamed the local variable from `construction` to `allocationEnvelope`.

  E2e gate post-fix (NESTFOLIO_INTEG_PREFIX=dev, 2026-05-15):
  - rebalance-on-drift.e2e.test.ts: PASS in 118s
  - operating-mode-recommendation-shape.e2e.test.ts: PASS in 273s
    (all 3 modes — CONSERVATIVE, BALANCED, AGGRESSIVE — within envelope)
  - Test Suites: 2 passed, 2 total / Tests: 4 passed, 4 total

  Ship commits (worktree fix/assemble-packet-agent-output-key):
  - 9f0fd468 fix(decision-workflow-ctrl): read post-Phase-A agent-output shape in AssemblePacket
---

# e2e advisory pipeline emits empty outputs post-Phase-B

## Failures observed 2026-05-15

`pnpm nx run e2e-feature-tests:test-e2e-features` against deployed dev — 4 failures in 2 suites:

1. **`apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`** — all 3 modes (CONSERVATIVE, BALANCED, AGGRESSIVE) time out at 360s waiting for non-empty `proposedTrades` to materialize.
2. **`apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`** — test times out at 240s; `getDecisionHistory` returns only the fixture-induced decisions (DEPOSIT_DETECTED, MANDATE_SNAPSHOT_CREATED), never the explicit PORTFOLIO_DRIFT_DETECTED row.

Tenant IDs captured from log:

- `e2e-1778836221151-58e9f0bc` — CONSERVATIVE
- `e2e-1778836609458-c84dd206` — BALANCED
- `e2e-1778836982862-7ddbf046` — AGGRESSIVE
- `e2e-1778835591619-3ba5ebf0` — drift test

## Evidence (AWS console, dev account 771924376645)

Step Function `dev-decision-workflow-ctrl-decisionstatemachine`, last 3h: **30 RUNNING / 15 SUCCEEDED / 15 FAILED** out of 60 executions.

**All 6 SF executions matching the 3 operating-mode test tenants SUCCEEDED** (one MANDATE_SNAPSHOT_CREATED + one DEPOSIT_DETECTED per tenant). Output of the CONSERVATIVE MANDATE_SNAPSHOT_CREATED execution (exec name `4a197d27-06b0-3646-4fa6-08d31a070872_…`):

```
InvokeInvestorProfile.operatingMode: CONSERVATIVE      ← propagated correctly
InvokeInvestorProfile.agentOutput.goals: <empty>
InvokeInvestorProfile.agentOutput.risk:  <empty>
InvokeMarketIntelligence.agentOutput.signals: list[9]  ← has content
InvokePortfolioEngine.agentOutput.allocations: <empty> ← THE REGRESSION
InvokePortfolioEngine.agentOutput.trades:      <empty>
InvokeAdvisoryNarrative.agentOutput.summary:   "Your portfolio is being positioned…" (218 words)
decisionPacket.proposedTrades:  list[0]
decisionPacket.currentPositions: list[0]
decisionPacket.portfolioValue:   0
complianceResult.decision: APPROVED
```

The SF treats this as success (no `DegradedAgentOutputError`, no `assertOrchestratorOutput` throw) because the **expected agent keys (`portfolio-construction`, `rebalance-planner`) exist on the result, with empty content**. `assertOrchestratorOutput` checks key presence, not content.

For the drift test, exec `71e75bba-7f9f-a0eb-7b0d-53d9913aa866_…` started 2026-05-15T11:01:06+02:00 with `type: PORTFOLIO_DRIFT_DETECTED, tenantId: e2e-1778835591619-3ba5ebf0` and traversed states: LookupMandateSnapshot → InvokeInvestorProfile → InvokeMarketIntelligence → InvokePortfolioEngine → InvokeAdvisoryNarrative → AssembleDecisionPacket → WaitForCompliance → RequestUserConfirmation (currently paused at the last). AssembleDecisionPacket exited normally, but `getDecisionHistory` for the same tenant returns no PORTFOLIO_DRIFT_DETECTED row.

## Hypothesis — REVISED 2026-05-15 to deploy-skew

Compared committed Phase A (`676dd75c`, 2026-05-14 15:49 UTC) and Phase B (`1e1e23d4`, 2026-05-14 19:21 UTC) timestamps against deployed dev artifacts:

| Component (dev) | LastModified UTC | Position |
|---|---|---|
| `portfolio_engine_agents` AgentCore runtime | 2026-05-14 14:17 | **pre-Phase A** |
| `dev-portfolio-engine-ctrl-IngressHandler` Lambda | 2026-05-14 14:18 | **pre-Phase A** |
| `dev-decision-workflow-ctrl-AssemblePacket` Lambda | 2026-05-14 14:17 | **pre-Phase A** |
| `investor_profile_agents` runtime + Lambda | 2026-05-14 18:24 | Phase A only |
| `market_intelligence_agents` runtime | 2026-05-14 18:29 | Phase A only |
| `advisory_narrative_agents` runtime + Lambda | 2026-05-14 22:08 | Phase A + B |

**Root cause: deploy skew.** The portfolio-engine AgentCore runtime + Lambda predate Phase A by ~90 minutes; the AssemblePacket Lambda is also pre-Phase A. Phase A migrated inter-agent handoff to SF state (`$.agentResults.<Upstream>.agentOutput`); the SF state machine was updated, but the portfolio-engine runtime that produces those outputs was never redeployed. That explains why the SF SUCCEEDS with empty `allocations` / `trades`: the older portfolio-engine returns a Memory-write-shaped payload that the new SF accepts under the `agentOutput` Parameters key but with empty content per the new schema.

This is fixable with a `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl,investor-profile-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl` and a re-run.

Earlier hypotheses (kept for history): a true Phase B regression in `agent-service.ts` / `wrapAgentOutput`, or a CDC/advisory-bff transform issue for the drift sub-case. Both are downstream of the skew — verify after redeploy.

## Drift `funded()` sub-case

The drift test rerun failed in the `funded()` fixture: "CashBalance not materialized within 60s". The ledger Lambdas (`dev-ledger-ctrl-*`) all have LastModified of 2026-04-25 — a 20-day-old deploy. Same deploy-skew family; redeploy ledger if the drift test still fails after the advisory redeploy.

## Why this should be QUEUED rank 1

Per feedback `e2e-gaps-queued-not-parking`: anything blocking `apps/e2e-feature-tests` or `apps/nestfolio-e2e` going green is queued, not parking. These two suites block the e2e gate today.

Note: pre-existing dossiers `operating-mode-shape-empty-proposed-trades` (shipped 2026-05-06, partial) and `non-investor-profile-trigger-operating-mode-lookup` (shipped 2026-05-10) had validation gates claiming **"all 3 modes GREEN"** and **"30/33 e2e suites PASS"** — that's the GREEN baseline this dossier regresses from. Phase A+B (2026-05-14) is the most recent intervening change.

## Rerun 2026-05-15 (confirms determinism)

A second run scoped to just the two failing files (`--testPathPatterns='rebalance-on-drift|operating-mode-recommendation-shape'`) repeated the same 4 failures:

- operating-mode × 3 modes: identical "No DecisionPacket with non-empty proposedTrades materialized within 360000ms" against fresh tenants `e2e-1778840686625-36d8a6d6` / `e2e-1778841063430-053c978f` / `e2e-1778841458874-98f4dca8`.
- rebalance-on-drift: **failed earlier**, in the `funded()` fixture — "CashBalance not materialized within 60s". The underlying deposit→ledger CashBalance projection is also degraded, broadening scope beyond the advisory agents alone.

Conclusion: deterministic post-Phase-B regression. **Not an LLM flake.**

## Cheapest next step

1. Isolate Phase B vs deploy-skew: diff the deployed Lambda code timestamps for `dev-portfolio-engine-ctrl-event-listener` (and `dev-ledger-*` for the drift sub-case) against the local Phase B commit `d1fadfc1`; if deployed predates Phase B, this is a deploy-skew flake — just redeploy. If deployed includes Phase B, it's a true Phase B regression.
2. Inspect AgentRuntime CloudWatch logs (`/aws/bedrock-agentcore/runtime/dev-portfolio-engine-ctrl-*`) for one of the empty-output executions — the AgentCore-side trace will show whether the LangGraph emitted empty values or whether they were stripped client-side.
3. Drift sub-case: query DDB `dev-decision-workflow-ctrl-table` directly for `decisionId` from exec `71e75bba-…` to determine whether the DecisionPacket row exists or was never persisted. Separately inspect `dev-ledger-*` Lambda logs for the second rerun's `funded()` failure — the fixture failure points at a ledger-side regression too.

Pivot to `superpowers:writing-plans` + worktree (`feedback_worktree_first_no_commits_on_main`) once the failing layer is pinned.
