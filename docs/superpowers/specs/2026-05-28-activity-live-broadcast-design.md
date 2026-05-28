# Activity live-broadcast on dashboard-bff — design

**Workstream:** `happy-path-pendingcount-wss-decrement-race`
**Date:** 2026-05-28
**Status:** approved, pending implementation plan

## Problem

`apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:138-162` Step 8 asserts that a synthetic `DEPOSIT_DETECTED` injected on the investor bus reaches the dashboard via the live WSS subscription. The assertion is:

```ts
await dashboard.waitForPendingDecisionsAtLeast(baseline + 1, 30_000);
```

This polls `.alert-text` until `pendingDecisionsCount >= baseline + 1`. The assertion **races the real pipeline's `DECISION_APPROVED` decrement**. Empirical run on commit `323a9ed0` (2026-05-28):

| Time (UTC) | Event | Counter |
|---|---|---|
| 12:48:03 | Synthetic inject `DEPOSIT_DETECTED` | 2 → **3** |
| 12:48:10 | Real pipeline `DECISION_APPROVED` | 3 → 2 |
| 12:48:33 | Test 30 s timeout | 2 |

The counter held at 3 for ~7 s; either the WSS frame for "3" coalesced with the "2" frame upstream, or the Angular signal coalesced at the client, or the DOM render fell between two Playwright polls. The root cause doesn't matter — `pendingDecisionsCount` is the wrong assertion target. It's a delta-driven counter (post-2026-05-09 inc/dec semantics, workstream `advisory-empty-state-pending-decisions-count`); any real pipeline completion within the assertion window cancels the synthetic's increment.

The test name itself — *"decision pipeline triggers + WSS live-update verified"* — claims to prove the WSS path. An append-only, content-addressable observable is the right target.

## Solution: Activity as a live-broadcast surface

`services/investor/dashboard-bff/src/transforms/recent-activity.ts:32` already writes Activity rows with `activityId: event.id` — the synthetic's `eventId` ends up as the row's `activityId`. The rows are queryable today via `getRecentActivity(limit)`, but `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` only broadcasts `AdvisoryStatus`. Activity inserts never push to clients.

This design adds a live broadcast for Activity rows, surfaces them in the existing `<app-activity-feed>` component in the dashboard, and replaces the racing counter assertion with an append-only Activity-row assertion keyed by `activityId`.

## Out of scope

- Modifying the existing `pendingDecisionsCount` inc/dec semantics. The counter stays as-is; the assertion target moves.
- Live-push for `PortfolioSummary` or `PositionSnapshot`. Filed separately as `dashboard-live-push-portfolio-summary` and `dashboard-live-push-position-snapshots` (parking).
- Refactoring `dashboard-publisher.ts` beyond adding the new Activity broadcast entry.
- Investigating sub-100 ms render coalescing of `pendingDecisionsCount`. Moot once the assertion moves off the counter.
- Touching `injectAdvisoryBffTriggerEvent` (different surface — advisory-bff).
- A new query for Activity. Existing `getRecentActivity(limit)` stays as the on-mount loader.

## Architecture

```
DEPOSIT_DETECTED (synthetic inject)
  → investor EB bus
  → dashboard-bff Ingress ($or filter passes integration-test:dashboard-bff)
  → event-listener.ts handler
  → recentActivity transform writes Activity row to DDB (activityId = event.id)
  → DDB stream
  → dashboard-publisher.ts broadcastFromStream
  → [NEW] Activity entry in broadcasts map fires publishActivityUpdate
  → AppSync mutation (IAM-signed via SigV4)
  → [NEW] onActivityUpdate subscription pushes ActivityBroadcast frame
  → dashboard-mfe subscriber prepends to store.activities (deduped by activityId)
  → activity-feed.component re-renders → .activity-item[data-activity-id="X"] in DOM
  → Playwright dashboard.waitForActivityByEventId(X) resolves
```

The pattern mirrors the existing `AdvisoryStatus` broadcast (`publishDashboardUpdate` / `onDashboardUpdate`) but as a **separate mutation+subscription** because:
- Payload shape differs: a single Activity delta, not the Dashboard composite.
- Semantics differ: Activity is append-only stream; `AdvisoryStatus` is snapshot replace.
- Broadcasting every Activity insert through `publishDashboardUpdate` would push the full Dashboard structure unnecessarily.

## Component changes

### dashboard-bff (publisher side)

**`services/investor/dashboard-bff/src/schema.graphql`** — five additions:

```graphql
type ActivityEntry @aws_cognito_user_pools @aws_iam {
  activityId: ID!          # NEW — required for dedupe + e2e assertion
  activityType: String!
  description: String!
  createdAt: String!
  metadata: String
}

input ActivityEntryInput {
  activityId: ID!
  activityType: String!
  description: String!
  createdAt: String!
  metadata: String
}

type ActivityBroadcast @aws_cognito_user_pools @aws_iam {
  tenantId: ID            # @aws_subscribe filter pivot — must be in mutation RESPONSE per feedback-appsync-subscribe-filter-args
  activity: ActivityEntry!
}

type Mutation {
  publishActivityUpdate(tenantId: ID!, activity: ActivityEntryInput!): ActivityBroadcast! @aws_iam
}

type Subscription {
  onActivityUpdate(tenantId: ID!): ActivityBroadcast
    @aws_subscribe(mutations: ["publishActivityUpdate"])
}
```

