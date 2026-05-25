---
id: ferry-ledger-positions-to-advisory-steady-state-decisions
status: queued
rank: 1
type: bug
notes: "PortfolioEngine agent doesn't emit currentPositions; no SF hop plumbs ledger CASH_BALANCE+POSITION_SNAPSHOT into advisory. AssemblePacket sees currentPositions=[] always → post-units-fix isInitialBuild=true system-wide → MAX_SINGLE_TRADE+TURNOVER_CAP skip on every decision, not just first-deposit. Steady-state guardrails effectively disabled. Surfaced 2026-05-25 by OQ1 of the decision-pipeline-units-calibration-suitability spec; the parent workstream consciously ships the skip as 'strictly better than units-bug status quo' (those rules fire absurdly today, e.g. 'Trade VTI (2000.0%) exceeds 20%'), but the steady-state regime needs both ledger-to-advisory plumbing AND an e2e scenario covering a post-onboarding rebalance — which would currently fail."
references:
  - path: services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts
    anchor: L75
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts
    anchor: L4
  - path: services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts
    anchor: L290
  - path: docs/superpowers/specs/2026-05-25-decision-pipeline-units-calibration-suitability-design.md
  - path: apps/nestfolio-e2e/src/journeys
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Steady-state decision flow lacks ledger position plumbing

## Why this is queued (not parking)

Per [[feedback-e2e-gaps-queued-not-parking]] anything required to make the e2e suite truly green is queued. A production bug we don't have e2e coverage for is itself the e2e gap — either we add the scenario (which would fail until the fix lands) or we're hiding the bug. This item is both the fix AND its missing e2e scenario.

## The production bug

`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:75` reads `(portfolio?.currentPositions as unknown[] | undefined) ?? []`. The PortfolioEngine agent's structured-output schema (`services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts:4`) does NOT include `currentPositions` — the agent reasons over `allocations` only. No SF state hop in `decision-state-machine.ts` plumbs the ledger's actual positions into the agent output or AssemblePacket. Net effect: `currentPositions=[]` for every decision in production today, regardless of whether the investor actually has holdings.

Post-merge of the decision-pipeline-units-calibration-suitability workstream:

- `isInitialBuild = currentPositions.length === 0` will evaluate `true` for every decision.
- `GuardrailEvaluator.checkSingleTradeSize` + `checkTurnoverCap` early-return `passed: true` ("Skipped for initial portfolio construction") on every decision.
- Steady-state guardrail enforcement is effectively disabled.

This is consciously shipped by the decision-pipeline workstream as "strictly better than the units-bug status quo" — those guardrails fire absurdly under the units bug today (e.g. `Trade VTI (2000.0%) exceeds max single trade limit of 20%`), so the new behaviour ("skip pending plumbing") is not a regression. But it is an open bug that this workstream creates the obligation to close.

## The e2e gap

`apps/nestfolio-e2e/src/journeys/` currently has no scenario that exercises a steady-state decision (post-onboarding, with an existing portfolio, triggered by something like `PORTFOLIO_DRIFT_DETECTED` or a subsequent `DEPOSIT_DETECTED`). Such a scenario would currently fail because:

- `currentPositions=[]` would make `isInitialBuild=true` (after the units-fix lands), so the guardrails skip when they shouldn't.
- `portfolioValueCents = currentPositionsValueCents + (triggerAmountCents ?? 0)` would be wrong (`currentPositionsValueCents=0` always; `triggerAmountCents` may be 0 for non-deposit triggers).
- `SUITABILITY` would still pass (it reads `targetWeightPercent` not cents).

So the queued work has two halves: (a) ferry positions, (b) add the e2e scenario that would have caught this.

## Design sketch (informal — full brainstorm at adoption)

Two plausible mechanisms (settle at brainstorm):

- **A — Cross-domain adapter forwarding.** Add `CASH_BALANCE_UPDATED` + `POSITION_SNAPSHOT_UPDATED` to `services/advisory/advisory-adpt` subscriptions; project per-tenant `LedgerSnapshot` row in `decision-workflow-ctrl` state table via a new `SnapshotProjectorIngress` branch (or extend the existing one). SF reads via DDB GetItem before AssemblePacket (same shape as `LookupInvestorProfileSnapshot`). Plumb `ledgerSnapshot.cashBalanceCents` + `ledgerSnapshot.positions` into the AssemblePacket Lambda payload.
- **B — Direct SF state from the trigger event.** `PORTFOLIO_DRIFT_DETECTED` could carry portfolio snapshot on its subject. Simpler but couples each trigger event to portfolio shape; brittle.

Recommend A unless a faster path emerges.

## Done definition

- `currentPositions` is correctly populated on AssemblePacket input for non-deposit triggers (and for second-deposit triggers after an initial build).
- `portfolioValueCents = sum(positions[].marketValueCents) + cashBalanceCents + (triggerAmountCents ?? 0)`.
- `isInitialBuild` correctly evaluates `false` once there are positions.
- `MAX_SINGLE_TRADE` + `TURNOVER_CAP` fire correctly in steady-state.
- Integration test in `decision-workflow-ctrl` asserts plumbed positions reach AssemblePacket.
- Integration test in `compliance-ctrl` asserts MAX_SINGLE_TRADE + TURNOVER_CAP fire under steady-state input.
- New e2e scenario in `apps/nestfolio-e2e/src/journeys/` that exercises a post-onboarding rebalance decision, asserts realistic compliance evaluation. Two consecutive passes per [[feedback-flake-means-broken]].

## Out of scope (deferred to its own workstreams)

- Drift-rebalance calibration of guardrail-params (whether BALANCED maxSingleTradePercent=10 + monthlyTurnoverCapPercent=25 are correct for steady-state) — separate item once we can observe how often they fire.
- Real ledger position market-value recalculation on price change (today positions carry stale prices) — separate item.

## Related

- Parent workstream: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability spec).
- Topic memory: `project_e2e_feature_tests.md`.
- Feedback: [[feedback-e2e-gaps-queued-not-parking]], [[feedback-no-api-between-services]] (events only, no cross-domain DDB reads).
