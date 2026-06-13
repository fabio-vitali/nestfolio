# Dashboard PositionSnapshot live-push — design

- **Backlog:** `docs/backlog/dashboard-live-push-position-snapshots.md` (status: active)
- **Date:** 2026-06-13
- **Lane:** Complex (worktree + deploy + scoped validation)
- **Pairs with (shipped template):** `dashboard-live-push-portfolio-summary`
  (`docs/superpowers/plans/2026-06-05-dashboard-live-push-portfolio-summary.md`),
  which shipped the reusable `@nestfolio/ui` `subscribeThenReconcile` helper.

## Problem

The dashboard MFE renders the holdings list from `getPositionSnapshots` on mount.
`services/investor/dashboard-bff/src/transforms/position-snapshot.ts` updates the
`PositionSnapshot` DDB rows on every `PORTFOLIO_UPDATED` / `BALANCE_UPDATED`, but
`services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` broadcasts
only `AdvisoryStatus`, `PortfolioSummary`, and `Activity`. After a fill the
holdings table stays stale until a manual refresh — the most-watched post-trade
widget looks like the trade didn't go through.

This is **transport only**. Per-holding materialization already shipped
(`position-snapshot.ts` writes one `projectVersioned('PositionSnapshot', …)` per
holding). No live-push wiring exists yet (greenfield: no `publishPositionUpdate`,
`onPositionUpdate`, `PositionBroadcast`, or client merge).

## Settled decisions (carried forward — do not re-litigate)

- **Per-symbol delta on a dedicated channel** (2026-05-29 brainstorming). The
  publisher is DDB-stream-driven (one changed row per stream record), so a delta
  maps 1:1 to a frame exactly like Activity. NOT full-list (would force a fan-in
  re-query per single-row change and collapse the client merge to wholesale
  replace). NOT riding the existing `onDashboardUpdate` / `Dashboard` channel —
  keyed collections get their own channel (Approach A: scalars share the
  `Dashboard` channel; keyed collections get dedicated channels, mirroring
  `Activity`).
- **Reuse, don't extract.** This is the trivial 3rd caller of the existing
  `@nestfolio/ui` `subscribeThenReconcile` helper (2 callers today: Activity +
  PortfolioSummary). No new helper.

## Decision taken this round (AskUserQuestion, 2026-06-13)

**`weightPercent` is derived client-side, not trusted from the wire.**

