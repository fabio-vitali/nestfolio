---
id: dashboard-live-push-position-snapshots
status: parking
type: bug
notes: "PositionSnapshot list stale after PORTFOLIO_UPDATED until refresh; dashboard-publisher.ts only broadcasts AdvisoryStatus."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Dashboard PositionSnapshot live-push gap

The dashboard MFE renders the holdings list from `getPositionSnapshots` on mount. The DDB rows are updated by `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` whenever `PORTFOLIO_UPDATED` fires (after a trade fill or rebalance), but `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` only broadcasts `AdvisoryStatus`. After a fill, the holdings list stays stale until the user manually refreshes the dashboard.

UX impact: holdings table is the most-watched widget post-trade; staleness here looks like the trade didn't go through.

Surfaced 2026-05-28 during `happy-path-pendingcount-wss-decrement-race` brainstorming (Option 1 — Activity-broadcast — audit of dashboard live-push coverage). Note: positions are an ARRAY, not a scalar snapshot — design choice between (a) per-symbol delta broadcast (each row mutation pushes one symbol) and (b) full-list snapshot (refresh the entire array on any mutation). (a) scales better for tenants with many positions; (b) is simpler. Adopt whichever pattern fits after the Activity workstream's per-surface pattern is concrete.

Cheapest next step: pick (a) vs (b) via brainstorming, then mirror the Activity-broadcast surface design (separate `publishPositionUpdate` mutation + `onPositionUpdate` subscription if delta, or extend `publishDashboardUpdate` if full-list).
