# Dashboard PositionSnapshot live-push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live-push the dashboard holdings list — broadcast each `PositionSnapshot` row mutation over a new AppSync `onPositionUpdate` channel and merge it into the dashboard MFE store, so the holdings table updates after a fill without a manual refresh.

**Architecture:** Per-symbol delta on a dedicated channel, mirroring the shipped Activity keyed-collection channel. DDB `PositionSnapshot` row mutates → `dashboard-publisher.ts` (`broadcastFromStream`) fires `publishPositionUpdate(tenantId, position)` (NONE data source, IAM-signed) → AppSync `@aws_subscribe` fan-out → `onPositionUpdate(tenantId)` → dashboard-mfe is the 3rd caller of the `@nestfolio/ui` `subscribeThenReconcile` helper → `mergePositions` (upsert by `symbol`, LWW by `updatedAt`) → UI filters `quantity>0` and derives `weightPercent` from `marketValueCents`. Fully-exited symbols arrive as `quantity:0` frames (the read resolver already filters them). The LWW timestamp is standardized on the executor-stamped `updatedAt` (the field was misnamed `lastUpdatedAt`, sourced only by the now-dead `upsertPositionSnapshot` writer).

**Tech Stack:** AWS AppSync (JS resolvers, `@aws_subscribe`), `@nestfolio/event-processor` `broadcastFromStream`, `@nestfolio/cdk-constructs` (`Facade`/`Broadcaster`/`discoverJsResolvers`), Angular 21 + `@ngrx/signals` signal store, rxjs, Jest.

**Spec:** `docs/superpowers/specs/2026-06-13-dashboard-live-push-position-snapshots-design.md`

---

## File Structure

**dashboard-bff (backend):**
- `src/schema.graphql` — modify: add `PositionInput`, `PositionBroadcast`, `publishPositionUpdate`, `onPositionUpdate`; rename `PositionSnapshot.lastUpdatedAt` → `updatedAt`.
- `src/graphql/js-function/publish-position-update.fn.js` — create: NONE-source resolver (mirror of `publish-activity-update.fn.js`).
- `src/service.stack.ts` — modify: add `'publishPositionUpdate'` to `noneDataSource`.
- `src/handlers/dashboard-publisher.ts` — modify: `PUBLISH_POSITION_UPDATE` mutation const + `PositionSnapshot` broadcasts-map entry.
- `src/repositories/dashboard.repository.ts` — modify: delete the dead `upsertPositionSnapshot` method.
- `test/unit/handlers/dashboard-publisher.test.ts` — modify: PositionSnapshot broadcast tests.
- `test/unit/repositories/dashboard.repository.test.ts` — modify: delete the `upsertPositionSnapshot` describe block.

**dashboard-mfe (frontend):**
- `src/app/graphql/dashboard-bff.queries.ts` — modify: `ON_POSITION_UPDATE` subscription; rename fragment field `lastUpdatedAt` → `updatedAt`.
- `src/app/services/dashboard.service.ts` — modify: `subscribeToPositionUpdates`.
- `src/app/stores/dashboard.store.ts` — modify: `positionRows` state + `positions` derived computed + `mergePositions`/`addPosition`/`setPositions`(merge); rename interface field `lastUpdatedAt` → `updatedAt`.
- `src/app/dashboard/dashboard-container.component.ts` — modify: 3rd `subscribeThenReconcile` caller + `backfillPositions`.
- `test/app/services/dashboard.service.spec.ts` — modify: `subscribeToPositionUpdates` test.
- `test/app/stores/dashboard.store.spec.ts` — modify: fixtures + 3 derived-weight assertions + new merge tests.
- `test/app/dashboard/dashboard-container.component.spec.ts` — modify: mock service + 2 new subscription tests.
- `test/app/dashboard/positions-table.component.spec.ts` — modify: fixture field rename.

No change: `get-position-snapshots.fn.js` (the row already carries `updatedAt`, so the renamed GraphQL field resolves correctly); integration tests (the read/materialize path is unchanged and the `getPositionSnapshots` integration query does not request the timestamp field); `read-model-ownership.type-test.ts` (`PositionSnapshot` is already registered P1 — broadcasting is not a read-model write).

---

