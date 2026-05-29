---
id: dashboard-live-push-portfolio-summary
status: queued
rank: 1
type: bug
notes: "PortfolioSummary KPI cards stale after BALANCE_UPDATED / PORTFOLIO_UPDATED until refresh; dashboard-publisher.ts only broadcasts AdvisoryStatus."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Dashboard PortfolioSummary live-push gap

The dashboard MFE renders `PortfolioSummary` KPI cards (`totalValueCents`, `cashBalanceCents`, `positionCount`, `driftPercent`) from the `getDashboard` query on mount. The DDB row is updated by `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` whenever `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, or `RECONCILIATION_COMPLETED` fires, but `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` only broadcasts `AdvisoryStatus`. Result: after a deposit lands or a trade fills, the KPI cards stay stale until the user manually refreshes.

UX impact: canonical "user just deposited, where's my money on the dashboard" gap.

Surfaced 2026-05-28 during `happy-path-pendingcount-wss-decrement-race` brainstorming (Option 1 — Activity-broadcast — audit of dashboard live-push coverage). Template for the fix: extend `dashboard-publisher.ts` broadcasts map with a `PortfolioSummary` entry, mapping the DDB image to a `publishDashboardUpdate(tenantId, portfolioSummary)` call. The existing `onDashboardUpdate` subscription already returns `Dashboard.portfolioSummary` per schema — the client just needs to request the field and the store needs to apply the patch. Follows the per-surface pattern established by the Activity workstream.

Promoted to QUEUED (rank 1) on 2026-05-29 boundary review: the gating dependency — the Activity live-broadcast workstream (`worktree-activity-live-broadcast` merged, `happy-path-pendingcount-wss-decrement-race` shipped 2026-05-29) — has landed, so the per-surface broadcast pattern this fix mirrors is now concrete. Paired with `dashboard-live-push-position-snapshots` (rank 2): same file (`dashboard-publisher.ts`), same fix shape. Aligns with the standing BFF-state-completeness rule.

Cheapest next step: confirm the publisher mutation already accepts an optional `portfolioSummary: PortfolioSummaryInput` arg (it doesn't today; schema needs a `PortfolioSummaryInput` + the mutation arg added), wire the broadcast entry, extend `ON_DASHBOARD_UPDATE` client subscription to request `portfolioSummary`, and merge into the store.

## Candidate generalisation — subscribe-before-query + merge

When this is implemented, apply the self-healing client pattern designed for the
Activity feed in `happy-path-pendingcount-wss-decrement-race` (spec
`docs/superpowers/specs/2026-05-29-activity-feed-subscribe-before-query-design.md`):
subscribe BEFORE the initial query, and reconcile on reconnect. PortfolioSummary
is single-value last-write-wins (not an append log), so the merge collapses to
"newest `updatedAt` wins" rather than a dedupe-union — but the
subscribe-before-query ordering and reconnect re-query still apply, otherwise
this path inherits the exact mount→subscribe gap the Activity feed fixed.
Consider extracting a shared `subscribe-then-reconcile` helper at that point
(rule-of-three: Activity + PortfolioSummary + PositionSnapshot).
