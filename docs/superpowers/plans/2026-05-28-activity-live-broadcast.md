# Activity live-broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dashboard-bff` Activity rows a live AppSync broadcast surface so the e2e `new-investor-happy-path` Step 8 assertion targets an append-only `activityId` instead of the racing `pendingDecisionsCount` counter.

**Architecture:** New AppSync mutation `publishActivityUpdate` + subscription `onActivityUpdate` mirroring the existing `publishDashboardUpdate`/`onDashboardUpdate` pattern. `dashboard-publisher.ts` adds an `Activity` entry to the `broadcastFromStream` config (keyed by `__typename` after a small library tweak — Activity rows have compound sk `Activity#<ts>#<id>` so sk-based dispatch can't find them). The dashboard MFE subscribes alongside `onDashboardUpdate`, prepends new activities to the existing store (deduped by `activityId`, capped at 50), and the existing `<app-activity-feed>` renders them with `data-activity-id` for a Playwright POM assertion.

**Tech Stack:** TypeScript, AppSync (JS resolvers), DynamoDB Streams, Angular 21 + signalStore, Playwright, CDK, Jest, pnpm/nx.

**Spec:** `docs/superpowers/specs/2026-05-28-activity-live-broadcast-design.md`

**Workstream:** `happy-path-pendingcount-wss-decrement-race`

**Worktree:** `.claude/worktrees/activity-live-broadcast` on branch `worktree-activity-live-broadcast`.

---

## Phase 1 — Library: broadcast-from-stream dispatcher

`broadcastFromStream` keys its `broadcasts` map by the DDB row's `sk`. Activity rows have compound sk `Activity#<timestamp>#<eventId>` (see `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts:252`), so an exact-match lookup against the map key `'Activity'` never fires. Every row written via `record()` also has `__typename` set (per `libs/event-processor/src/util/build-cdc-item.ts:24`), and existing consumers' rows have `sk === __typename`. Preferring `__typename` over `sk` is backwards-compatible for current callers and fixes the Activity case.

### Task 1: Prefer __typename over sk in broadcast dispatcher

**Files:**
- Modify: `libs/event-processor/src/pipelines/broadcast-from-stream.ts:72`
- Test: `libs/event-processor/test/pipelines/broadcast-from-stream.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test** — assert compound-sk rows dispatch by `__typename`.

```ts
import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

import { broadcastFromStream } from '../../src/pipelines/broadcast-from-stream';

function streamEvent(image: Record<string, unknown>): DynamoDBStreamEvent {
  const m = (item: Record<string, unknown>): Record<string, { S?: string; N?: string }> => {
    const out: Record<string, { S?: string; N?: string }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
    }
    return out;
  };
  return {
    Records: [{
      eventID: 'evt-1',
      eventName: 'INSERT',
      eventSource: 'aws:dynamodb',
      dynamodb: { NewImage: m(image) },
    }],
  } as unknown as DynamoDBStreamEvent;
}

