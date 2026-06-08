---
id: dashboard-live-push-position-snapshots
status: queued
rank: 5
type: bug
notes: "TRANSPORT-ONLY, now unblocked (2026-06-05): live-push broadcast for the holdings list. Position-row materialization is DONE — bff-read-model-materialization-redesign shipped, so position-snapshot.ts materializes each holding via projectVersioned. Only transport remains; fully greenfield (no publishPositionUpdate/onPositionUpdate/PositionBroadcast/client-merge yet). Paired with dashboard-live-push-portfolio-summary (rank 1)."
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

Scoped during the 2026-05-29 boundary review alongside `dashboard-live-push-portfolio-summary`: the gating dependency — the Activity live-broadcast workstream — shipped 2026-05-29, making its per-surface pattern concrete. Same file (`dashboard-publisher.ts`) and same fix shape; intended to be executed as a pair.

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

## Now unblocked (2026-06-05) — materialization shipped, transport remains

The materialization dependency `bff-read-model-materialization-redesign` has **shipped**
(`services/investor/dashboard-bff/src/transforms/position-snapshot.ts` now materializes
each holding via `projectVersioned`), so this is promoted to QUEUED alongside
`dashboard-live-push-portfolio-summary`. Unlike that half-wired surface, the position
transport is **fully greenfield** (re-verified 2026-06-05): no `publishPositionUpdate`
mutation, no `onPositionUpdate` subscription, no `PositionBroadcast` type, and no client
merge exist yet. **Transport decision already resolved in the 2026-05-29 brainstorming**
(carry forward, do not re-litigate): **per-symbol delta**, not full-list. The publisher is DDB-stream-driven (one
changed row per stream record), so a delta maps 1:1 to a frame exactly like
Activity; full-list would force a fan-in re-query of all rows per single-row
change and collapse the client merge back to wholesale-replace (the clobber the
Activity fix removed). Surface: new `publishPositionUpdate` mutation +
`onPositionUpdate` subscription + `PositionBroadcast { tenantId, position }`
(mirrors `ActivityBroadcast`); client `mergePositions` keyed by `symbol`,
newest-`lastUpdatedAt` wins, routed through the shared `subscribe-then-reconcile`
helper. **Known limitation:** `weightPercent` is relative, so a per-symbol delta
leaves sibling weights transiently stale; clean mitigation is to derive weights
client-side from `marketValueCents` — relevant only to the transport item, not
the read-model redesign.
