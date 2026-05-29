# Activity feed: subscribe-before-query + merge reducer

**Date:** 2026-05-29
**Backlog:** `happy-path-pendingcount-wss-decrement-race` (REOPENED — residual)
**Status:** design, pending plan

## Problem

The 2026-05-29 Activity-broadcast fix (commits `61bff352..9725a528`) moved the
`new-investor-happy-path` Step 8 assertion off the racing `pendingDecisionsCount`
counter onto the append-only `Activity#<eventId>` row delivered via the new
`onActivityUpdate` AppSync broadcast. That correctly killed the **decrement
race**. But the gate has since failed on first try and passed on rerun — a
**residual** distinct from the decrement race.

Per `feedback_flake_means_broken.md`, the rerun-pass means the system genuinely
drops live Activity sometimes; it is not a flake to dismiss, and "cold start" is
not an acceptable diagnosis (`feedback_node_lambda_cold_starts.md` — Node Lambda
cold starts are 200–1500ms and cannot produce a 30s-window miss).

### Leading hypothesis (NOT yet reproduced)

A **WSS subscription-establishment race with no feed backfill**:

1. `dashboard-container.component.ts:162-165` — `ngOnInit` does
   `await loadDashboard()` **then** `subscribeToUpdates()` fire-and-forget. The
   AppSync WS handshake (`connection_init` → `start_ack`/`CONNECTED`) takes real
   wall-clock time and is never awaited.
2. The test's pre-inject barriers (`waitForLoaded`, `waitForPendingDecisionsAtLeast(1)`)
   pass off the initial `getDashboard` query, not a WSS frame
   (`dashboard.page.ts:26-29`). So the inject (`spec.ts:152`) can fire while
   `onActivityUpdate` is still mid-handshake.
3. AppSync `@aws_subscribe` does **not** replay events published before the
   subscription registers. A `publishActivityUpdate` firing before `start_ack`
   is dropped server-side.
4. The feed has **no reconciliation**: `getRecentActivity` runs once at mount
   (`dashboard-container.component.ts:207`); thereafter the store only
   `addActivity` per frame. No refetch, no reconnect handling. With no reload in
   Step 8, the dropped row never reaches the DOM → `waitForActivityByEventId`
   times out at 30s.

"Cold" only widens the handshake-vs-broadcast window; it is not the cause.

### Why this is a product bug, not a test bug

