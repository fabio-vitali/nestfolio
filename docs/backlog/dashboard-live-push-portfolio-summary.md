---
id: dashboard-live-push-portfolio-summary
status: queued
rank: 1
type: bug
notes: "TRANSPORT-ONLY, now unblocked (2026-06-05): live-push broadcast for PortfolioSummary KPI cards. The materialization half is DONE — bff-read-model-materialization-redesign (all 7 WS) shipped, so portfolio-summary.ts now writes cashBalanceCents/positionCount atomically with no accumulate double-count. Only the AppSync broadcast transport remains; the Dashboard.portfolioSummary schema field + a portfolioSummary:null resolver stub already exist (half-wired)."
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

Scoped during the 2026-05-29 boundary review: the gating dependency — the Activity live-broadcast workstream (`worktree-activity-live-broadcast` merged, `happy-path-pendingcount-wss-decrement-race` shipped 2026-05-29) — landed, making the per-surface broadcast pattern this fix mirrors concrete. Paired with `dashboard-live-push-position-snapshots`: same file (`dashboard-publisher.ts`), same fix shape. Aligns with the standing BFF-state-completeness rule.

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

## Now unblocked (2026-06-05) — materialization half shipped, transport remains

Brainstorming (2026-05-29) found this was **two gaps, not one**. The materialization
half — `cashBalanceCents`/`positionCount` never written to the `PortfolioSummary` row
(only the `StreamSnapshot` simulation row), and `totalValueCents` `accumulate`-d into a
latent double-count across the `BALANCE_UPDATED` + `PORTFOLIO_UPDATED` pair one fill
emits — was the same structural-zero / out-of-order / sparse-row class that motivated the
systemic **`bff-read-model-materialization-redesign`**. That program (all 7 workstreams)
has now **shipped**: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
writes `cashBalanceCents` + `positionCount` + a single non-accumulated `totalValueCents`
atomically via `projectVersioned`. The materialization half is therefore **done**, and
only the **transport** remains — which is why this is promoted to QUEUED.

Remaining transport work (re-verified 2026-06-05 against current code):
- The `Dashboard.portfolioSummary` schema field and the `onDashboardUpdate` subscription
  already exist, and `publish-dashboard-update.fn.js` already returns a hardcoded
  `portfolioSummary: null` stub — so this surface is **half-wired**.
- Backend TODO: add a `PortfolioSummaryInput` type + a `portfolioSummary` arg on
  `publishDashboardUpdate`, and a `PortfolioSummary` entry in the `dashboard-publisher.ts`
  broadcasts map.
- Frontend TODO: extend `ON_DASHBOARD_UPDATE` to request `portfolioSummary`, add a
  `setPortfolioSummary` last-write-wins-by-`updatedAt` store setter, and route the
  dashboard channel through the shared `subscribe-then-reconcile` helper.

**Transport decisions already resolved in the 2026-05-29 brainstorming** (carry
forward when reactivated, do not re-litigate):
- **Topology = grouped by state shape (Approach A):** scalars
  (`portfolioSummary` + `advisoryStatus` + `investorSnapshot`) ride the existing
  `onDashboardUpdate` / `Dashboard` channel (PortfolioSummary needs no new
  subscription — the field already exists); keyed collections get dedicated
  channels. A single unified subscription was rejected (atomic-frame benefit is
  illusory under the per-row stream model; couples surfaces; loses failure
  isolation; would force re-working the shipped `onActivityUpdate`).
- **Client:** `setPortfolioSummary` last-write-wins by `updatedAt`; add the same
  LWW guard to `setAdvisoryStatus`; route the dashboard channel through the
  shared `subscribe-then-reconcile` helper; `setDashboard` must apply the live
  surfaces via the guarded setters so a backfill snapshot can't clobber a newer
  live frame.
- Backend: add `PortfolioSummaryInput` + `portfolioSummary` arg on
  `publishDashboardUpdate`; `publish-dashboard-update.fn.js` already returns a
  hardcoded `portfolioSummary: null` ready to wire; add a `PortfolioSummary`
  entry to the `dashboard-publisher.ts` broadcasts map.