**`services/investor/dashboard-bff/src/graphql/js-function/publish-activity-update.fn.js`** — new file mirroring `publish-dashboard-update.fn.js`: NONE-resolver pass-through. `discoverJsResolvers` picks it up automatically; no CDK change needed.

**`services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts:30`** — add Activity to the broadcasts map:

```ts
Activity: {
  mutation: PUBLISH_ACTIVITY_UPDATE,
  skipInsert: false,         // Activity rows are INSERT-only; the first emit IS the signal
  // whenChanged omitted — every Activity insert broadcasts
  mapImage: (item) => ({
    tenantId: String(item['pk'] ?? '').slice(2),   // MUST be in response (filter pivot)
    activity: {
      activityId: String(item['activityId']),
      activityType: String(item['activityType']),
      description: String(item['description']),
      createdAt: String(item['createdAt']),
      metadata: item['metadata'] ?? null,
    },
  }),
},
```

**Projection note (no change required).** `get-recent-activity.fn.js:24` returns `ctx.result.items` raw, and DDB rows already include `activityId` (`recent-activity.ts:32`). Adding `activityId: ID!` to the GraphQL `ActivityEntry` type is sufficient — AppSync will surface the field automatically from the existing DDB item shape. No JS-resolver or repository change.

### dashboard-mfe (consumer side)

**`apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`** — extend `ACTIVITY_ENTRY_FIELDS` fragment with `activityId`, add `ON_ACTIVITY_UPDATE` subscription:

```ts
const ACTIVITY_ENTRY_FIELDS = `
  fragment ActivityEntryFields on ActivityEntry {
    activityId
    activityType
    description
    createdAt
    metadata
  }
`;

export const ON_ACTIVITY_UPDATE = `
  subscription OnActivityUpdate($tenantId: ID!) {
    onActivityUpdate(tenantId: $tenantId) {
      activity {
        ...ActivityEntryFields
      }
    }
  }
  ${ACTIVITY_ENTRY_FIELDS}
`;
```

**`apps/dashboard-mfe/src/app/services/dashboard.service.ts`** — add:

```ts
subscribeToActivityUpdates(tenantId: string): Observable<{
  onActivityUpdate: { activity: ActivityEntry } | null;
}> {
  return this.graphql.subscribe(ON_ACTIVITY_UPDATE, { tenantId });
}
```

**`apps/dashboard-mfe/src/app/stores/dashboard.store.ts`** — add an `addActivity(entry: ActivityEntry)` reducer that:
- Prepends the entry to `activities`.
- Dedupes by `activityId` (idempotent against retries / out-of-order frames).
- Caps the list at 50 entries.

Also extend the `ActivityEntry` type with `activityId: string`.

**`apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`** — alongside the existing dashboard subscription, subscribe to activity updates and dispatch to the store. Cleanup follows the same pattern (`takeUntilDestroyed` or `DestroyRef`).

**`apps/dashboard-mfe/src/app/dashboard/activity-feed.component.ts`** — two surgical edits:
- Add `data-activity-id="{{ activity.activityId }}"` to `.activity-item`.
- Change `@for ... track activity.createdAt` to `track activity.activityId` (stable identity; timestamps can collide).

### nestfolio-e2e (test side)

**`apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts`** — change `injectDashboardBffTriggerEvent` to return the synthetic eventId so the caller can assert on it:

```ts
export async function injectDashboardBffTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<{ eventId: string }> {
  // ... existing setup ...
  const eventId = `e2e-${randomUUID()}`;
  // ... existing PutEvents body, unchanged: eventId becomes detail.id ...
  return { eventId };
}
```

The Activity row's `activityId` equals `event.id` (per `recent-activity.ts:32`), so this `eventId` is the value the test asserts against.

**`apps/nestfolio-e2e/src/pages/dashboard.page.ts`** — new POM helper:

```ts
/**
 * Wait until the activity feed contains an entry with the given activityId.
 * WSS proof: the row only reaches the DOM via the onActivityUpdate broadcast
 * (no page reload between inject and assert).
 */
async waitForActivityByEventId(activityId: string, timeout = 30_000): Promise<void> {
  await this.page
    .locator(`.activity-item[data-activity-id="${activityId}"]`)
    .waitFor({ state: 'visible', timeout });
}
```

The existing `waitForPendingDecisionsAtLeast` stays — it's still used at line 143 as a page-settled wait. Only the racing `baseline + 1` assertion is replaced.

**`apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:138-162`** — replace the racing assertion:

```ts
await test.step('decision pipeline triggers + WSS live-update verified', async () => {
  await authedPage.goto('/dashboard');
  await dashboard.waitForLoaded();
  await dashboard.waitForPendingDecisionsAtLeast(1, 180_000);          // page-settled wait

  // Synthetic DEPOSIT_DETECTED scoped to dashboard-bff. No page reload between
  // inject and assert — the only path the Activity row can travel is the
  // onActivityUpdate WSS broadcast.
  const { eventId } = await injectDashboardBffTriggerEvent(ctx, tenant);
  await dashboard.waitForActivityByEventId(eventId, 30_000);

  await waitForAdvisoryDecisionRow(ctx, tenant);                       // unchanged
});
```

Update the `// Step 8 —` comment block above the step to reflect the new assertion target.

## Data flow & failure modes

**Idempotency.** Activity rows are persisted via `record('Activity', ...)` which is event-id-scoped at the event-processor layer. A duplicate `DEPOSIT_DETECTED` produces zero new DDB writes → zero DDB stream records → zero extra broadcasts. The client also dedupes by `activityId` so any double-delivery at the AppSync layer is absorbed.

**Ordering.** The activity-feed component prepends to the array, so the newest row appears first. The test doesn't depend on relative ordering between activities — only on a specific `activityId` being present.

**Filter pivot.** AppSync `@aws_subscribe` filters match the subscription arg (`tenantId`) against fields in the mutation RESPONSE, not its input args. `ActivityBroadcast.tenantId` must be populated by `mapImage` in `dashboard-publisher.ts`. The schema comment + a runtime check during the integration test cover this — see `feedback-appsync-subscribe-filter-args`.

**IAM auth.** The publisher Lambda already SigV4-signs `publishDashboardUpdate` against the AppSync API. The publisher needs `appsync:GraphQL` for `Mutation/publishActivityUpdate` too. Mitigation: the CDK construct that grants AppSync mutation access either uses a field-wildcard pattern (works automatically) or enumerates per-field (needs the new field added). Will be verified during implementation.

**Broadcast batching.** `broadcastFromStream` processes DDB stream records in Lambda invocations; a batch of N inserts produces N mutation invocations. No `whenChanged` filter on Activity, so every insert fires.

## Validation

### Unit tests (dashboard-bff)

- `test/unit/handlers/dashboard-publisher.test.ts` — extend with `Activity` broadcast cases: INSERT image → emits `publishActivityUpdate` with the right payload; MODIFY images don't double-emit; missing optional fields handled.
- `test/unit/transforms/recent-activity.test.ts` — verify `activityId` is asserted (likely already covered since `event.id` is mapped).
- `test/unit/graphql/js-function/publish-activity-update.fn.test.ts` — new test mirroring `publish-dashboard-update.fn.test.ts`.

### Integration test (dashboard-bff)

- `test/integration/dashboard-bff.integration.test.ts` — extend with a case that emits `DEPOSIT_DETECTED` as an integration-event, then asserts (a) the DDB Activity row exists with the right `activityId`, and (b) the publisher fires the mutation. Mirror the trap pattern the suite already uses for `onDashboardUpdate` if present.

### Component tests (dashboard-mfe)

- `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts` — assert `subscribeToActivityUpdates` is invoked on init and that incoming frames update `store.activities()`.
- `apps/dashboard-mfe/test/app/services/dashboard.service.spec.ts` — assert the new method calls `graphql.subscribe` with `ON_ACTIVITY_UPDATE` + `tenantId`.

### E2E gate (the workstream's done-definition)

`pnpm nx run nestfolio-e2e:e2e` — **2 consecutive green runs** of the full Playwright app (4 scenarios), per `apps/nestfolio-e2e/CLAUDE.md`'s anti-flake rule + `feedback-flake-means-broken`.

### Affected gate

`pnpm nx affected -t test,lint --base=origin/main` — must pass before deploy.

## Risks

- **Silent broadcast drop** if `ActivityBroadcast.tenantId` is not populated by `mapImage`. Caught by the integration test trap; explicit comment in the schema mirrors the existing `Dashboard.tenantId` warning.
- **IAM grant gap** on `Mutation/publishActivityUpdate`. Mitigated by checking the CDK construct's grant pattern at implementation time.
- **MFE bundle staleness on deploy.** dashboard-mfe must be rebuilt + republished to the MFE S3 bucket; the existing investor-web deploy pipeline handles this when the workspace package is rebuilt.
- **Subscription leak** if `subscribeToActivityUpdates` isn't cleaned up. Follow the existing dashboard subscription's lifecycle pattern.

## Validation gate (frontmatter on ship)

- 2 consecutive `pnpm nx run nestfolio-e2e:e2e` runs green (all 4 scenarios).
- `pnpm nx affected -t test,lint --base=origin/main` green.
- `dashboard-bff:test-integration` green.
- Deploy log lines for `dev-dashboard-bff` (schema + publisher + new JS resolver) and `dev-investor-web` (MFE rebuild).
- Commit SHA for the implementation.