## Task 1: AppSync transport surface — schema + NONE resolver + stack wiring + dead-writer removal

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`
- Create: `services/investor/dashboard-bff/src/graphql/js-function/publish-position-update.fn.js`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts:17-19`
- Modify: `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts` (delete `upsertPositionSnapshot`)
- Modify: `services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts` (delete its describe block)

- [ ] **Step 1: Rename the `PositionSnapshot.lastUpdatedAt` field to `updatedAt` in the schema**

In `services/investor/dashboard-bff/src/schema.graphql`, change the `PositionSnapshot` type field (line ~74):

```graphql
type PositionSnapshot @aws_cognito_user_pools @aws_iam {
  symbol: String!
  assetClass: String
  quantity: Float!
  avgCostBasisCents: Int!
  currentPriceCents: Int!
  marketValueCents: Int!
  weightPercent: Float!
  unrealizedPnlCents: Int!
  updatedAt: String!
}
```

- [ ] **Step 2: Add `PositionInput`, `PositionBroadcast`, the mutation, and the subscription to the schema**

In the same file, add `publishPositionUpdate` to the `Mutation` block (after `publishActivityUpdate`):

```graphql
  publishPositionUpdate(
    tenantId: ID!
    position: PositionInput!
  ): PositionBroadcast!
    @aws_iam
```

Add `onPositionUpdate` to the `Subscription` block (after `onActivityUpdate`):

```graphql
  onPositionUpdate(tenantId: ID!): PositionBroadcast
    @aws_subscribe(mutations: ["publishPositionUpdate"])
```

Add the input near the other `input` blocks:

```graphql
input PositionInput {
  symbol: String!
  assetClass: String
  quantity: Float!
  avgCostBasisCents: Int!
  currentPriceCents: Int!
  marketValueCents: Int!
  weightPercent: Float!
  unrealizedPnlCents: Int!
  updatedAt: String!
}
```

Add the broadcast type next to `ActivityBroadcast` (carry the `@aws_subscribe` filter-pivot comment):

```graphql
# @aws_subscribe filter pivot — tenantId MUST be in the mutation RESPONSE
# (not just the input args). Without this the broadcast silently drops.
type PositionBroadcast @aws_cognito_user_pools @aws_iam {
  tenantId: ID
  position: PositionSnapshot!
}
```

- [ ] **Step 3: Create the NONE-source resolver**

Create `services/investor/dashboard-bff/src/graphql/js-function/publish-position-update.fn.js` (verbatim mirror of `publish-activity-update.fn.js`):

```js
import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the dashboard-bff
// stream-publisher Lambda after a relevant DDB PositionSnapshot row mutation. Its
// sole purpose is to drive the @aws_subscribe(mutations: ["publishPositionUpdate"])
// fan-out to clients subscribed via onPositionUpdate(tenantId).
//
// tenantId MUST be returned in the response — AppSync's @aws_subscribe filter
// matches the subscription's tenantId arg against fields in the RESPONSE, not
// the input args. Forgetting this drops every broadcast silently.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { tenantId, position } = ctx.arguments;
  return {
    tenantId,
    position,
  };
}
```

- [ ] **Step 4: Register the new mutation as a NONE data source in the stack**

In `services/investor/dashboard-bff/src/service.stack.ts`, extend the `noneDataSource` list (line ~18):

```ts
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDashboardUpdate', 'publishActivityUpdate', 'publishPositionUpdate'],
      }),
```

- [ ] **Step 5: Delete the dead `upsertPositionSnapshot` writer**

In `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts`, delete the entire `upsertPositionSnapshot` member (the `readonly upsertPositionSnapshot = this.log('upsertPositionSnapshot', async (data: {...}, ctx: RequestContext): Promise<void> => { ... await this.put(item); });` block, including its `// --- Position Snapshots ---` comment) — it has no production caller (the live path is the `position-snapshot.ts` transform) and is the lone writer of the old `lastUpdatedAt` attribute. Leave `getPositionSnapshots` (the next member) intact.

- [ ] **Step 6: Delete the dead writer's unit test**

In `services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts`, delete the `describe('upsertPositionSnapshot', () => { ... })` block (starts at line ~136). Leave the rest of the file intact.