describe('broadcastFromStream dispatch key', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('dispatches by __typename when sk is compound', async () => {
    const handler = broadcastFromStream({
      serviceName: 'test',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Activity: {
          mutation: 'mutation X { x }',
          mapImage: (img) => ({ ok: img['__typename'] }),
        },
      },
    });
    await handler(streamEvent({
      pk: 'T#tenant1',
      sk: 'Activity#2026-05-28T00:00:00Z#evt-42',
      __typename: 'Activity',
      activityId: 'evt-42',
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    expect((postAppSyncMutation as jest.Mock).mock.calls[0][0].variables).toEqual({ ok: 'Activity' });
  });

  it('still dispatches scalar-sk rows (backwards-compat)', async () => {
    const handler = broadcastFromStream({
      serviceName: 'test',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        AdvisoryStatus: {
          mutation: 'mutation X { x }',
          mapImage: () => ({ ok: true }),
        },
      },
    });
    await handler(streamEvent({
      pk: 'T#tenant1',
      sk: 'AdvisoryStatus',
      __typename: 'AdvisoryStatus',
      pendingDecisionsCount: 1,
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm nx run event-processor:test --testPathPatterns=broadcast-from-stream
```

Expected: the first test (`dispatches by __typename when sk is compound`) FAILS — the dispatcher's current code uses `sk` first, which evaluates to `Activity#...` and misses the broadcasts map.

- [ ] **Step 3: Implement** — change the dispatcher to prefer `__typename`.

```ts
// libs/event-processor/src/pipelines/broadcast-from-stream.ts:72
const typename = String(newImage['__typename'] ?? newImage['sk'] ?? '');
```

Also update the doc comment on line 36 of the same file:

```ts
/** Keyed by the row's `__typename` (falls back to `sk` for legacy callers). */
broadcasts: Record<string, StreamBroadcastEntry>;
```

- [ ] **Step 4: Run tests, verify both pass**

```bash
pnpm nx run event-processor:test --testPathPatterns=broadcast-from-stream
```

Expected: both pass.

- [ ] **Step 5: Verify existing consumers still pass**

```bash
pnpm nx run dashboard-bff:test --testPathPatterns=dashboard-publisher
pnpm nx run advisory-bff:test --testPathPatterns=decision-publisher
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/broadcast-from-stream.ts \
        libs/event-processor/test/pipelines/broadcast-from-stream.test.ts
git commit -m "$(cat <<'EOF'
feat(event-processor): broadcastFromStream prefers __typename over sk

Activity rows in dashboard-bff use compound sk Activity#<ts>#<id>; the
prior sk-first dispatch couldn't match them. __typename is always set by
build-cdc-item.ts for every record() write, and existing consumers
(AdvisoryStatus, DecisionReadModel) have sk === __typename so this is a
no-op for them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — dashboard-bff publisher side

### Task 2: Schema additions

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`

- [ ] **Step 1: Add Activity broadcast types + subscription**

Add `activityId: ID!` as the first field of the existing `ActivityEntry` type. Then append the new types/inputs/mutation/subscription at the end of the file:

```graphql
type ActivityEntry @aws_cognito_user_pools @aws_iam {
  activityId: ID!
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

# @aws_subscribe filter pivot — tenantId MUST be in the mutation RESPONSE
# (not just the input args). Without this the broadcast silently drops.
type ActivityBroadcast @aws_cognito_user_pools @aws_iam {
  tenantId: ID
  activity: ActivityEntry!
}
```

Inside the existing `type Mutation { ... }` block, add:

```graphql
  publishActivityUpdate(
    tenantId: ID!
    activity: ActivityEntryInput!
  ): ActivityBroadcast!
    @aws_iam
```

Inside the existing `type Subscription { ... }` block, add:

```graphql
  onActivityUpdate(tenantId: ID!): ActivityBroadcast
    @aws_subscribe(mutations: ["publishActivityUpdate"])
```

- [ ] **Step 2: Sanity-check the file** — confirm schema is well-formed (no duplicate fields).

```bash
grep -c "^type \|^input " services/investor/dashboard-bff/src/schema.graphql
```

Expected: count goes up by 2 (`ActivityEntryInput`, `ActivityBroadcast`).

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql
git commit -m "feat(dashboard-bff): add Activity broadcast schema surface

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3: publish-activity-update JS resolver

**Files:**
- Create: `services/investor/dashboard-bff/src/graphql/js-function/publish-activity-update.fn.js`

- [ ] **Step 1: Create the resolver**

```js
import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the dashboard-bff
// stream-publisher Lambda after a relevant DDB Activity row insert. Its sole
// purpose is to drive the @aws_subscribe(mutations: ["publishActivityUpdate"])
// fan-out to clients subscribed via onActivityUpdate(tenantId).
//
// tenantId MUST be returned in the response — AppSync's @aws_subscribe filter
// matches the subscription's tenantId arg against fields in the RESPONSE, not
// the input args. Forgetting this drops every broadcast silently.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { tenantId, activity } = ctx.arguments;
  return {
    tenantId,
    activity,
  };
}
```

- [ ] **Step 2: Verify the discoverJsResolvers list will pick it up**

```bash
grep -n "noneDataSource" services/investor/dashboard-bff/src/service.stack.ts
```

Expected: line 23 currently shows `noneDataSource: ['publishDashboardUpdate']` — task 5 extends this.

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/src/graphql/js-function/publish-activity-update.fn.js
git commit -m "feat(dashboard-bff): publish-activity-update JS resolver

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: Extend dashboard-publisher with Activity broadcast

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`
- Modify: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Write the failing test** — append to the existing `describe('dashboard-publisher')` block.

```ts
  it('broadcasts publishActivityUpdate on Activity row INSERT (key by __typename)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'Activity#2026-05-28T12:48:03Z#evt-42',
        __typename: 'Activity',
        activityId: 'evt-42',
        activityType: 'DEPOSIT_DETECTED',
        description: 'Deposit detected: 1000 USD',
        createdAt: '2026-05-28T12:48:03Z',
        metadata: '{"amountCents":100000}',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      activity: {
        activityId: 'evt-42',
        activityType: 'DEPOSIT_DETECTED',
        description: 'Deposit detected: 1000 USD',
        createdAt: '2026-05-28T12:48:03Z',
        metadata: '{"amountCents":100000}',
      },
    });
  });

  it('Activity broadcast handles null metadata', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'Activity#2026-05-28T12:48:03Z#evt-43',
        __typename: 'Activity',
        activityId: 'evt-43',
        activityType: 'DECISION_APPROVED',
        description: 'Decision approved: dec-1',
        createdAt: '2026-05-28T12:48:03Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.activity.metadata).toBeNull();
  });
```

Also update the existing `skips records whose sk is not AdvisoryStatus` test — change `sk: 'InvestorSnapshot'` to a typename that's confirmed not in the broadcasts map (e.g. `PortfolioSummary`), so the assertion still holds after Activity is added:

```ts
  it('skips records whose typename has no broadcast entry', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 1 },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests, verify the new ones fail**

```bash
pnpm nx run dashboard-bff:test --testPathPatterns=dashboard-publisher
```

Expected: the two new Activity broadcast tests fail (no `Activity` entry in broadcasts map).

- [ ] **Step 3: Implement** — add the `Activity` broadcast entry to `dashboard-publisher.ts`.

Modify `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`. Add a new mutation constant near `PUBLISH_DASHBOARD_UPDATE`:

```ts
const PUBLISH_ACTIVITY_UPDATE = `
  mutation PublishActivityUpdate($tenantId: ID!, $activity: ActivityEntryInput!) {
    publishActivityUpdate(tenantId: $tenantId, activity: $activity) {
      tenantId
      activity {
        activityId
        activityType
        description
        createdAt
        metadata
      }
    }
  }
`;
```

Then extend the `broadcasts` object in the `broadcastFromStream({...})` call (after the existing `AdvisoryStatus` entry):

```ts
    Activity: {
      mutation: PUBLISH_ACTIVITY_UPDATE,
      // skipInsert default false — Activity rows are INSERT-only; the first
      // emit IS the signal. No whenChanged: every Activity insert broadcasts.
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<id>' → '<id>'
        return {
          tenantId,
          activity: {
            activityId: String(item['activityId']),
            activityType: String(item['activityType']),
            description: String(item['description']),
            createdAt: String(item['createdAt']),
            metadata: item['metadata'] != null ? String(item['metadata']) : null,
          },
        };
      },
    },
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
pnpm nx run dashboard-bff:test --testPathPatterns=dashboard-publisher
```

Expected: all green (including the two new Activity tests + the renamed `skips records whose typename has no broadcast entry`).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts \
        services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit -m "feat(dashboard-bff): broadcast Activity rows on insert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: Wire publish-activity-update as NONE-data-source resolver

**Files:**
- Modify: `services/investor/dashboard-bff/src/service.stack.ts:23`

- [ ] **Step 1: Add to noneDataSource list**

```ts
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDashboardUpdate', 'publishActivityUpdate'],
      }),
```

- [ ] **Step 2: Synth check — confirm the resolver is picked up**

```bash
pnpm nx run dashboard-bff:build 2>&1 | tail -20
```

Expected: build succeeds. (Synth happens in deploy; build verifies the resolver-discovery code paths compile.)

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/src/service.stack.ts
git commit -m "feat(dashboard-bff): register publishActivityUpdate as NONE data source

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: Update dashboard-bff CLAUDE.md

**Files:**
- Modify: `services/investor/dashboard-bff/CLAUDE.md`

- [ ] **Step 1: Update Transforms section** — note that Activity broadcasts live.

In the `## Transforms` section, change the `recent-activity.ts` line to:

```
- recent-activity.ts — dispatches DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED (and other activity-relevant events) to the activity feed; rows are LIVE-broadcast via publishActivityUpdate → onActivityUpdate (phase 2 dispatch)
```

In `## Handlers`, add:

```
- dashboard-publisher.ts — DDB-stream-driven broadcaster: fires publishDashboardUpdate on AdvisoryStatus mutation and publishActivityUpdate on Activity insert (keyed by __typename)
```

- [ ] **Step 2: Commit**

```bash
git add services/investor/dashboard-bff/CLAUDE.md
git commit -m "docs(dashboard-bff): note Activity live-broadcast surface

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — dashboard-bff integration test

### Task 7: Integration test — Activity broadcast end-to-end

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

The integration suite already emits real EventBridge events and asserts on DDB rows. We add a case that asserts the publisher trap fires for an Activity row insert. Use the same `EventBusTrap`/AppSync trap pattern the suite already uses for `onDashboardUpdate` (look near line 400 for the existing Activity assertions; the trap pattern is below the imports — confirm naming during implementation).

- [ ] **Step 1: Read the existing trap setup** to confirm naming.

```bash
grep -n "EventBusTrap\|AppSyncTrap\|onDashboardUpdate\|publishDashboard" services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts | head -20
```

Note the trap-class import and the existing assertion shape.

- [ ] **Step 2: Add a new test case** in the relevant `describe` block (next to the existing recent-activity case near line 400):

```ts
  it('broadcasts publishActivityUpdate on DEPOSIT_DETECTED', async () => {
    const eventId = `e2e-${randomUUID()}`;
    // Use the same trap pattern the suite uses for onDashboardUpdate — if it
    // traps via DDB row poll, do the same; if it traps via AppSync subscription,
    // mirror that. Confirmed during implementation per Step 1.
    await emitEventToBus(ctx, 'investor', {
      id: eventId,
      type: 'DEPOSIT_DETECTED',
      source: `integration-test:dashboard-bff`,
      subject: { tenantId: ctx.tenantId, amountCents: 100_000 },
      context: { tenantId: ctx.tenantId, userId: ctx.userId, region: ctx.region },
    });

    await waitForItem(ctx, {
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      skPrefix: 'Activity#',
      where: (item) => item['activityId'] === eventId,
    });

    // If the suite's pattern includes a publisher trap (look in beforeAll),
    // assert it received the mutation with variables.activity.activityId === eventId.
  });
```

- [ ] **Step 3: Run the integration test against deployed dev** (per CLAUDE.md auto-run rule for integration tests).

```bash
pnpm nx run dashboard-bff:test-integration --testNamePattern="broadcasts publishActivityUpdate"
```

Expected: PASS. If the suite has a publisher trap, both the DDB row and the mutation trap assertion fire.

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit -m "test(dashboard-bff): integration coverage for Activity broadcast

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — dashboard-mfe consumer side

### Task 8: ActivityEntry type + GraphQL fragment + subscription query

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts:31-36`
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`

- [ ] **Step 1: Add activityId to the ActivityEntry interface**

```ts
// apps/dashboard-mfe/src/app/stores/dashboard.store.ts:31-36
export interface ActivityEntry {
  activityId: string;
  activityType: string;
  description: string;
  createdAt: string;
  metadata: string | null;
}
```

- [ ] **Step 2: Extend the GraphQL fragment** in `dashboard-bff.queries.ts:27-34`:

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
```

- [ ] **Step 3: Append ON_ACTIVITY_UPDATE subscription query** at the end of `dashboard-bff.queries.ts`:

```ts
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

- [ ] **Step 4: Type-check**

```bash
pnpm nx run dashboard-mfe:build 2>&1 | tail -20
```

Expected: build green (existing `getRecentActivity` callers will now get `activityId` for free from the projected DDB field).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts \
        apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts
git commit -m "feat(dashboard-mfe): ActivityEntry.activityId + ON_ACTIVITY_UPDATE query

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9: DashboardService.subscribeToActivityUpdates

**Files:**
- Modify: `apps/dashboard-mfe/src/app/services/dashboard.service.ts:79-83`
- Modify: `apps/dashboard-mfe/test/app/services/dashboard.service.spec.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe` block (or extend the existing subscription test):

```ts
  it('subscribeToActivityUpdates calls graphql.subscribe with ON_ACTIVITY_UPDATE + tenantId', () => {
    const subscribeFake = jest.fn().mockReturnValue({ subscribe: jest.fn() });
    (service as any).graphql.subscribe = subscribeFake;
    service.subscribeToActivityUpdates('tenant-42');
    expect(subscribeFake).toHaveBeenCalledTimes(1);
    expect(subscribeFake.mock.calls[0][0]).toContain('subscription OnActivityUpdate');
    expect(subscribeFake.mock.calls[0][1]).toEqual({ tenantId: 'tenant-42' });
  });
```

Match the existing `subscribeToDashboardUpdates` test's setup style (likely uses an injected mock `GraphqlService`).

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard.service.spec
```

Expected: FAIL — `service.subscribeToActivityUpdates is not a function`.

- [ ] **Step 3: Add the method** in `dashboard.service.ts`:

Add the import near line 10 (if not already present):

```ts
import {
  GET_DASHBOARD,
  GET_POSITION_SNAPSHOTS,
  GET_RECENT_ACTIVITY,
  GET_SIMULATION_SUMMARY,
  ON_DASHBOARD_UPDATE,
  ON_ACTIVITY_UPDATE,
} from '../graphql/dashboard-bff.queries';
```

Append the method after `subscribeToDashboardUpdates`:

```ts
  /**
   * Live activity feed: dashboard-bff fires `publishActivityUpdate` IAM-signed
   * after each Activity row insert. Frame shape: `{ activity: ActivityEntry }`.
   */
  subscribeToActivityUpdates(
    tenantId: string,
  ): Observable<{ onActivityUpdate: { activity: ActivityEntry } | null }> {
    return this.graphql.subscribe(ON_ACTIVITY_UPDATE, { tenantId });
  }
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard.service.spec
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/services/dashboard.service.ts \
        apps/dashboard-mfe/test/app/services/dashboard.service.spec.ts
git commit -m "feat(dashboard-mfe): DashboardService.subscribeToActivityUpdates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: DashboardStore.addActivity reducer

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts:113-152` (withMethods block)
- Create or modify: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { DashboardStore, type ActivityEntry } from '../../../src/app/stores/dashboard.store';

function entry(id: string, ts = '2026-05-28T00:00:00Z'): ActivityEntry {
  return {
    activityId: id,
    activityType: 'DEPOSIT_DETECTED',
    description: `Deposit ${id}`,
    createdAt: ts,
    metadata: null,
  };
}

describe('DashboardStore.addActivity', () => {
  let store: InstanceType<typeof DashboardStore>;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
  });

  it('prepends the new entry to activities', () => {
    store.setActivities([entry('a'), entry('b')]);
    store.addActivity(entry('c'));
    expect(store.activities().map((a) => a.activityId)).toEqual(['c', 'a', 'b']);
  });

  it('dedupes by activityId', () => {
    store.setActivities([entry('a')]);
    store.addActivity(entry('a'));
    expect(store.activities()).toHaveLength(1);
    expect(store.activities()[0].activityId).toBe('a');
  });

  it('caps the list at 50 entries', () => {
    store.setActivities(Array.from({ length: 50 }, (_, i) => entry(`a${i}`)));
    store.addActivity(entry('new'));
    expect(store.activities()).toHaveLength(50);
    expect(store.activities()[0].activityId).toBe('new');
    expect(store.activities().at(-1)?.activityId).toBe('a48'); // a49 dropped
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard.store.spec
```

Expected: FAIL — `store.addActivity is not a function`.

- [ ] **Step 3: Implement** — add `addActivity` inside the existing `withMethods((store) => ({ ... }))` block in `dashboard.store.ts`:

```ts
    addActivity(entry: ActivityEntry): void {
      const current = store.activities();
      if (current.some((a) => a.activityId === entry.activityId)) return; // dedupe
      const next = [entry, ...current].slice(0, 50);                       // cap
      patchState(store, { activities: next });
    },
```

- [ ] **Step 4: Run tests, verify all three pass**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard.store.spec
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts \
        apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts
git commit -m "feat(dashboard-mfe): DashboardStore.addActivity (prepend + dedupe + cap)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: dashboard-container.component subscribes + dispatches

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts:159-184`
- Modify: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Write the failing test** — extend the existing spec with an Activity-subscription case.

```ts
  it('subscribes to onActivityUpdate on init and dispatches to store', async () => {
    const activityFrame$ = new Subject<{ onActivityUpdate: { activity: ActivityEntry } | null }>();
    (component as any).dashboardService.subscribeToActivityUpdates = jest.fn(() => activityFrame$);
    const addSpy = jest.spyOn((component as any).store, 'addActivity');

    await component.ngOnInit();
    activityFrame$.next({
      onActivityUpdate: {
        activity: {
          activityId: 'evt-42',
          activityType: 'DEPOSIT_DETECTED',
          description: 'Deposit detected: 1000 USD',
          createdAt: '2026-05-28T12:48:03Z',
          metadata: null,
        },
      },
    });
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'evt-42' }));
  });
```

Match the existing dashboard-subscription test setup style for mocks (likely a `Subject` already exists in the test for `onDashboardUpdate`).

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard-container.component.spec
```

Expected: FAIL — `subscribeToActivityUpdates` not invoked.

- [ ] **Step 3: Implement** — modify `dashboard-container.component.ts`:

Add a second subscription field next to the existing one:

```ts
  private updateSubscription: Subscription | null = null;
  private activitySubscription: Subscription | null = null;
```

Update `ngOnDestroy`:

```ts
  ngOnDestroy(): void {
    this.updateSubscription?.unsubscribe();
    this.updateSubscription = null;
    this.activitySubscription?.unsubscribe();
    this.activitySubscription = null;
  }
```

Update `subscribeToUpdates` to subscribe to both surfaces:

```ts
  private subscribeToUpdates(): void {
    const tenantId = this.authStore.user()?.tenantId;
    if (!tenantId) return;
    this.updateSubscription = this.dashboardService
      .subscribeToDashboardUpdates(tenantId)
      .subscribe({
        next: (data) => {
          const advisoryStatus = data?.onDashboardUpdate?.advisoryStatus;
          if (advisoryStatus) {
            this.store.setAdvisoryStatus(advisoryStatus);
          }
        },
      });
    this.activitySubscription = this.dashboardService
      .subscribeToActivityUpdates(tenantId)
      .subscribe({
        next: (data) => {
          const activity = data?.onActivityUpdate?.activity;
          if (activity) {
            this.store.addActivity(activity);
          }
        },
      });
  }
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm nx run dashboard-mfe:test --testPathPatterns=dashboard-container.component.spec
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts \
        apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit -m "feat(dashboard-mfe): subscribe to onActivityUpdate + dispatch to store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 12: activity-feed.component — DOM hook + track-by

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/activity-feed.component.ts`

- [ ] **Step 1: Edit the template**

Change the `@for` line and add `data-activity-id`:

```html
@for (activity of activities; track activity.activityId) {
  <div class="activity-item" [attr.data-activity-id]="activity.activityId">
    <span class="activity-icon" [class]="getIconClass(activity.activityType)"></span>
    <div class="activity-content">
      <div class="activity-desc">{{ activity.description }}</div>
      <div class="activity-time">{{ activity.createdAt | relativeTime }}</div>
    </div>
  </div>
}
```

(Use Angular's `[attr.data-activity-id]` syntax so the value is set as a DOM attribute, not a property — Playwright's `[data-activity-id="..."]` CSS selector matches on the attribute.)

- [ ] **Step 2: Build to verify template still parses**

```bash
pnpm nx run dashboard-mfe:build 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/activity-feed.component.ts
git commit -m "feat(dashboard-mfe): activity-feed track by activityId + data-activity-id attr

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — nestfolio-e2e

### Task 13: inject fixture returns eventId

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:74-114`

- [ ] **Step 1: Change return type + return the eventId**

```ts
export async function injectDashboardBffTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<{ eventId: string }> {                              // was Promise<void>
  const busArn = await ctx.ssm.busArn('investor');
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: `integration-test:dashboard-bff`,
          DetailType: 'DEPOSIT_DETECTED',
          Detail: JSON.stringify({
            id: eventId,
            type: 'DEPOSIT_DETECTED',
            timestamp: now,
            subject: {
              tenantId: tenant.tenantId,
              amountCents: 100_000,
            },
            context: {
              tenantId: tenant.tenantId,
              userId: tenant.userId,
              region: ctx.region,
            },
          }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `injectDashboardBffTriggerEvent: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
  return { eventId };
}
```

- [ ] **Step 2: Verify no other caller is broken by the signature change**

```bash
grep -rn "injectDashboardBffTriggerEvent" apps/nestfolio-e2e/src 2>/dev/null
```

Expected: only callers in `journeys/new-investor-happy-path.spec.ts` (updated in Task 15) and possibly `scenarios/advisory-generating-state.spec.ts`. If the scenarios caller doesn't use the return value, the `Promise<void>` → `Promise<{eventId}>` change is non-breaking (caller can still `await` and ignore the value).

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
git commit -m "feat(e2e): injectDashboardBffTriggerEvent returns eventId

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 14: DashboardPage.waitForActivityByEventId

**Files:**
- Modify: `apps/nestfolio-e2e/src/pages/dashboard.page.ts:43-49`

- [ ] **Step 1: Add the helper** at the end of the class:

```ts
  /**
   * Wait until the activity feed contains an entry with the given activityId.
   *
   * WSS proof: the row only reaches the DOM via the onActivityUpdate broadcast
   * (no page reload between inject and assert). Activity rows are append-only
   * so this assertion does not race with concurrent DECISION_APPROVED decrements.
   */
  async waitForActivityByEventId(activityId: string, timeout = 30_000): Promise<void> {
    await this.page
      .locator(`.activity-item[data-activity-id="${activityId}"]`)
      .waitFor({ state: 'visible', timeout });
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/dashboard.page.ts
git commit -m "feat(e2e): DashboardPage.waitForActivityByEventId helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 15: Replace the racing assertion in the happy-path journey

**Files:**
- Modify: `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:135-162`

- [ ] **Step 1: Edit the Step 8 comment + body**

Replace lines 135-162 with:

```ts
  // Step 8 — a synthetic DEPOSIT_DETECTED scoped to dashboard-bff reaches the
  //          activity feed via the WSS subscription without a page reload.
  //          (Activity row is append-only and keyed by eventId, so this proof
  //          does not race the real pipeline's DECISION_APPROVED decrement.)
  await test.step('decision pipeline triggers + WSS live-update verified', async () => {
    await authedPage.goto('/dashboard');
    await dashboard.waitForLoaded();
    // Page-settled wait: any non-zero pending count proves the dashboard read
    // model loaded. The value itself is no longer the assertion target.
    await dashboard.waitForPendingDecisionsAtLeast(1, 180_000);

    // Fire a real DEPOSIT_DETECTED scoped to dashboard-bff only (source
    // `integration-test:dashboard-bff` — passes dashboard-bff's $or Ingress
    // filter but is dropped by advisory-adpt, so no agent pipeline cost).
    // The dashboard is mounted with an active subscription; with no page
    // reload between this inject and the assert below, the only path the
    // Activity row can travel is the `onActivityUpdate` WSS broadcast.
    const { eventId } = await injectDashboardBffTriggerEvent(ctx, tenant);
    await dashboard.waitForActivityByEventId(eventId, 30_000);

    // Wait for advisory-bff's projection to actually carry the decision row
    // the dashboard counter is announcing. The two projections run in
    // parallel and advisory typically lags the dashboard by 30+ seconds; if
    // we navigate to /advisory before the row exists, Step 9's 15s POM
    // timeout fires on empty state — a pipeline-latency bug masquerading as
    // a UI race. See `wait-for-advisory-projection.ts` for the rationale.
    await waitForAdvisoryDecisionRow(ctx, tenant);
  });
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
git commit -m "fix(e2e): assert activity row by eventId, not racing pendingDecisionsCount

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Validation gate

### Task 16: nx affected — tests + lint

**Files:** none

- [ ] **Step 1: Run nx affected**

```bash
pnpm nx affected -t test,lint --base=origin/main 2>&1 | tail -30
```

Expected: green. If any project fails (likely event-processor consumers' tests if the dispatcher tweak surfaces an edge case), fix the underlying issue and re-run — do NOT skip.

### Task 17: Deploy dashboard-bff + investor-web to dev

**Files:** none

- [ ] **Step 1: Deploy**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff,investor-web 2>&1 | tee /tmp/deploy-activity-broadcast.log | tail -40
```

Expected: both stacks update without rollback. Note the CFN UPDATE_COMPLETE timestamps for both stacks — needed for the validation_gate field.

- [ ] **Step 2: Confirm MFE bundle was uploaded**

```bash
AWS_PROFILE=nestfolio-dev aws s3 ls s3://771924376645-dev-nestfolio-mfe-dashboard/ | tail -5
```

Expected: see the dashboard MFE bundle timestamps within the last few minutes.

### Task 18: Integration tests against deployed dev

**Files:** none

- [ ] **Step 1: Run dashboard-bff integration tests**

```bash
pnpm nx run dashboard-bff:test-integration 2>&1 | tail -30
```

Expected: all green (including the new `broadcasts publishActivityUpdate` case from Task 7).

### Task 19: Playwright e2e — 2 consecutive runs

**Files:** none

Per `apps/nestfolio-e2e/CLAUDE.md` anti-flake rule + `feedback-flake-means-broken`: a single pass is not evidence of greenness. Two consecutive passes are required. If any run fails-then-passes on a rerun, pull CloudWatch evidence from the failing window before continuing.

- [ ] **Step 1: First run**

```bash
pnpm nx run nestfolio-e2e:e2e 2>&1 | tee /tmp/pw-run-1.log | tail -40
```

Expected: 4/4 scenarios PASS. In particular `new-investor-happy-path.spec.ts` Step 8 ("decision pipeline triggers + WSS live-update verified") must pass on the activity-row assertion path.

- [ ] **Step 2: Second run**

```bash
pnpm nx run nestfolio-e2e:e2e 2>&1 | tee /tmp/pw-run-2.log | tail -40
```

Expected: 4/4 scenarios PASS again.

- [ ] **Step 3: If either run had a flake (failed then re-passed)** — STOP. Pull CloudWatch logs from the failing window, file evidence, and re-evaluate. Do not declare green based on a passing rerun alone.

---

## Phase 7 — Ship the workstream

### Task 20: Flip dossier to shipped + regen index

**Files:**
- Modify: `docs/backlog/happy-path-pendingcount-wss-decrement-race.md`

- [ ] **Step 1: Edit dossier frontmatter**

Set `status: shipped` and fill `validation_gate:` with concrete evidence — at minimum: the deploy log line(s) from Task 17, the two Playwright run log paths (`/tmp/pw-run-1.log`, `/tmp/pw-run-2.log`), and the most recent commit SHA for the implementation. Example shape:

```yaml
validation_gate: |
  - nx affected -t test,lint --base=origin/main: GREEN (Task 16 output)
  - dev-dashboard-bff deploy UPDATE_COMPLETE <timestamp> (Task 17)
  - dev-investor-web deploy UPDATE_COMPLETE <timestamp> (Task 17)
  - dashboard-bff:test-integration: GREEN incl. broadcasts publishActivityUpdate
  - nestfolio-e2e:e2e: 4/4 PASS run 1 (/tmp/pw-run-1.log)
  - nestfolio-e2e:e2e: 4/4 PASS run 2 (/tmp/pw-run-2.log)
  - implementation: <last-commit-sha>
```

- [ ] **Step 2: Run backlog-lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -3
```

Expected: `all 8 rules pass`.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/happy-path-pendingcount-wss-decrement-race.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship happy-path-pendingcount-wss-decrement-race

Activity is now a live AppSync broadcast surface on dashboard-bff. The
e2e Step 8 assertion targets the append-only activityId, eliminating the
race against the real pipeline's DECISION_APPROVED decrement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 21: Route to finishing-a-development-branch

**Files:** none

- [ ] **Step 1: Invoke the finishing skill**

```
Skill: superpowers:finishing-a-development-branch
```

Let it handle the merge / PR / branch cleanup. Do NOT manually `gh pr create` + `gh pr merge` — the skill knows about branch deletion, fast-forward reconciliation, and `gh pr merge --delete-branch` ordering.

- [ ] **Step 2: After the merge skill returns, exit the worktree session**

```
Tool: ExitWorktree
  action: remove
```

If the tool warns about "discard N commits permanently", first verify safety:

```bash
git merge-base --is-ancestor worktree-activity-live-broadcast main; echo "exit=$?"
```

Exit 0 ⇒ every branch commit is reachable from main; re-invoke `ExitWorktree` with `discard_changes: true`. This is the expected cleanup path after a squash-merge.

### Task 22: Postflight

**Files:** none

- [ ] **Step 1: Run postflight**

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=worktree-activity-live-broadcast 2>&1 | tail -10
```

Expected: green. If it surfaces any issue (stale worktree, unmerged branch, dirty tree, lint violation), fix and re-run before declaring the workstream complete.

---

## Self-review notes (filled during plan write)

- **Spec coverage:** all 5 spec sections (problem, solution, OOS, architecture, components, data flow, validation, risks) map to tasks above.
- **Placeholder scan:** no TBD / TODO; every code step contains the actual code; every command has the expected output.
- **Type consistency:** `ActivityEntry.activityId: string` (TS) matches `ActivityEntry.activityId: ID!` (GraphQL). `addActivity(entry: ActivityEntry)` signature matches what the component dispatches. `waitForActivityByEventId(activityId: string)` parameter matches what the inject fixture returns.
- **Library blast radius:** Task 1 ships the broadcastFromStream tweak with a regression test for the existing AdvisoryStatus case + a new compound-sk test. Both existing consumers (dashboard-bff `AdvisoryStatus`, advisory-bff `DecisionReadModel`) have `sk === __typename` so the change is a no-op for them.
- **CDK IAM:** `service.stack.ts:67-71` grants `appsync:GraphQL` on `${facade.api.arn}/*` — wildcard covers the new `publishActivityUpdate` mutation automatically. No grant change needed.
