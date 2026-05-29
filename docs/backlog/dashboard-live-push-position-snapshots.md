---
id: dashboard-live-push-position-snapshots
status: queued
rank: 2
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

Surfaced 2026-05-28 during `happy-path-pendingcount-wss-decrement-race` brainstorming (Option 1 — Activity-broadcast — audit of dashboard live-push coverage). Note: positions are an ARRAY, not a scalar snapshot — design choice between (a) per-symbol delta broadcast (each row mutation pushes one symbol) and (b) full-list snapshot (refresh the entire array on any mutation). (a) scales better for tenants with many positions; (b) is simpler. Pick (a) vs (b) via brainstorming against the now-concrete Activity-broadcast per-surface pattern.

Promoted to QUEUED (rank 2) on 2026-05-29 boundary review alongside `dashboard-live-push-portfolio-summary` (rank 1): the gating dependency — the Activity live-broadcast workstream — shipped 2026-05-29, making its per-surface pattern concrete. Same file (`dashboard-publisher.ts`) and same fix shape as rank 1; intended to be executed as a pair.

Next step: pick (a) vs (b) via brainstorming, then mirror the Activity-broadcast surface design (separate `publishPositionUpdate` mutation + `onPositionUpdate` subscription if delta, or extend `publishDashboardUpdate` if full-list).

## Candidate generalisation — subscribe-before-query + merge

When this is implemented, apply the self-healing client pattern designed for the
Activity feed in `happy-path-pendingcount-wss-decrement-race` (spec
`docs/superpowers/specs/2026-05-29-activity-feed-subscribe-before-query-design.md`):
subscribe BEFORE the initial query, and reconcile on reconnect. PositionSnapshot
is a keyed collection (by `symbol`), so the merge is a dedupe-union by symbol
with newest-`lastUpdatedAt` wins — closer to the Activity feed's list-merge than
to PortfolioSummary's single-value case. Without subscribe-before-query +
reconnect re-query, this path inherits the same mount→subscribe gap. Consider
extracting a shared `subscribe-then-reconcile` helper at that point
(rule-of-three: Activity + PortfolioSummary + PositionSnapshot).