- [ ] **Step 7: Verify the stack synthesizes and the BFF unit suite (incl. the trimmed repo test) is green**

Run: `pnpm nx run dashboard-bff:test`
Expected: PASS. The CDK stack synthesizes with the new resolver discovered + the schema parsing `PositionInput`/`PositionBroadcast`/the new mutation+subscription; the repository test no longer references `upsertPositionSnapshot`.

Run: `pnpm nx run dashboard-bff:lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql \
        services/investor/dashboard-bff/src/graphql/js-function/publish-position-update.fn.js \
        services/investor/dashboard-bff/src/service.stack.ts \
        services/investor/dashboard-bff/src/repositories/dashboard.repository.ts \
        services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts
git commit --no-verify -m "feat(dashboard-bff): add publishPositionUpdate/onPositionUpdate AppSync surface

PositionInput + PositionBroadcast + NONE-source resolver; standardize the
PositionSnapshot timestamp field on updatedAt and drop the dead
upsertPositionSnapshot writer (the lone lastUpdatedAt source).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: dashboard-publisher PositionSnapshot broadcast entry

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`
- Test: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these `it` blocks inside the `describe('dashboard-publisher', ...)` block in `dashboard-publisher.test.ts` (the `streamEvent` helper and `postAppSyncMutation` mock are already defined at the top of the file):

```ts
  it('broadcasts publishPositionUpdate on a PositionSnapshot INSERT', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', assetClass: 'EQUITY', quantity: 10,
        avgCostBasisCents: 15000, currentPriceCents: 16000, marketValueCents: 160000,
        weightPercent: 100, unrealizedPnlCents: 10000,
        __version: 42, updatedAt: '2026-06-13T12:00:00Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      position: {
        symbol: 'AAPL', assetClass: 'EQUITY', quantity: 10,
        avgCostBasisCents: 15000, currentPriceCents: 16000, marketValueCents: 160000,
        weightPercent: 100, unrealizedPnlCents: 10000, updatedAt: '2026-06-13T12:00:00Z',
      },
    });
  });

  it('broadcasts a PositionSnapshot MODIFY when marketValueCents changes', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 10, marketValueCents: 160000, currentPriceCents: 16000,
        avgCostBasisCents: 15000, unrealizedPnlCents: 10000, weightPercent: 100,
        __version: 42, updatedAt: '2026-06-13T12:00:00Z',
      },
      newImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 10, marketValueCents: 175000, currentPriceCents: 17500,
        avgCostBasisCents: 15000, unrealizedPnlCents: 25000, weightPercent: 100,
        __version: 43, updatedAt: '2026-06-13T13:00:00Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.position).toMatchObject({ marketValueCents: 175000, updatedAt: '2026-06-13T13:00:00Z' });
  });

  it('broadcasts the quantity:0 exit transition (fully-sold holding)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 10, marketValueCents: 160000, currentPriceCents: 16000,
        avgCostBasisCents: 15000, unrealizedPnlCents: 10000, weightPercent: 100,
        __version: 43, updatedAt: '2026-06-13T13:00:00Z',
      },
      newImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 0, marketValueCents: 0, currentPriceCents: 16000,
        avgCostBasisCents: 15000, unrealizedPnlCents: 0, weightPercent: 0,
        __version: 44, updatedAt: '2026-06-13T14:00:00Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.position).toMatchObject({ symbol: 'AAPL', quantity: 0 });
  });

  it('skips a PositionSnapshot MODIFY when no absolute field changed (sibling-only weight shift)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 10, marketValueCents: 160000, currentPriceCents: 16000,
        avgCostBasisCents: 15000, unrealizedPnlCents: 10000, weightPercent: 100,
        __version: 42, updatedAt: '2026-06-13T12:00:00Z',
      },
      newImage: {
        pk: 'T#tenant1', sk: 'PositionSnapshot#AAPL', __typename: 'PositionSnapshot',
        symbol: 'AAPL', quantity: 10, marketValueCents: 160000, currentPriceCents: 16000,
        avgCostBasisCents: 15000, unrealizedPnlCents: 10000, weightPercent: 40,
        __version: 43, updatedAt: '2026-06-13T13:00:00Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns dashboard-publisher`