`weightPercent` is *relative* (each holding's share of total market value). Under a
per-symbol delta channel, frames arrive one row at a time, so trusting the
server-emitted value would let the weight column + the allocation chart (which
sums `weightPercent`) transiently fail to sum to 100% between frames, and degrade
visibly if a frame subset is dropped or reordered.

Instead, the client treats `marketValueCents` as the single source of truth and
recomputes `weightPercent = marketValueCents / Σ marketValueCents × 100` over the
merged, `quantity>0` set after every merge. Weights and the allocation chart stay
self-consistent (Σ = 100%) regardless of which frames have arrived or their order.
This establishes a reusable **recompute-relative-field-on-merge** primitive for
keyed-collection live channels (serves the reusable-patterns-primary mandate,
CLAUDE.md § Hard Constraints). Cost: ~one reduce+map in the store; the
over-the-wire `weightPercent` is still carried (it backs the initial query) but is
recomputed for display.

## Decision taken this round (AskUserQuestion, 2026-06-13) — LWW timestamp = `updatedAt`

The client merge needs a reliable per-row LWW timestamp. Live `PositionSnapshot`
rows are written by the `projectVersioned` transform, so the event-processor
executor stamps **`updatedAt`** on every row (same as the shipped
`PortfolioSummary`). The GraphQL type / MFE fragment / store interface, however,
named the field **`lastUpdatedAt`**, which was only ever written by the
**now-dead** `upsertPositionSnapshot` repository method (no production caller —
the live path is the transform). So `PositionSnapshot.lastUpdatedAt: String!` was
sourced from a row attribute live rows don't carry — a pre-existing latent
inconsistency. (`__version`, the row's authoritative monotonic version, can't be
the GraphQL LWW key: names starting with `__` are reserved/illegal in GraphQL.)

**Standardize on `updatedAt`** (matches `PortfolioSummary`, executor-guaranteed):
rename the field `lastUpdatedAt` → `updatedAt` across `PositionSnapshot` (type),
`PositionInput`, the MFE `POSITION_SNAPSHOT_FIELDS` fragment, and the store
`PositionSnapshot` interface; **delete the dead `upsertPositionSnapshot` writer +
its unit test** (the lone, misleading `lastUpdatedAt` source). LWW key:
`updatedAt`. This is slightly beyond pure transport (one schema-field rename +
dead-code removal) but fixes the latent null and makes the surface consistent and
verifiable; blast radius is contained to dashboard-bff + dashboard-mfe (both
already touched).

## Removal handled by the existing read boundary (no tombstone)

Fully-exited symbols persist as **version-correct `quantity:0` `PositionSnapshot`
rows** (confirmed in `position-snapshot.ts` + the read resolver). The read resolver
`get-position-snapshots.fn.js` already filters `quantity > 0` ("ghost row" filter).
So removal needs no special tombstone frame: the `quantity:0` row write produces a
stream MODIFY → a `publishPositionUpdate` frame carrying `quantity:0` → the client
merge upserts it (preserving LWW order) and the `quantity>0` display filter drops
it. The client merge mirrors the read boundary exactly.

## Data flow

```
PositionSnapshot DDB row mutates (1 row/holding per PORTFOLIO_UPDATED|BALANCE_UPDATED;
  exited symbol → quantity:0 ghost row)
  → dashboard-publisher.ts (broadcastFromStream)
  → publishPositionUpdate(tenantId, position)  [IAM-signed, NONE data source]
  → AppSync @aws_subscribe fan-out
  → onPositionUpdate(tenantId)
  → dashboard-mfe subscribeThenReconcile → addPosition → mergePositions
       (upsert by symbol, LWW by updatedAt)
  → UI: positions() computed = filter quantity>0 + derive weightPercent from marketValueCents
```

## Backend changes — `services/investor/dashboard-bff`

### `src/schema.graphql`
- Rename `PositionSnapshot.lastUpdatedAt` → `updatedAt` (see the LWW-timestamp decision above).
- `input PositionInput { symbol, assetClass, quantity, avgCostBasisCents, currentPriceCents, marketValueCents, weightPercent, unrealizedPnlCents, updatedAt }` — mirrors the `PositionSnapshot` type fields (non-null matching the type: `symbol`, `quantity`, `avgCostBasisCents`, `currentPriceCents`, `marketValueCents`, `weightPercent`, `unrealizedPnlCents`, `updatedAt` required; `assetClass` optional).
- `type PositionBroadcast @aws_cognito_user_pools @aws_iam { tenantId: ID, position: PositionSnapshot! }` — `tenantId` in the response is the `@aws_subscribe` filter pivot (mirrors `ActivityBroadcast`).
- `publishPositionUpdate(tenantId: ID!, position: PositionInput!): PositionBroadcast! @aws_iam` on `Mutation`.
- `onPositionUpdate(tenantId: ID!): PositionBroadcast @aws_subscribe(mutations: ["publishPositionUpdate"])` on `Subscription`.

### `src/graphql/js-function/publish-position-update.fn.js`
NONE-data-source resolver, verbatim mirror of `publish-activity-update.fn.js`:
`request` returns `{ payload: {} }`; `response` returns `{ tenantId, position }` from
`ctx.arguments`. The `tenantId`-in-response comment block carries over.

### `src/handlers/dashboard-publisher.ts`
Add a `PositionSnapshot` entry to the `broadcasts` map:
- `mutation: PUBLISH_POSITION_UPDATE` (new const; selection set must include
  `tenantId` + the full `position { … }` field set, per the `@aws_subscribe`
  response-filter rule).
- `skipInsert: false` — first materialization also broadcasts.
- `whenChanged: ['quantity','avgCostBasisCents','currentPriceCents','marketValueCents','unrealizedPnlCents']`
  — absolute fields only. `weightPercent` is intentionally excluded (derived
  client-side; it changes on every snapshot even when a holding is untouched, so
  gating on it would broadcast every row on every event). Any real change to a
  holding (incl. the `quantity>0→0` exit) moves one of the gated fields. A
  sibling-only weight shift does NOT broadcast that holding — correct, because the
  client recomputes its weight locally when some other holding's frame updates the
  total. `marketValueCents` is in the gate, so every holding whose market value
  actually changes does broadcast → the client's running total stays accurate.
- `mapImage`: `tenantId` from `String(item['pk']).slice(2)`; `position` = the row's
  position fields (`Number(...)` coercions matching `position-snapshot.ts`,
  `assetClass` passthrough, `updatedAt` from the row's executor-stamped `updatedAt`).

### `src/service.stack.ts`
The new resolver is auto-discovered by `discoverJsResolvers`, but it must be added
to the `noneDataSource` list (alongside `publishDashboardUpdate` /
`publishActivityUpdate`) so the `publishPositionUpdate` field uses the NONE data
source. The `Broadcaster` construct already covers the DDB stream — no other stack
change.

### `src/repositories/dashboard.repository.ts` (dead-code removal)
Delete the dead `upsertPositionSnapshot` method (no production caller; the live
path is the `position-snapshot.ts` transform) and its unit test in
`test/unit/repositories/dashboard.repository.test.ts`. It is the lone writer of the
old `lastUpdatedAt` attribute; removing it eliminates the source of the
type-vs-row naming inconsistency resolved by the `updatedAt` standardization.

## Frontend changes — `apps/dashboard-mfe`

### `src/app/graphql/dashboard-bff.queries.ts`
`ON_POSITION_UPDATE` subscription requesting `onPositionUpdate(tenantId)` →
`position { ...PositionSnapshotFields }` (reuse the existing fragment).

### `src/app/services/dashboard.service.ts`
`subscribeToPositionUpdates(tenantId): Observable<{ onPositionUpdate: { position: PositionSnapshot } | null }>`
delegating to `graphql.subscribe(ON_POSITION_UPDATE, { tenantId })`.

### `src/app/stores/dashboard.store.ts`
- Rename the raw state slot to `positionRows: PositionSnapshot[]` — the
  LWW-deduped set across ALL symbols (including `quantity:0`), needed so an
  out-of-order older frame can be dropped correctly.
- `mergePositions(incoming)`: upsert by `symbol` into the keyed set; for a symbol
  already present, keep the row with the newer `updatedAt` (drop a strictly-older
  incoming frame; equal timestamps apply, idempotent LWW — matching the
  PortfolioSummary setter's convention).
- `addPosition(p)` = `mergePositions([p])`.
- `setPositions(rows)` = `mergePositions(rows)` — merges (mirrors
  `setActivities`→`mergeActivities`) so the initial query / reconnect backfill
  can't clobber a newer live frame. `reset()`/logout still hard-clears.
- `positions` becomes a **computed**: `positionRows().filter(p => p.quantity > 0)`
  then map each to `{ ...p, weightPercent: total>0 ? p.marketValueCents/total*100 : 0 }`
  where `total = Σ marketValueCents` over the filtered set. `totalPnl` and
  `allocationByAssetClass` already read `store.positions()` and need no change —
  they now consume the derived, self-consistent values.

### `src/app/dashboard/dashboard-container.component.ts`
Add a third `subscribeThenReconcile` caller in `subscribeToUpdates()` (established
BEFORE the load query, like the others):
- `source: this.dashboardService.subscribeToPositionUpdates(tenantId)`
- `onFrame: (data) => { const p = data?.onPositionUpdate?.position; if (p) this.store.addPosition(p); }`
- `onReconnect: () => this.backfillPositions()` — `getPositionSnapshots(true)` (force
  refresh) → `store.mergePositions(rows)`, best-effort (swallow rejection).
- `reconnectBackoffMs: POSITIONS_RECONNECT_BACKOFF_MS = 2_000`.
- Track in a `positionsSubscription` field; `unsubscribe()` in `ngOnDestroy`.

## Testing

- **dashboard-bff unit** (`test/unit/handlers/dashboard-publisher.test.ts`): extend
  with the `PositionSnapshot` broadcast — `mapImage` payload shape, the
  `whenChanged` gate (a no-op rewrite does not broadcast; a `marketValueCents`
  change does), INSERT broadcasts, and the `quantity:0` exit broadcasts.
  Add a resolver test for `publish-position-update.fn.js` only if the activity
  resolver has one (match the existing convention).
- **dashboard-mfe unit** (`test/.../dashboard.store.spec.ts`,
  `dashboard-container.component.spec.ts`): `mergePositions` LWW (older frame
  dropped) + `quantity:0` filtered out of `positions()`; `weightPercent`
  recomputed to sum to 100% under a partial frame subset; `allocationByAssetClass`
  consistency; the third subscription is established and `backfillPositions`
  re-queries + merges on reconnect.
- **Integration** (`test/integration/dashboard-bff.integration.test.ts`): mirror
  the existing activity-broadcast coverage for the position path if/where the suite
  exercises it.

## Validation gate (Complex lane)

1. Unit green: `ui`, `dashboard-bff`, `dashboard-mfe`.
2. `tools/affected-projects.mjs --base=origin/main` → `nx run-many -t test,lint` green.
3. Deploy: `deploy.sh sandbox --prefix=dev --services=dashboard-bff` (AppSync schema
   + `publishPositionUpdate` resolver `UPDATE_COMPLETE`, `dashboard-mfe` bundle
   uploaded). Schema-deploy smoke confirms `PositionInput` / `PositionBroadcast` /
   the new mutation + subscription synthesize and the AppSync schema update succeeds.
4. dashboard-bff integration green against deployed dev.

## Out of scope

- Other surfaces' live-push (AdvisoryStatus / PortfolioSummary / InvestorSnapshot /
  Activity) — already shipped on the Dashboard + Activity channels.
- PositionSnapshot read-model materialization — already shipped (`position-snapshot.ts`).
- Re-litigating transport topology — per-symbol delta on a dedicated `onPositionUpdate`
  channel is settled; not full-list, not riding the Dashboard channel.
- Extracting a *new* subscribe-then-reconcile helper — the existing
  `@nestfolio/ui` `subscribeThenReconcile` is reused as the 3rd caller.
- A live-delivery e2e scenario asserting the `@aws_subscribe` broadcast reaches the
  holdings table — no WSS harness exists (same gap as portfolio-summary; filed
  `dashboard-portfolio-summary-live-push-e2e-scenario` /
  `wss-subscription-test-harness-test-support`). Validation here is unit + scoped
  integration + deploy-schema smoke.
