---
id: weight-drift-detector
status: parking
type: design
notes: "Production-feature gap: no service emits PORTFOLIO_DRIFT_DETECTED on the weight-vs-target axis (the kind that motivates a rebalance). reconciliation-ctrl only handles Intent-vs-Settlement drift (broker errors). DWC SF reacts to the event correctly but no producer exists on the user-driven path. Surfaced 2026-05-27 during playwright-rebalance-real-agents-maxvms-remediation brainstorming."
references:
  - services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/ledger/reconciliation-ctrl/src/domain/events.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# weight-drift-detector

## What's missing
The system has the rebalance code path (DWC SF starts on PORTFOLIO_DRIFT_DETECTED, PE+AN produce a rebalance decision, advisory-bff projects it, /advisory renders the trades) but no producer of PORTFOLIO_DRIFT_DETECTED on the weight-deviation axis. reconciliation-ctrl exists but its scope is Intent-vs-Settlement (catches broker errors), not target-weight-vs-current-weight (would catch price drift, deposit-driven imbalance, etc.).

## Open questions for design (when this is brainstormed)
1. Where does the detector live?
   - (a) Extend reconciliation-ctrl with a second reconciler comparing currentWeights vs targetWeights from mandate.
   - (b) New service (advisory or ledger domain) dedicated to weight-drift.
   - (c) Move into advisory-bff as a derived projection.
2. What triggers the check?
   - Subscribe to LedgerSnapshot CDC + MarketSnapshot CDC (recompute on either positions change or price change).
   - Periodic timer (cron-driven sweep).
3. What's the threshold contract? Per-instrument vs portfolio-level?
4. How does the detector debounce (avoid emitting PORTFOLIO_DRIFT_DETECTED on every tick when the market is moving)?
5. Does it emit per-tenant or per-portfolio?

## Status history
Originally filed `queued` per [[feedback-e2e-gaps-queued-not-parking]] because it blocks a future UI-driven rebalance Playwright scenario. Moved to `parking` 2026-05-27 by user request — the dependent e2e scenario (playwright-rebalance-after-weight-drift-detector) is itself parked, so there was no live e2e gate waiting on this.

Re-promoted to `queued` (rank 3) on the 2026-05-29 boundary review by user direction — adopted as a standalone production-feature gap (a real rebalance path with no weight-axis producer), not on the strength of the still-parked Playwright scenario. This is a `design` item: it needs brainstorming through the open questions below before any plan/implementation. Ranked behind the dashboard live-push pair (rank 1–2), which is smaller and shovel-ready.

## Related
- Parent: playwright-rebalance-real-agents-maxvms-remediation (the discovery)
- Will block: playwright-rebalance-after-weight-drift-detector (parking)