Expected: the 4 new tests FAIL (no `PositionSnapshot` broadcast entry yet — `postAppSyncMutation` not called for the typename).

- [ ] **Step 3: Add the mutation const and the broadcasts-map entry**

In `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`, add a new mutation const after `PUBLISH_ACTIVITY_UPDATE`:

```ts
const PUBLISH_POSITION_UPDATE = `
  mutation PublishPositionUpdate($tenantId: ID!, $position: PositionInput!) {
    publishPositionUpdate(tenantId: $tenantId, position: $position) {
      tenantId
      position {
        symbol
        assetClass
        quantity
        avgCostBasisCents
        currentPriceCents
        marketValueCents
        weightPercent
        unrealizedPnlCents
        updatedAt
      }
    }
  }
`;
```

Add a `PositionSnapshot` entry to the `broadcasts` map (after the `Activity` entry):

```ts
    PositionSnapshot: {
      mutation: PUBLISH_POSITION_UPDATE,
      // One PositionSnapshot row per holding; a fully-exited symbol persists as a
      // quantity:0 ghost row (the read resolver filters quantity>0, and the client
      // mirrors that, so the quantity:0 frame IS the removal signal). Gate MODIFY
      // on the ABSOLUTE fields only — weightPercent is RELATIVE and recomputed
      // client-side, so it changes on every snapshot even for an untouched holding;
      // gating on it would broadcast every row on every event. marketValueCents is
      // in the gate, so every holding whose value actually moves (incl. the
      // quantity>0→0 exit) broadcasts; a sibling-only weight shift does not (the
      // client recomputes that holding's weight locally when the total changes).
      whenChanged: ['quantity', 'avgCostBasisCents', 'currentPriceCents', 'marketValueCents', 'unrealizedPnlCents'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          position: {
            symbol: String(item['symbol']),
            assetClass: item['assetClass'] != null ? String(item['assetClass']) : null,
            quantity: Number(item['quantity'] ?? 0),
            avgCostBasisCents: Number(item['avgCostBasisCents'] ?? 0),
            currentPriceCents: Number(item['currentPriceCents'] ?? 0),
            marketValueCents: Number(item['marketValueCents'] ?? 0),
            weightPercent: Number(item['weightPercent'] ?? 0),
            unrealizedPnlCents: Number(item['unrealizedPnlCents'] ?? 0),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns dashboard-publisher`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts \
        services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit --no-verify -m "feat(dashboard-bff): broadcast PositionSnapshot row mutations via publishPositionUpdate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: MFE subscription query + service method

**Files:**
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`
- Modify: `apps/dashboard-mfe/src/app/services/dashboard.service.ts`
- Test: `apps/dashboard-mfe/test/app/services/dashboard.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

Append this `it` block inside `describe('DashboardService', ...)` in `dashboard.service.spec.ts`:

```ts
  it('subscribeToPositionUpdates calls graphql.subscribe with ON_POSITION_UPDATE + tenantId', () => {
    service.subscribeToPositionUpdates('tenant-42');
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);
    expect(graphql.subscribe.mock.calls[0][0]).toContain('subscription OnPositionUpdate');
    expect(graphql.subscribe.mock.calls[0][1]).toEqual({ tenantId: 'tenant-42' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard.service`
Expected: FAIL — `service.subscribeToPositionUpdates is not a function`.

- [ ] **Step 3: Rename the fragment field and add the subscription document**

In `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`, change the `POSITION_SNAPSHOT_FIELDS` fragment's last field `lastUpdatedAt` → `updatedAt` (line ~22). Then add a subscription document after `ON_ACTIVITY_UPDATE`:

```ts
export const ON_POSITION_UPDATE = `
  subscription OnPositionUpdate($tenantId: ID!) {
    onPositionUpdate(tenantId: $tenantId) {
      position {
        ...PositionSnapshotFields
      }
    }
  }
  ${POSITION_SNAPSHOT_FIELDS}
`;
```

- [ ] **Step 4: Add the service method**

In `apps/dashboard-mfe/src/app/services/dashboard.service.ts`: add `ON_POSITION_UPDATE` to the import from `'../graphql/dashboard-bff.queries'`, then add this method after `subscribeToActivityUpdates`:

```ts
  /**
   * Live holdings: dashboard-bff fires `publishPositionUpdate` IAM-signed after
   * each PositionSnapshot row mutation (one row per holding; a fully-exited
   * symbol arrives as a quantity:0 frame). Frame shape: `{ position: PositionSnapshot }`.
   */
  subscribeToPositionUpdates(
    tenantId: string,
  ): Observable<{ onPositionUpdate: { position: PositionSnapshot } | null }> {
    return this.graphql.subscribe(ON_POSITION_UPDATE, { tenantId });
  }
```

(`PositionSnapshot` is already imported from `'../stores/dashboard.store'` at the top of the file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts \
        apps/dashboard-mfe/src/app/services/dashboard.service.ts \
        apps/dashboard-mfe/test/app/services/dashboard.service.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): onPositionUpdate subscription + subscribeToPositionUpdates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Store — positionRows merge + client-derived weight

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`
- Modify (compile fix): `apps/dashboard-mfe/test/app/dashboard/positions-table.component.spec.ts`

- [ ] **Step 1: Update fixtures + the three behavior-changed assertions, and add new merge/derived-weight tests (failing)**

In `dashboard.store.spec.ts`:

(a) Make `mockPositions` self-consistent and rename the timestamp field (replace the existing `mockPositions` array, lines ~39-62):

```ts
  const mockPositions: PositionSnapshot[] = [
    {
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      quantity: 10,
      avgCostBasisCents: 15000,
      currentPriceCents: 16000,
      marketValueCents: 160000,
      weightPercent: 40,            // 160000 / 400000 — already equals the derived value
      unrealizedPnlCents: 25000,
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      symbol: 'BND',
      assetClass: 'BOND',
      quantity: 20,
      avgCostBasisCents: 10000,
      currentPriceCents: 12000,
      marketValueCents: 240000,
      weightPercent: 60,            // 240000 / 400000 — already equals the derived value
      unrealizedPnlCents: -10000,
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];
```

(b) Update `should compute allocationByAssetClass` (the BOND expectation changes 45 → 60):

```ts
  it('should compute allocationByAssetClass', () => {
    store.setPositions(mockPositions);
    const allocation = store.allocationByAssetClass();
    expect(allocation['EQUITY']).toBe(40);
    expect(allocation['BOND']).toBe(60);
  });
```

(c) Update `should group positions with null assetClass as OTHER` (a lone holding derives to weight 100 regardless of the input value):

```ts
  it('should group positions with null assetClass as OTHER', () => {
    store.setPositions([{ ...mockPositions[0], assetClass: null, weightPercent: 10 }]);
    expect(store.allocationByAssetClass()['OTHER']).toBe(100); // sole holding ⇒ derived weight 100
  });
```

(d) Add a new `describe` block (place it after the existing `describe('DashboardStore.addActivity', ...)` block at the end of the file):

```ts
describe('DashboardStore.mergePositions / derived weights', () => {
  let store: InstanceType<typeof DashboardStore>;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
    store.reset();
  });

  const pos = (over: Partial<PositionSnapshot>): PositionSnapshot => ({
    symbol: 'AAPL', assetClass: 'EQUITY', quantity: 10,
    avgCostBasisCents: 15000, currentPriceCents: 16000, marketValueCents: 160000,
    weightPercent: 0, unrealizedPnlCents: 10000, updatedAt: '2026-06-13T12:00:00Z', ...over,
  });

  it('upserts by symbol (a second symbol is added, not replaced)', () => {
    store.mergePositions([pos({ symbol: 'AAPL', marketValueCents: 160000 })]);
    store.mergePositions([pos({ symbol: 'MSFT', marketValueCents: 240000 })]);
    expect(store.positions().map((p) => p.symbol).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('keeps the newer updatedAt and drops a strictly-older frame for the same symbol', () => {
    store.mergePositions([pos({ symbol: 'AAPL', marketValueCents: 200000, updatedAt: '2026-06-13T13:00:00Z' })]);
    store.mergePositions([pos({ symbol: 'AAPL', marketValueCents: 100000, updatedAt: '2026-06-13T12:00:00Z' })]); // older
    expect(store.positions()[0].marketValueCents).toBe(200000);
  });

  it('filters quantity:0 rows out of positions() (mirrors the read resolver)', () => {
    store.mergePositions([pos({ symbol: 'AAPL', quantity: 10 }), pos({ symbol: 'OLD', quantity: 0, marketValueCents: 0 })]);
    expect(store.positions().map((p) => p.symbol)).toEqual(['AAPL']);
  });

  it('derives weightPercent from marketValueCents so the held set sums to 100', () => {
    store.mergePositions([
      pos({ symbol: 'AAPL', marketValueCents: 160000, weightPercent: 999 }),
      pos({ symbol: 'BND', marketValueCents: 240000, weightPercent: 999 }),
    ]);
    const bySymbol = Object.fromEntries(store.positions().map((p) => [p.symbol, p.weightPercent]));
    expect(bySymbol['AAPL']).toBeCloseTo(40);
    expect(bySymbol['BND']).toBeCloseTo(60);
    const sum = store.positions().reduce((s, p) => s + p.weightPercent, 0);
    expect(sum).toBeCloseTo(100);
  });

  it('weights stay self-consistent after a single-symbol live frame updates one value', () => {
    store.setPositions([
      pos({ symbol: 'AAPL', marketValueCents: 160000, updatedAt: '2026-06-13T12:00:00Z' }),
      pos({ symbol: 'BND', marketValueCents: 240000, updatedAt: '2026-06-13T12:00:00Z' }),
    ]);
    // AAPL doubles in value via a later live frame; BND frame has NOT arrived.
    store.addPosition(pos({ symbol: 'AAPL', marketValueCents: 320000, updatedAt: '2026-06-13T13:00:00Z' }));
    const sum = store.positions().reduce((s, p) => s + p.weightPercent, 0);
    expect(sum).toBeCloseTo(100); // 320000 + 240000 → AAPL 57.14, BND 42.86
    const bySymbol = Object.fromEntries(store.positions().map((p) => [p.symbol, p.weightPercent]));
    expect(bySymbol['AAPL']).toBeCloseTo((320000 / 560000) * 100);
  });
});
```

- [ ] **Step 2: Rename the field in the positions-table spec fixture (compile fix)**

In `apps/dashboard-mfe/test/app/dashboard/positions-table.component.spec.ts`, change the fixture field `lastUpdatedAt: '2026-03-01T00:00:00Z',` (line ~36) to `updatedAt: '2026-03-01T00:00:00Z',` (the renamed `PositionSnapshot` interface field).

- [ ] **Step 3: Run the store + positions-table tests to verify failure**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns "dashboard.store|positions-table"`
Expected: FAIL — `store.mergePositions`/`store.addPosition` are not functions, the `PositionSnapshot` interface still has `lastUpdatedAt` (type error in fixtures), and the derived-weight expectations don't hold yet.

- [ ] **Step 4: Rename the interface field**

In `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`, rename the `PositionSnapshot` interface field (line ~28) `lastUpdatedAt: string;` → `updatedAt: string;`.

- [ ] **Step 5: Replace the `positions` state slot with `positionRows` and a derived computed**

In the same file:

(a) In `interface DashboardState`, replace `positions: PositionSnapshot[];` with `positionRows: PositionSnapshot[];`.

(b) In `initialState`, replace `positions: [],` with `positionRows: [],`.

(c) Add a NEW `withComputed` block IMMEDIATELY AFTER `withCallState()` and BEFORE the existing `withComputed` (a later `withComputed` can read an earlier one's signals, so `positions` must be defined first):

```ts
  withComputed((store) => ({
    // Holdings for display: drop quantity:0 ghost rows (mirrors the
    // get-position-snapshots resolver) and DERIVE weightPercent from
    // marketValueCents so the column + allocation chart stay self-consistent
    // (Σ = 100%) regardless of which per-symbol live frames have arrived.
    positions: computed(() => {
      const held = store.positionRows().filter((p) => p.quantity > 0);
      const total = held.reduce((sum, p) => sum + p.marketValueCents, 0);
      return held.map((p) => ({
        ...p,
        weightPercent: total > 0 ? (p.marketValueCents / total) * 100 : 0,
      }));
    }),
  })),
```

The existing `withComputed` block (with `totalPnl`, `allocationByAssetClass`, etc.) stays as-is — it already reads `store.positions()`, which now resolves to the derived computed above.

(d) In `withMethods`, replace the existing `setPositions` method with the merge family:

```ts
    // Keyed-collection live merge: upsert by `symbol`, last-write-wins by
    // `updatedAt` (drop a strictly-older frame; equal timestamps apply,
    // idempotent — matching setPortfolioSummary). Keeps quantity:0 ghost rows so
    // an out-of-order older frame is still ordered correctly; positions() filters
    // them for display. positionRows preserves insertion order (Map semantics).
    mergePositions(incoming: PositionSnapshot[]): void {
      const bySymbol = new Map<string, PositionSnapshot>();
      for (const p of store.positionRows()) bySymbol.set(p.symbol, p);
      for (const p of incoming) {
        const current = bySymbol.get(p.symbol);
        if (current && p.updatedAt < current.updatedAt) continue;
        bySymbol.set(p.symbol, p);
      }
      patchState(store, { positionRows: [...bySymbol.values()] });
    },
    addPosition(position: PositionSnapshot): void {
      this.mergePositions([position]);
    },
    // Intentionally MERGES (not replaces) so a query/backfill snapshot can't
    // clobber a newer live frame; use reset() for a hard clear (e.g. logout).
    setPositions(positions: PositionSnapshot[]): void {
      this.mergePositions(positions);
    },
```

- [ ] **Step 6: Run the dashboard-mfe store + positions-table tests to verify they pass**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns "dashboard.store|positions-table"`
Expected: PASS (existing tests with updated expectations + the new merge/derived-weight block).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts \
        apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts \
        apps/dashboard-mfe/test/app/dashboard/positions-table.component.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): mergePositions LWW + client-derived weightPercent

positionRows raw set (LWW by updatedAt) + positions() computed filtering
quantity>0 and deriving weightPercent from marketValueCents; setPositions now
merges. Field renamed lastUpdatedAt -> updatedAt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Container — third subscribeThenReconcile caller

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`
- Test: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Add `subscribeToPositionUpdates` to the mock service and write the failing tests**

In `dashboard-container.component.spec.ts`, add `subscribeToPositionUpdates` to the `mockService` object in `beforeEach` (after `subscribeToActivityUpdates`, line ~26):

```ts
      subscribeToPositionUpdates: jest.fn(() => new Subject()),
```

Append these two `it` blocks inside `describe('DashboardContainerComponent', ...)`:

```ts
  it('subscribes to onPositionUpdate on init and dispatches to store', async () => {
    const positionFrame$ = new Subject<{
      onPositionUpdate: { position: import('../../../src/app/stores/dashboard.store').PositionSnapshot } | null;
    }>();
    mockService.subscribeToPositionUpdates = jest.fn(() => positionFrame$);
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });
    const addSpy = jest.spyOn(store, 'addPosition');

    await component.ngOnInit();
    positionFrame$.next({
      onPositionUpdate: {
        position: {
          symbol: 'AAPL', assetClass: 'EQUITY', quantity: 10,
          avgCostBasisCents: 15000, currentPriceCents: 16000, marketValueCents: 160000,
          weightPercent: 100, unrealizedPnlCents: 10000, updatedAt: '2026-06-13T12:00:00Z',
        },
      },
    });

    expect(mockService.subscribeToPositionUpdates).toHaveBeenCalledWith('tenant-1');
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL' }));
    expect(store.positions().map((p) => p.symbol)).toContain('AAPL');

    component.ngOnDestroy(); // cancel any pending retry timer
  });

  it('backfills via getPositionSnapshots when the position subscription reconnects', async () => {
    const positionFrame$ = new Subject<{
      onPositionUpdate: { position: import('../../../src/app/stores/dashboard.store').PositionSnapshot } | null;
    }>();
    mockService.subscribeToPositionUpdates = jest.fn(() => positionFrame$);
    mockService.getPositionSnapshots = jest.fn().mockResolvedValue([]);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });

    await component.ngOnInit();
    expect(mockService.getPositionSnapshots).toHaveBeenCalledTimes(1); // initial load

    positionFrame$.error(new Error('ws dropped')); // simulate reconnect
    await Promise.resolve();
    await Promise.resolve();

    expect(mockService.getPositionSnapshots).toHaveBeenCalledTimes(2); // backfill on reconnect
    component.ngOnDestroy();
  });
```

- [ ] **Step 2: Run the container tests to verify failure**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard-container`
Expected: FAIL — the component does not subscribe to positions yet (`subscribeToPositionUpdates` not called; no backfill).

- [ ] **Step 3: Wire the third subscription in the container**

In `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`:

(a) Add a backoff constant next to the existing ones (line ~20):

```ts
const POSITIONS_RECONNECT_BACKOFF_MS = 2_000;
```

(b) Add a subscription field next to `activitySubscription` (line ~170):

```ts
  private positionsSubscription: Subscription | null = null;
```

(c) Unsubscribe it in `ngOnDestroy` (next to the activity unsubscribe):

```ts
    this.positionsSubscription?.unsubscribe();
    this.positionsSubscription = null;
```

(d) In `subscribeToUpdates()`, after the `this.activitySubscription = subscribeThenReconcile({ ... })` block, add:

```ts
    this.positionsSubscription = subscribeThenReconcile({
      source: this.dashboardService.subscribeToPositionUpdates(tenantId),
      onFrame: (data) => {
        const position = data?.onPositionUpdate?.position;
        if (position) {
          this.store.addPosition(position);
        }
      },
      onReconnect: () => this.backfillPositions(),
      reconnectBackoffMs: POSITIONS_RECONNECT_BACKOFF_MS,
    });
```

(e) Add the backfill method next to `backfillActivities`:

```ts
  private async backfillPositions(): Promise<void> {
    try {
      const positions = await this.dashboardService.getPositionSnapshots(true); // force refresh
      this.store.mergePositions(positions); // LWW merge keeps a newer live frame
    } catch {
      // best-effort; the next reconnect or a manual reload recovers
    }
  }
```

- [ ] **Step 4: Run the container tests to verify they pass**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard-container`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts \
        apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): wire onPositionUpdate subscription (3rd subscribeThenReconcile caller)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Affected test + lint gate

**Files:** none (verification only).

- [ ] **Step 1: Run the true-affected resolver and the scoped test+lint**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
echo "affected: $AFFECTED"
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```

Expected: PASS for every affected project (includes `dashboard-bff`, `dashboard-mfe`, and any reverse-dependents the resolver reports). If lint flags the unused `util` import in the new resolver, mirror exactly what `publish-activity-update.fn.js` does (it keeps the import) — `.fn.js` resolver files are not TS-linted the same way; only remove the import if this specific lint run flags it.

- [ ] **Step 2: Commit any lint auto-fixes**

```bash
git status --short
# If lint applied fixes:
git add -A && git commit --no-verify -m "chore: lint fixups for position live-push" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage:**
- Per-symbol delta on a dedicated channel → Task 1 (schema: `onPositionUpdate`/`PositionBroadcast`) + Task 2 (publisher).
- Client-derived `weightPercent` → Task 4 (`positions` computed).
- Removal via `quantity:0` ghost-row frames → Task 2 (exit-transition broadcast test) + Task 4 (`positions()` filter test).
- `updatedAt` standardization + dead-writer removal → Task 1 (schema rename + writer delete) + Task 3 (fragment) + Task 4 (interface + fixtures).
- 3rd `subscribeThenReconcile` caller → Task 5.
- Validation gate (unit + affected test/lint) → Tasks 1–6. Deploy + integration + schema-deploy smoke are the `/backlog-next` closing phase (not plan tasks). Live-delivery e2e is out of scope.

**2. Placeholder scan:** No TBD/TODO; every code step shows full content. The only conditional ("if lint flags `util`") gives an explicit, decidable instruction.

**3. Type consistency:** `mergePositions`/`addPosition`/`setPositions`, `positionRows`, `subscribeToPositionUpdates`, `ON_POSITION_UPDATE`, `PUBLISH_POSITION_UPDATE`, `PositionInput`/`PositionBroadcast`, and the `updatedAt` field name are used identically across all tasks. The frame shape `{ onPositionUpdate: { position: PositionSnapshot } | null }` matches between the service method (Task 3), the container `onFrame` (Task 5), and the resolver/broadcast `{ tenantId, position }` (Tasks 1–2).