Per `feedback_bff_state_completeness.md` and CLAUDE.md ("if the POM polls for
state a real user could not observe, the UI is the bug"): a real user whose
Activity event fires in the mount→subscribe gap, or across any transient WS
reconnect, silently loses that row until a manual refresh. The fix must make the
feed self-healing for the user, which incidentally makes the test robust.

## Library constraint (verified)

`aws-appsync-subscription-link@4.0.3` signals subscription-ready via an
**internal** `start_ack`/`CONNECTED` control message (`lib/index.js:3502`,
`:3521`). It is **not** surfaced through Apollo's `subscribe()` Observable —
there is no public "connected" callback. Therefore "await subscribe_success then
query" is rejected as relying on library internals. We instead make the feed
**order-independent and self-healing**, which is correct regardless of exact
handshake timing.

## Design

Three changes, no schema/resolver/BFF change (`getRecentActivity` already exists
end-to-end: `schema.graphql:4`, `get-recent-activity.fn.js`, MFE
`GET_RECENT_ACTIVITY`).

### 1. Store: one merge reducer for both sources

The activities list is an append-only log keyed by `activityId`. Today the two
write paths are asymmetric — `setActivities` (query) **replaces wholesale**
(`dashboard.store.ts:128`) while `addActivity` (live) dedupes (`:131`). That
asymmetry is the clobber surface: a query snapshot taken before a live row
committed can overwrite that live row.

Replace both with a single merge: dedupe-union by `activityId`, sort by
`createdAt` descending, cap at 50. Query results and subscription frames become
two event sources reduced into one derived list; neither can clobber the other,
and order of arrival no longer matters.

- `mergeActivities(incoming: ActivityEntry[])` — union existing + incoming,
  dedupe by `activityId` (incoming wins on tie — identical payload anyway),
  sort `createdAt` desc, slice 50.
- `setActivities` becomes `mergeActivities` (initial load is just the first
  merge into an empty list).
- `addActivity` becomes `mergeActivities([entry])`.

### 2. Container: subscribe before query

`dashboard-container.component.ts` `ngOnInit`: call `subscribeToUpdates()`
**before** `loadDashboard()`. Any live frame that arrives during the snapshot
query is absorbed by the merge instead of being clobbered. Closes the common
mount-ordering gap.

### 3. Container: reconnect re-query (defense-in-depth)

Because there is no public connect signal, cover the WS-drop/reconnect hole:
when the activity subscription reconnects, re-run `getRecentActivity` and merge.
Mechanism: the Apollo subscription Observable re-emits / re-establishes on
reconnect; on each (re)establishment after the first, trigger a backfill query.
Concretely, wrap the activity subscription so that a reconnect (Observable
error→retry, or a fresh subscribe after transient drop) schedules a
`getRecentActivity` + `mergeActivities`. This is what makes the feed genuinely
tolerate eventual consistency for a real user across network blips, not only at
mount.

## Components & boundaries

- `DashboardStore` (`dashboard.store.ts`) — owns `mergeActivities`; pure
  reduction, independently unit-testable (order-independence, dedupe, cap, sort).
- `DashboardService` (`dashboard.service.ts`) — unchanged surface; already
  exposes `getRecentActivity` and `subscribeToActivityUpdates`.
- `DashboardContainerComponent` (`dashboard-container.component.ts`) — owns
  ordering (subscribe→query) and reconnect-backfill wiring.

## Testing

1. **TDD repro FIRST (Phase 4 of systematic-debugging):** capture the real
   post-fix failing run (`waitForActivityByEventId` locator timeout at
   `spec.ts:153`) to confirm the hypothesis before any production edit. If the
   signature differs, revise this spec.
2. **Store unit tests:** `mergeActivities` is order-independent (query-then-live
   == live-then-query), dedupes by `activityId`, caps at 50, sorts `createdAt`
   desc. A wholesale-replace would fail the "live row survives a later snapshot"
   case — that test is the regression guard.
3. **Container unit test:** subscription is established before the load query
   resolves; a reconnect triggers a backfill query.
4. **E2E gate:** `nestfolio-e2e:e2e` `new-investor-happy-path` green **twice
   consecutively** (per `apps/nestfolio-e2e/CLAUDE.md` anti-flake discipline).
   The POM (`waitForActivityByEventId`) is unchanged — going green organically
   is the proof.

## Out of scope

- The retired `pendingDecisionsCount` counter assertion (already correct).
- PortfolioSummary / PositionSnapshot live-push — separate dossiers
  `dashboard-live-push-portfolio-summary`, `dashboard-live-push-position-snapshots`.
  The merge-reducer pattern is a candidate generalisation for them but is not
  applied here.
- Any schema / resolver / dashboard-bff change — `getRecentActivity` already
  exists end-to-end.
- Surfacing a public connect signal from `GraphqlService` / the AppSync link
  (rejected above as relying on library internals).
- The `onDashboardUpdate` (AdvisoryStatus) path — single-value last-write-wins,
  not an append log; not affected by this class of bug.

## Risks

- **Reconnect detection fidelity:** the Apollo/AppSync Observable's reconnect
  semantics must actually re-emit or allow us to hook re-establishment. If the
  link silently resumes without a hookable signal, the reconnect-backfill
  degrades to "no worse than today" (mount-time subscribe-before-query still
  fixes the primary gap). The plan must verify the reconnect hook empirically.
- **Repro confidence:** the residual is reported, not yet captured locally.
  First implementation step is the failing-test repro; everything downstream is
  gated on it.
