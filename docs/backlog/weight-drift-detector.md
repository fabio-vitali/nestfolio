---
id: weight-drift-detector
status: queued
rank: 7
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

## Why this is queued (not parking)
Per [[feedback-e2e-gaps-queued-not-parking]]: this blocks the future re-instatement of a UI-driven rebalance Playwright scenario (playwright-rebalance-after-weight-drift-detector). Litmus: without this, rebalance can never be exercised organically end-to-end.

## Related
- Parent: playwright-rebalance-real-agents-maxvms-remediation (the discovery)
- Will block: playwright-rebalance-after-weight-drift-detector (parking)
