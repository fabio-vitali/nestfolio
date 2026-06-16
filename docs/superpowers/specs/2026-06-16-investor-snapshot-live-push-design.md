# Dashboard InvestorSnapshot live-push — design

- **Backlog:** `docs/backlog/happy-path-go-live-badge-stuck-sim.md` (status: active)
- **Date:** 2026-06-16
- **Lane:** Complex (worktree + deploy + scoped validation)
- **Pairs with (shipped template):** `dashboard-live-push-portfolio-summary`
  (`docs/superpowers/plans/2026-06-05-dashboard-live-push-portfolio-summary.md`) —
  the canonical "scalar singleton on the shared Dashboard channel" precedent.

## Problem

After a user confirms go-live, the dashboard execution-mode badge stays on `sim`
and never flips to `live` (the `nestfolio-e2e` `new-investor-happy-path` step-11
assertion fails — `[data-testid="execution-mode-live"]` never appears within 60s).

Root cause (code-traced end-to-end — see the backlog file's confirmed table): the
backend correctly flips `InvestorProfile.executionMode → live`, CDC-emits
`INVESTOR_PROFILE_UPDATED` carrying `executionMode` + a bumped `__version`, and
`dashboard-bff/transforms/investor-snapshot.ts` projects `InvestorSnapshot.executionMode='live'`
into DDB. **But `InvestorSnapshot` has no live-delivery path to the mounted dashboard:**

- `dashboard-publisher.ts` broadcasts `AdvisoryStatus` / `PortfolioSummary` /
  `Activity` / `PositionSnapshot` — **no `InvestorSnapshot` broadcaster.**
- `ON_DASHBOARD_UPDATE` selects `portfolioSummary` + `advisoryStatus` — **no
  `investorSnapshot`.**
- The dashboard `getDashboard` query is `cache-first`, run once on mount; it races
  the CDC chain, loses (returns `simulation`), caches 60s, and nothing pushes or
  refetches.

This is **transport only** — materialization (`investor-snapshot.ts`) already ships.

## Settled decision (recovered, NOT re-litigated): shared Dashboard channel

Per **Approach A** (`2026-06-13-dashboard-live-push-position-snapshots-design.md`
lines 31–34, from 2026-05-29 brainstorming):

> scalars share the `Dashboard` channel; keyed collections get dedicated channels,
> mirroring `Activity`.

`InvestorSnapshot` is a singleton per-tenant summary row — exactly like
`PortfolioSummary` / `AdvisoryStatus`, which already ride `publishDashboardUpdate` /
`onDashboardUpdate`. So it rides the **shared Dashboard channel** (one more optional
surface), NOT a new dedicated channel. This follows the `PortfolioSummary`
shared-channel template (`ed603eb2`→`dc1591df`) field-for-field.

> Irony: that same position-snapshots design's Out-of-scope claims *"InvestorSnapshot
> … already shipped on the Dashboard channel"* — false; it never was, which is why
> the gap shipped silently. The response-type surface (`Dashboard.investorSnapshot`),
> the `InvestorSnapshotFields` fragment, and the store `investorSnapshot` slot were
> all pre-added on that false assumption — so this change is unusually small.

## Already present (do NOT re-add)

- `schema.graphql`: `type InvestorSnapshot { … executionMode … }` and
  `Dashboard.investorSnapshot: InvestorSnapshot` (response field).
- `dashboard-bff.queries.ts`: `INVESTOR_SNAPSHOT_FIELDS` fragment + its use in
  `DASHBOARD_FIELDS` (so `getDashboard` already returns the surface).
- `dashboard.store.ts`: `InvestorSnapshot` interface + `investorSnapshot` state slot +
  `DashboardData.investorSnapshot`.
- `publish-dashboard-update.fn.js`: response already returns an `investorSnapshot` key
  (hardcoded `null` — must become a passthrough).

## Data flow (target)

```
confirmGoLive TransactWriteItems flips InvestorProfile.executionMode='live' + bump __version
  → investor-bff CDC: INVESTOR_PROFILE_UPDATED (DRY subject carries executionMode + __version)
  → dashboard-bff event-listener → investor-snapshot.ts → projectVersioned('InvestorSnapshot', { executionMode:'live' })  [DDB row MODIFY]
  → dashboard-publisher.ts (broadcastFromStream) InvestorSnapshot broadcaster, whenChanged on display fields
  → publishDashboardUpdate(tenantId, investorSnapshot)  [IAM-signed, NONE data source]
  → AppSync @aws_subscribe fan-out
  → onDashboardUpdate(tenantId) { investorSnapshot { … } }
  → dashboard-mfe subscribeThenReconcile onFrame → store.setInvestorSnapshot (LWW by updatedAt)
  → execution-mode-badge re-renders execution-mode-live
```

## Backend changes — `services/investor/dashboard-bff`

### `src/schema.graphql`
- Add `input InvestorSnapshotInput` mirroring the `InvestorSnapshot` type (all
  fields optional except `updatedAt: String!`):
  ```graphql
  input InvestorSnapshotInput {
    goalType: String
    riskLevel: String
    operatingMode: String
    executionMode: String
    mandateLevel: String
    onboardedAt: String
    updatedAt: String!
  }
  ```
- Add the `investorSnapshot` arg to the `publishDashboardUpdate` mutation (3rd
  optional surface, alongside `advisoryStatus` / `portfolioSummary`):
  ```graphql
  publishDashboardUpdate(
    tenantId: ID!
    advisoryStatus: AdvisoryStatusInput
    portfolioSummary: PortfolioSummaryInput
    investorSnapshot: InvestorSnapshotInput
  ): Dashboard! @aws_iam
  ```
  `Dashboard.investorSnapshot` (response) and `onDashboardUpdate` already exist.

### `src/graphql/js-function/publish-dashboard-update.fn.js`
Read `investorSnapshot` from `ctx.arguments` and return it (replace the hardcoded
`investorSnapshot: null`):
```js
export function response(ctx) {
  const { tenantId, advisoryStatus, portfolioSummary, investorSnapshot } = ctx.arguments;
  return {
    tenantId,
    portfolioSummary: portfolioSummary ?? null,
    advisoryStatus: advisoryStatus ?? null,
    investorSnapshot: investorSnapshot ?? null,
  };
}
```

### `src/handlers/dashboard-publisher.ts`
- Extend the shared `PUBLISH_DASHBOARD_UPDATE` mutation string: add the
  `$investorSnapshot: InvestorSnapshotInput` variable, pass it to the mutation, and
  **select `investorSnapshot { … }` in the response** (the `@aws_subscribe`
  response-filter rule — the surface must be in the selection set or the client
  never receives it). AdvisoryStatus / PortfolioSummary broadcasts send
  `$investorSnapshot` undefined → resolver returns `investorSnapshot: null` → client
  ignores (identical to how a PortfolioSummary broadcast returns `advisoryStatus:
  null`).
- Add an `InvestorSnapshot` entry to the `broadcasts` map:
  - `mutation: PUBLISH_DASHBOARD_UPDATE`
  - `skipInsert` default false (first materialization also broadcasts — matches
    AdvisoryStatus / PortfolioSummary).
  - `whenChanged: ['executionMode', 'operatingMode', 'goalType', 'riskLevel', 'mandateLevel']`
    — the user-visible display fields. Excludes `onboardedAt` (stable) and
    `updatedAt`/`__version` (always change on every projectVersioned write), so a
    no-op rewrite does NOT broadcast but a go-live `executionMode` flip does.
  - `mapImage(item)`: `tenantId` = `String(item['pk'] ?? '').slice(2)`
    (`'T#<tenantId>'` → `'<tenantId>'`); `investorSnapshot` = the row's display
    fields, each `item['x'] != null ? String(item['x']) : null` (all String in the
    schema), `updatedAt: String(item['updatedAt'] ?? new Date().toISOString())`
    (mirrors the other `mapImage`s).

`service.stack.ts` needs **no change**: `publishDashboardUpdate` is already in
`noneDataSource`, and the `Broadcaster` already consumes the DDB stream.

## Frontend changes — `apps/dashboard-mfe`

### `src/app/graphql/dashboard-bff.queries.ts`
Add `investorSnapshot { ...InvestorSnapshotFields }` to `ON_DASHBOARD_UPDATE` and
append the existing `INVESTOR_SNAPSHOT_FIELDS` fragment:
```ts
export const ON_DASHBOARD_UPDATE = `
  subscription OnDashboardUpdate($tenantId: ID!) {
    onDashboardUpdate(tenantId: $tenantId) {
      portfolioSummary { ...PortfolioSummaryFields }
      advisoryStatus { ...AdvisoryStatusFields }
      investorSnapshot { ...InvestorSnapshotFields }
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
  ${INVESTOR_SNAPSHOT_FIELDS}
`;
```

### `src/app/services/dashboard.service.ts`
Extend the `subscribeToDashboardUpdates` return type with the third surface and
refresh the docstring:
```ts
subscribeToDashboardUpdates(
  tenantId: string,
): Observable<{
  onDashboardUpdate: {
    advisoryStatus: AdvisoryStatus | null;
    portfolioSummary: PortfolioSummary | null;
    investorSnapshot: InvestorSnapshot | null;
  } | null;
}> {
  return this.graphql.subscribe(ON_DASHBOARD_UPDATE, { tenantId });
}
```
(`InvestorSnapshot` is already exported from `../stores/dashboard.store`; add it to
the existing type import.)

### `src/app/stores/dashboard.store.ts`
Add a guarded LWW setter (mirrors `setPortfolioSummary`) and route `setDashboard`'s
`investorSnapshot` through it so a re-query/backfill snapshot can't clobber a newer
live frame:
```ts
setInvestorSnapshot(incoming: InvestorSnapshot | null): void {
  if (!incoming) return;
  const current = store.investorSnapshot();
  if (current && incoming.updatedAt < current.updatedAt) return;
  patchState(store, { investorSnapshot: incoming });
},
setDashboard(data: DashboardData): void {
  this.setInvestorSnapshot(data.investorSnapshot);
  this.setPortfolioSummary(data.portfolioSummary);
  this.setAdvisoryStatus(data.advisoryStatus);
},
```
(Replaces the current direct `patchState(store, { investorSnapshot: data.investorSnapshot })`
+ the now-stale "investorSnapshot has no live channel" comment.)

### `src/app/dashboard/dashboard-container.component.ts`
Add the `investorSnapshot` branch to the existing dashboard-channel `onFrame`:
```ts
if (update?.investorSnapshot) {
  this.store.setInvestorSnapshot(update.investorSnapshot);
}
```
`backfillDashboard` already calls `store.setDashboard(...)`, which now routes
through the guarded `setInvestorSnapshot`. No new subscription / backfill needed —
the surface rides the existing dashboard channel + its reconnect path.

## Testing

- **dashboard-bff unit** (`test/unit/handlers/dashboard-publisher.test.ts`): add an
  `InvestorSnapshot` broadcast block mirroring the PortfolioSummary tests —
  `mapImage` payload shape (executionMode carried; tenantId stripped from pk),
  INSERT broadcasts, the `whenChanged` gate (an `executionMode` `sim→live` MODIFY
  broadcasts; a rewrite touching only `updatedAt`/`__version` does NOT), and that
  the emitted mutation variables key the `investorSnapshot` surface.
- **dashboard-mfe store** (`test/app/stores/dashboard.store.spec.ts`):
  `setInvestorSnapshot` applies a newer frame, drops a strictly-older one, ignores
  null; `setDashboard` routes investorSnapshot through the guard (a stale re-query
  snapshot does not overwrite a newer live executionMode).
- **dashboard-mfe container** (`test/app/dashboard/dashboard-container.component.spec.ts`):
  an `onDashboardUpdate` frame carrying `investorSnapshot.executionMode='live'`
  drives `store.investorSnapshot()?.executionMode === 'live'` (badge input).
- **dashboard-mfe service** (`test/app/services/dashboard.service.spec.ts`): if it
  asserts the dashboard-subscription shape, extend for the third surface.

## Validation gate (Complex lane)

1. Unit green: `dashboard-bff`, `dashboard-mfe` (+ `ui` if affected).
2. `tools/affected-projects.mjs --base=origin/main` → `nx run-many -t test,lint` green.
3. Deploy: `deploy.sh sandbox --prefix=dev --services=dashboard-bff` (AppSync schema
   adds `InvestorSnapshotInput` + the mutation arg → `UPDATE_COMPLETE`; `dashboard-mfe`
   bundle uploaded). Deploy-schema smoke: the mutation/subscription synthesize and the
   schema update succeeds.
4. dashboard-bff integration green against deployed dev.
5. **The validation gate for the bug**: `nestfolio-e2e` `new-investor-happy-path`
   reaches step 11 and `execution-mode-live` becomes visible — run twice
   consecutively (anti-flake discipline). This is the badge's only end-to-end proof.

## Out of scope

- A WSS-broadcast e2e harness asserting delivery without a reload (no harness exists;
  same gap as portfolio-summary — `wss-subscription-test-harness-test-support` /
  `dashboard-portfolio-summary-live-push-e2e-scenario`).
- Other dashboard surfaces' live-push (already shipped).
- Re-litigating channel topology (Approach A is settled — singleton → shared channel).
- Rewriting the stale Out-of-scope line in the 2026-06-13 position-snapshots design
  doc (historical).
- `mandateLevel` materialization: `investor-snapshot.ts` does not write it today; it
  rides the frame as `null` and is not in scope to start populating.
