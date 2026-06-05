# Dashboard PortfolioSummary Live-Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a deposit lands or a trade fills, the dashboard KPI cards (`totalValueCents`, `cashBalanceCents`, `positionCount`) update live over AppSync without a manual refresh — closing the canonical "where's my money on the dashboard" gap.

**Architecture:** Transport-only (materialization already shipped via `portfolio-summary.ts` `projectVersioned`). The `PortfolioSummary` read-row rides the EXISTING `onDashboardUpdate` / `Dashboard` channel (grouped-by-state-shape, Approach A) — no new GraphQL subscription. A new shared `@nestfolio/ui` `subscribeThenReconcile` RxJS helper encapsulates the subscribe-before-query + reconnect-requery pattern; the existing inline Activity-channel reconnect is refactored onto it (caller #1) and the dashboard channel adopts it (caller #2). The client applies live frames last-write-wins by `updatedAt` so a reconnect backfill snapshot can never clobber a newer live frame.

**Tech Stack:** TypeScript, AppSync GraphQL (JS resolvers), `@nestfolio/event-processor` `broadcastFromStream`, DynamoDB Streams, Angular 21 + `@ngrx/signals`, RxJS 7, Jest 30, Nx.

---

## File Structure

**New files:**
- `libs/ui/src/shared/realtime/subscribe-then-reconcile.ts` — generic RxJS helper: open a live subscription, apply each frame, re-query + re-subscribe with backoff on drop. Framework-free (rxjs only), liftable to any MFE.
- `libs/ui/test/shared/realtime/subscribe-then-reconcile.spec.ts` — helper unit tests.

**Modified — backend (`services/investor/dashboard-bff`):**
- `src/schema.graphql` — add `PortfolioSummaryInput`; add `portfolioSummary` arg to `publishDashboardUpdate`.
- `src/graphql/js-function/publish-dashboard-update.fn.js` — return `portfolioSummary` from args.
- `src/handlers/dashboard-publisher.ts` — extend the shared mutation with `$portfolioSummary`; add a `PortfolioSummary` broadcast entry.
- `test/unit/handlers/dashboard-publisher.test.ts` — add a PortfolioSummary-broadcast test; flip the now-stale "skips PortfolioSummary" test.
- `CLAUDE.md` — service card: publisher now broadcasts `PortfolioSummary`.

**Modified — barrel:**
- `libs/ui/src/index.ts` — export the helper.

**Modified — frontend (`apps/dashboard-mfe`):**
- `src/app/graphql/dashboard-bff.queries.ts` — `ON_DASHBOARD_UPDATE` requests `portfolioSummary`.
- `src/app/services/dashboard.service.ts` — widen `subscribeToDashboardUpdates` return type to include `portfolioSummary`.
- `src/app/stores/dashboard.store.ts` — add `setPortfolioSummary` (LWW), add LWW guard to `setAdvisoryStatus`, route `setDashboard` through the guarded setters.
- `test/app/stores/dashboard.store.spec.ts` — LWW + setDashboard-no-clobber tests.
- `src/app/dashboard/dashboard-container.component.ts` — wire both channels through `subscribeThenReconcile`; apply live `portfolioSummary`; add dashboard reconnect backfill.
- `test/app/dashboard/dashboard-container.component.spec.ts` — live-portfolioSummary + dashboard-reconnect tests.

**Out of scope** (see backlog file `docs/backlog/dashboard-live-push-portfolio-summary.md`): PositionSnapshot live-push (rank-2, separate greenfield channel), `investorSnapshot` live-push, any new subscription channel, the read-model materialization (already shipped).

---

## Task 1: Shared `subscribeThenReconcile` helper in `@nestfolio/ui`

**Files:**
- Create: `libs/ui/src/shared/realtime/subscribe-then-reconcile.ts`
- Test: `libs/ui/test/shared/realtime/subscribe-then-reconcile.spec.ts`
- Modify: `libs/ui/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/ui/test/shared/realtime/subscribe-then-reconcile.spec.ts`:

```typescript
import { Subject } from 'rxjs';
import { subscribeThenReconcile } from '../../../src/shared/realtime/subscribe-then-reconcile';

describe('subscribeThenReconcile', () => {
  it('applies each live frame via onFrame', () => {
    const source = new Subject<number>();
    const frames: number[] = [];
    const sub = subscribeThenReconcile({
      source,
      onFrame: (f) => frames.push(f),
      reconnectBackoffMs: 1000,
    });

    source.next(1);
    source.next(2);

    expect(frames).toEqual([1, 2]);
    sub.unsubscribe();
  });

  it('calls onReconnect once when the source errors (drop), before re-subscribing', () => {
    const source = new Subject<number>();
    const onReconnect = jest.fn();
    const sub = subscribeThenReconcile({
      source,
      onFrame: () => {},
      onReconnect,
      reconnectBackoffMs: 1000,
    });

    // A WS drop surfaces as an error on the source. retry() catches it, runs
    // onReconnect synchronously, then waits reconnectBackoffMs before
    // re-subscribing. We never advance the timer, so the (terminated) Subject
    // is never re-subscribed — mirrors the proven container reconnect test.
    source.error(new Error('ws dropped'));

    expect(onReconnect).toHaveBeenCalledTimes(1);
    sub.unsubscribe(); // cancels the pending backoff timer
  });

  it('is safe when onReconnect is omitted', () => {
    const source = new Subject<number>();
    const sub = subscribeThenReconcile({
      source,
      onFrame: () => {},
      reconnectBackoffMs: 1000,
    });

    expect(() => source.error(new Error('ws dropped'))).not.toThrow();
    sub.unsubscribe();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test ui -- --testPathPatterns=subscribe-then-reconcile`
Expected: FAIL — `Cannot find module '../../../src/shared/realtime/subscribe-then-reconcile'`.

- [ ] **Step 3: Write the helper**

Create `libs/ui/src/shared/realtime/subscribe-then-reconcile.ts`:

```typescript
import { type Observable, type Subscription, retry, timer } from 'rxjs';

/**
 * Subscribe-before-query + reconnect-requery transport glue, shared by every
 * dashboard live-push channel (Activity feed, PortfolioSummary, future
 * surfaces). Establish the subscription BEFORE the initial snapshot query so a
 * frame arriving mid-load is not lost; on a dropped connection, re-query the
 * backing store (to recover rows missed while disconnected) and re-subscribe
 * after a short backoff.
 *
 * Pairs with a last-write-wins store setter on the consumer side: the reconnect
 * re-query is a backfill snapshot that must not clobber a newer live frame.
 *
 * Framework-free (rxjs only) so it is liftable to any MFE.
 */
export interface SubscribeThenReconcileOptions<T> {
  /**
   * The live subscription Observable (e.g. `graphql.subscribe(...)`). Must be
   * cold/re-runnable: `retry` re-subscribes to it after each drop, which
   * re-opens the underlying WebSocket.
   */
  source: Observable<T>;
  /** Applies each live frame to local state. */
  onFrame: (frame: T) => void;
  /**
   * Called on every dropped connection BEFORE re-subscribing, to re-query the
   * backing store and reconcile rows missed while disconnected. Best-effort:
   * its rejection is swallowed and must not abort the retry.
   */
  onReconnect?: () => void | Promise<void>;
  /** Backoff before re-subscribing after a drop (ms). */
  reconnectBackoffMs: number;
}

export function subscribeThenReconcile<T>(
  opts: SubscribeThenReconcileOptions<T>,
): Subscription {
  return opts.source
    .pipe(
      retry({
        delay: () => {
          if (opts.onReconnect) {
            // Swallow rejection — a failed backfill must not abort the retry.
            void Promise.resolve(opts.onReconnect()).catch(() => {});
          }
          return timer(opts.reconnectBackoffMs);
        },
      }),
    )
    .subscribe({ next: (frame) => opts.onFrame(frame) });
}
```

- [ ] **Step 4: Add the barrel export**

In `libs/ui/src/index.ts`, after the `// Shared - Advisory cycle state` block, add:

```typescript
// Shared - Realtime transport
export { subscribeThenReconcile } from './shared/realtime/subscribe-then-reconcile';
export type { SubscribeThenReconcileOptions } from './shared/realtime/subscribe-then-reconcile';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test ui -- --testPathPatterns=subscribe-then-reconcile`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/ui/src/shared/realtime/subscribe-then-reconcile.ts libs/ui/test/shared/realtime/subscribe-then-reconcile.spec.ts libs/ui/src/index.ts
git commit --no-verify -m "feat(ui): add subscribeThenReconcile shared live-push helper"
```

---

## Task 2: Refactor the Activity channel onto the helper (caller #1, no behavior change)

This proves the helper against the already-passing Activity reconnect tests before any new behavior is added.

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`

- [ ] **Step 1: Run the existing container tests to confirm green baseline**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard-container`
Expected: PASS (includes "subscribes to onActivityUpdate…", "preserves a live activity frame…", "backfills via getRecentActivity when the activity subscription reconnects").

- [ ] **Step 2: Refactor the imports**

In `dashboard-container.component.ts`, change the rxjs import (line 2) from:

```typescript
import { retry, timer, type Subscription } from 'rxjs';
```

to:

```typescript
import { type Subscription } from 'rxjs';
```

And add `subscribeThenReconcile` to the existing `@nestfolio/ui` import (line 7), so it reads:

```typescript
import { LoadingSkeletonComponent, subscribeThenReconcile } from '@nestfolio/ui';
```

- [ ] **Step 3: Refactor the Activity branch of `subscribeToUpdates()`**

Replace the `this.activitySubscription = ...` assignment (the `.pipe(retry({ delay: () => { ... } }))` block) with:

```typescript
    this.activitySubscription = subscribeThenReconcile({
      source: this.dashboardService.subscribeToActivityUpdates(tenantId),
      onFrame: (data) => {
        const activity = data?.onActivityUpdate?.activity;
        if (activity) {
          this.store.addActivity(activity);
        }
      },
      onReconnect: () => this.backfillActivities(),
      reconnectBackoffMs: ACTIVITY_RECONNECT_BACKOFF_MS,
    });
```

Leave `ACTIVITY_RECONNECT_BACKOFF_MS`, `backfillActivities()`, and the dashboard-channel branch unchanged for now.

- [ ] **Step 4: Run the container tests to verify still green**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard-container`
Expected: PASS — same tests, no behavior change.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts
git commit --no-verify -m "refactor(dashboard-mfe): route Activity channel through subscribeThenReconcile"
```

---

## Task 3: Backend — add `PortfolioSummaryInput` + mutation arg to the schema

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`

- [ ] **Step 1: Add the input type and mutation arg**

In `src/schema.graphql`, change the `publishDashboardUpdate` mutation to add the `portfolioSummary` arg:

```graphql
  publishDashboardUpdate(
    tenantId: ID!
    advisoryStatus: AdvisoryStatusInput
    portfolioSummary: PortfolioSummaryInput
  ): Dashboard!
    @aws_iam
```

And add a new input type next to `input AdvisoryStatusInput { … }`:

```graphql
input PortfolioSummaryInput {
  totalValueCents: Int!
  cashBalanceCents: Int!
  positionCount: Int!
  updatedAt: String!
}
```

(The `type PortfolioSummary` and `Dashboard.portfolioSummary` field already exist — do not re-add them.)

- [ ] **Step 2: Verify the schema still type-checks via build/synth**

Run: `pnpm nx run dashboard-bff:typecheck`
Expected: PASS (no read-model-ownership trip-wire involved; this is schema + types only).

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql
git commit --no-verify -m "feat(dashboard-bff): add PortfolioSummaryInput + publishDashboardUpdate arg"
```

---

## Task 4: Backend — resolver returns `portfolioSummary`

**Files:**
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/publish-dashboard-update.fn.js`

- [ ] **Step 1: Return the arg from the response**

Replace the `response` function body so it threads `portfolioSummary` through:

```javascript
export function response(ctx) {
  const { tenantId, advisoryStatus, portfolioSummary } = ctx.arguments;
  return {
    tenantId,
    portfolioSummary: portfolioSummary ?? null,
    advisoryStatus: advisoryStatus ?? null,
    investorSnapshot: null,
  };
}
```

(The `request` function is unchanged — NONE data source, `return { payload: {} };`.)

- [ ] **Step 2: Commit**

```bash
git add services/investor/dashboard-bff/src/graphql/js-function/publish-dashboard-update.fn.js
git commit --no-verify -m "feat(dashboard-bff): resolver returns portfolioSummary for live-push"
```

---

## Task 5: Backend — broadcast `PortfolioSummary` from the DDB stream

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`
- Test: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/unit/handlers/dashboard-publisher.test.ts`, REPLACE the existing test `it('skips records whose typename has no broadcast entry', …)` (the one whose `newImage` uses `sk: 'PortfolioSummary'`) with these two tests:

```typescript
  it('broadcasts publishDashboardUpdate with portfolioSummary (MODIFY, KPI changed)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 1000, cashBalanceCents: 1000, positionCount: 0, __version: 1, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 250000, cashBalanceCents: 200000, positionCount: 2, __version: 2, updatedAt: '2026-05-01T12:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      portfolioSummary: {
        totalValueCents: 250000,
        cashBalanceCents: 200000,
        positionCount: 2,
        updatedAt: '2026-05-01T12:00:00Z',
      },
    });
  });

  it('broadcasts portfolioSummary on INSERT (first materialisation)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 100000, cashBalanceCents: 100000, positionCount: 0, __version: 1, updatedAt: '2026-05-01T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.portfolioSummary).toMatchObject({ totalValueCents: 100000, positionCount: 0 });
  });

  it('skips a PortfolioSummary MODIFY when no KPI field changed', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 100000, cashBalanceCents: 100000, positionCount: 0, __version: 1, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 100000, cashBalanceCents: 100000, positionCount: 0, __version: 2, updatedAt: '2026-05-01T00:05:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('skips records whose typename has no broadcast entry', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'InvestorSnapshot', __typename: 'InvestorSnapshot', goalType: 'GROWTH' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test dashboard-bff -- --testPathPatterns=dashboard-publisher`
Expected: FAIL — the two PortfolioSummary broadcast tests expect `postAppSyncMutation` called once but no `PortfolioSummary` entry exists yet (called 0 times).

- [ ] **Step 3: Extend the mutation and add the broadcast entry**

In `src/handlers/dashboard-publisher.ts`, change `PUBLISH_DASHBOARD_UPDATE` to declare and select `portfolioSummary`:

```typescript
const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput, $portfolioSummary: PortfolioSummaryInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus, portfolioSummary: $portfolioSummary) {
      tenantId
      portfolioSummary {
        totalValueCents
        cashBalanceCents
        positionCount
        updatedAt
      }
      advisoryStatus {
        pendingDecisionsCount
        generatingCount
        failedCount
        oldestGeneratingAt
        updatedAt
      }
    }
  }
`;
```

Then add a `PortfolioSummary` entry to the `broadcasts` map (alongside `AdvisoryStatus` and `Activity`):

```typescript
    PortfolioSummary: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert default false — first PortfolioSummary materialisation also
      // broadcasts. Gate MODIFY on the KPI values (not updatedAt, which always
      // changes) so a no-op snapshot rewrite does not spam the channel.
      whenChanged: ['totalValueCents', 'cashBalanceCents', 'positionCount'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          portfolioSummary: {
            totalValueCents: Number(item['totalValueCents'] ?? 0),
            cashBalanceCents: Number(item['cashBalanceCents'] ?? 0),
            positionCount: Number(item['positionCount'] ?? 0),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
```

(The `AdvisoryStatus` entry is unchanged — its `mapImage` still returns only `{ tenantId, advisoryStatus }`, so AppSync sends `$portfolioSummary` as null for advisory broadcasts and the resolver returns `portfolioSummary: null`. Likewise PortfolioSummary broadcasts carry `advisoryStatus: null`. The client ignores null surfaces.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test dashboard-bff -- --testPathPatterns=dashboard-publisher`
Expected: PASS — all advisory, activity, and the new PortfolioSummary tests green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit --no-verify -m "feat(dashboard-bff): broadcast PortfolioSummary on the dashboard channel"
```

---

## Task 6: Frontend — subscription requests `portfolioSummary` + service return type

**Files:**
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`
- Modify: `apps/dashboard-mfe/src/app/services/dashboard.service.ts`

- [ ] **Step 1: Extend `ON_DASHBOARD_UPDATE` to request `portfolioSummary`**

In `dashboard-bff.queries.ts`, replace the `ON_DASHBOARD_UPDATE` export with:

```typescript
export const ON_DASHBOARD_UPDATE = `
  subscription OnDashboardUpdate($tenantId: ID!) {
    onDashboardUpdate(tenantId: $tenantId) {
      portfolioSummary {
        ...PortfolioSummaryFields
      }
      advisoryStatus {
        ...AdvisoryStatusFields
      }
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
`;
```

(`PORTFOLIO_SUMMARY_FIELDS` and `ADVISORY_STATUS_FIELDS` are already defined at the top of the file.)

- [ ] **Step 2: Widen the service return type**

In `dashboard.service.ts`, add `PortfolioSummary` to the type import block:

```typescript
import type {
  DashboardData,
  AdvisoryStatus,
  PortfolioSummary,
  PositionSnapshot,
  ActivityEntry,
  SimulationSummary,
} from '../stores/dashboard.store';
```

And widen `subscribeToDashboardUpdates`:

```typescript
  subscribeToDashboardUpdates(
    tenantId: string,
  ): Observable<{
    onDashboardUpdate: {
      advisoryStatus: AdvisoryStatus | null;
      portfolioSummary: PortfolioSummary | null;
    } | null;
  }> {
    return this.graphql.subscribe(ON_DASHBOARD_UPDATE, { tenantId });
  }
```

- [ ] **Step 3: Verify the service test still type-checks/passes**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard.service`
Expected: PASS (the existing service spec asserts the subscribe call; the widened type is structurally compatible).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts apps/dashboard-mfe/src/app/services/dashboard.service.ts
git commit --no-verify -m "feat(dashboard-mfe): subscribe to live portfolioSummary frames"
```

---

## Task 7: Frontend store — LWW setters + non-clobbering `setDashboard`

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `dashboard.store.spec.ts`, add a new `describe` block after the `describe('advisory cycle derivation', …)` block (before the final closing `});` of `describe('DashboardStore', …)`):

```typescript
  describe('live last-write-wins setters', () => {
    const summaryAt = (updatedAt: string, totalValueCents = 1): PortfolioSummary => ({
      totalValueCents, cashBalanceCents: 0, positionCount: 0, updatedAt,
    });
    const advisoryAt = (updatedAt: string, pendingDecisionsCount = 1): AdvisoryStatus => ({
      pendingDecisionsCount, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null, updatedAt,
    });

    it('setPortfolioSummary applies a newer frame', () => {
      store.setPortfolioSummary(summaryAt('2026-03-01T00:00:00Z', 100));
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setPortfolioSummary drops a strictly-older frame', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      store.setPortfolioSummary(summaryAt('2026-03-01T00:00:00Z', 100)); // older
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setPortfolioSummary never clobbers a live value with null', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      store.setPortfolioSummary(null);
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setAdvisoryStatus drops a strictly-older frame', () => {
      store.setAdvisoryStatus(advisoryAt('2026-03-02T00:00:00Z', 5));
      store.setAdvisoryStatus(advisoryAt('2026-03-01T00:00:00Z', 1)); // older
      expect(store.advisoryStatus()?.pendingDecisionsCount).toBe(5);
    });

    it('setDashboard does not clobber a newer live portfolioSummary with an older snapshot', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200)); // live frame
      store.setDashboard({
        portfolioSummary: summaryAt('2026-03-01T00:00:00Z', 100), // older backfill snapshot
        advisoryStatus: null,
        investorSnapshot: null,
      });
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard.store`
Expected: FAIL — `store.setPortfolioSummary is not a function`, and `setDashboard` clobbers (no LWW guard yet).

- [ ] **Step 3: Add the LWW setters and route `setDashboard` through them**

In `dashboard.store.ts`, inside `withMethods((store) => ({ … }))`, replace the existing `setDashboard` and `setAdvisoryStatus` methods with:

```typescript
    // Live last-write-wins by `updatedAt`: drop a STRICTLY-older frame, never
    // overwrite a live value with null. Equal timestamps still apply (idempotent
    // last-write-wins, matching the prior unguarded behaviour). Lets the
    // reconnect backfill snapshot coexist with a newer live frame.
    setPortfolioSummary(incoming: PortfolioSummary | null): void {
      if (!incoming) return;
      const current = store.portfolioSummary();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { portfolioSummary: incoming });
    },
    setAdvisoryStatus(incoming: AdvisoryStatus | null): void {
      if (!incoming) {
        patchState(store, { advisoryStatus: null });
        return;
      }
      const current = store.advisoryStatus();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { advisoryStatus: incoming });
    },
    setDashboard(data: DashboardData): void {
      // investorSnapshot has no live channel — apply directly. The two live
      // surfaces go through the guarded setters so a (re-query) snapshot can't
      // clobber a newer live frame.
      patchState(store, { investorSnapshot: data.investorSnapshot });
      this.setPortfolioSummary(data.portfolioSummary);
      this.setAdvisoryStatus(data.advisoryStatus);
    },
```

(Note: `setAdvisoryStatus(null)` now explicitly clears — preserving the existing "reset to null" capability — while a null live frame from the container is filtered there before this is called.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard.store`
Expected: PASS — new LWW block plus all existing store tests (including "should set dashboard data", which uses `mockSummary`/`mockAdvisory` that both carry `updatedAt`, and the advisory-cycle-derivation tests that re-set the same `updatedAt`, which still apply under the `<` guard).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): LWW portfolioSummary/advisoryStatus setters; non-clobbering setDashboard"
```

---

## Task 8: Frontend container — apply live `portfolioSummary` + dashboard reconnect (caller #2)

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`
- Test: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `dashboard-container.component.spec.ts`, add these two tests inside the `describe('DashboardContainerComponent', …)` block (after the existing activity tests):

```typescript
  it('applies a live portfolioSummary frame to the store', async () => {
    const dashFrame$ = new Subject<{
      onDashboardUpdate: {
        advisoryStatus: import('../../../src/app/stores/dashboard.store').AdvisoryStatus | null;
        portfolioSummary: import('../../../src/app/stores/dashboard.store').PortfolioSummary | null;
      } | null;
    }>();
    mockService.subscribeToDashboardUpdates = jest.fn(() => dashFrame$);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });
    const setSpy = jest.spyOn(store, 'setPortfolioSummary');

    await component.ngOnInit();
    dashFrame$.next({
      onDashboardUpdate: {
        advisoryStatus: null,
        portfolioSummary: {
          totalValueCents: 999999, cashBalanceCents: 500000, positionCount: 3,
          updatedAt: '2026-06-05T12:00:00Z',
        },
      },
    });

    expect(mockService.subscribeToDashboardUpdates).toHaveBeenCalledWith('tenant-1');
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ totalValueCents: 999999 }));
    expect(store.portfolioSummary()?.totalValueCents).toBe(999999);
  });

  it('backfills via getDashboard when the dashboard subscription reconnects', async () => {
    const dashFrame$ = new Subject<{
      onDashboardUpdate: {
        advisoryStatus: import('../../../src/app/stores/dashboard.store').AdvisoryStatus | null;
        portfolioSummary: import('../../../src/app/stores/dashboard.store').PortfolioSummary | null;
      } | null;
    }>();
    mockService.subscribeToDashboardUpdates = jest.fn(() => dashFrame$);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });

    await component.ngOnInit();
    expect(mockService.getDashboard).toHaveBeenCalledTimes(1); // initial load

    dashFrame$.error(new Error('ws dropped'));                 // simulate reconnect
    await Promise.resolve();
    await Promise.resolve();

    expect(mockService.getDashboard).toHaveBeenCalledTimes(2); // backfill (force refresh)
    component.ngOnDestroy();                                    // cancel pending retry timer
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard-container`
Expected: FAIL — the live-portfolioSummary frame is dropped (container only reads `advisoryStatus`), and the dashboard channel has no reconnect backfill (`getDashboard` called once, not twice).

- [ ] **Step 3: Wire the dashboard channel through the helper with portfolioSummary + reconnect**

In `dashboard-container.component.ts`, add a dashboard reconnect backoff constant next to the existing one:

```typescript
const ACTIVITY_RECONNECT_BACKOFF_MS = 2_000;
const DASHBOARD_RECONNECT_BACKOFF_MS = 2_000;
```

Replace the `this.updateSubscription = ...` assignment (the dashboard branch of `subscribeToUpdates()`) with:

```typescript
    this.updateSubscription = subscribeThenReconcile({
      source: this.dashboardService.subscribeToDashboardUpdates(tenantId),
      onFrame: (data) => {
        const update = data?.onDashboardUpdate;
        if (update?.portfolioSummary) {
          this.store.setPortfolioSummary(update.portfolioSummary);
        }
        if (update?.advisoryStatus) {
          this.store.setAdvisoryStatus(update.advisoryStatus);
        }
      },
      onReconnect: () => this.backfillDashboard(),
      reconnectBackoffMs: DASHBOARD_RECONNECT_BACKOFF_MS,
    });
```

And add a `backfillDashboard()` method next to `backfillActivities()`:

```typescript
  private async backfillDashboard(): Promise<void> {
    try {
      const dashboard = await this.dashboardService.getDashboard(true); // force refresh
      this.store.setDashboard(dashboard); // guarded setters prevent clobbering a newer live frame
    } catch {
      // best-effort; the next reconnect or a manual reload recovers
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test dashboard-mfe -- --testPathPatterns=dashboard-container`
Expected: PASS — live portfolioSummary applied; dashboard reconnect triggers a forced `getDashboard`. Existing activity tests remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): live portfolioSummary KPI updates + dashboard reconnect via helper"
```

---

## Task 9: Regenerate the service card

**Files:**
- Modify: `services/investor/dashboard-bff/CLAUDE.md`

- [ ] **Step 1: Update the `## Handlers` entry for `dashboard-publisher.ts`**

In `CLAUDE.md`, change the `dashboard-publisher.ts` bullet to note the new broadcast surface:

```markdown
- dashboard-publisher.ts — DDB-stream-driven broadcaster: fires publishDashboardUpdate on **AdvisoryStatus** and **PortfolioSummary** row mutations, and publishActivityUpdate on Activity insert (keyed by __typename, falling back to sk). PortfolioSummary broadcasts on INSERT + on whenChanged ['totalValueCents','cashBalanceCents','positionCount'] (gated on the KPI values, not updatedAt). The shared publishDashboardUpdate mutation now carries both $advisoryStatus and $portfolioSummary (each optional; a broadcast sends only its own surface, the other resolves null and the client ignores it).
```

- [ ] **Step 2: Verify whole-project lint + test green**

Run: `pnpm nx run-many -t test,lint -p ui,dashboard-mfe,dashboard-bff`
Expected: PASS for all three projects.

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/CLAUDE.md
git commit --no-verify -m "docs(dashboard-bff): service card — publisher broadcasts PortfolioSummary"
```

---

## Self-Review notes (for the executor)

- **Type consistency:** the helper option object is `{ source, onFrame, onReconnect?, reconnectBackoffMs }` everywhere (Task 1 def, Task 2 Activity caller, Task 8 dashboard caller). The store setters are `setPortfolioSummary(incoming: PortfolioSummary | null)` and `setAdvisoryStatus(incoming: AdvisoryStatus | null)` (Task 7), called by name in Task 8. The broadcast field names (`totalValueCents`, `cashBalanceCents`, `positionCount`, `updatedAt`) match across schema (Task 3), resolver selection (Task 5 mutation), `mapImage` (Task 5), and `PORTFOLIO_SUMMARY_FIELDS`/`ON_DASHBOARD_UPDATE` (Task 6).
- **LWW guard uses `<` (strictly older dropped), not `<=`** — equal `updatedAt` still applies, so the existing store tests that re-set the same `updatedAt` stay green and there is no regression vs. the prior unguarded behaviour.
- **@aws_subscribe silent-drop rule:** the filter pivot is `tenantId`, already present on the `Dashboard` return type, the resolver response, and the publisher mutation selection — unchanged. Adding `portfolioSummary` to the selection keeps both surfaces deliverable.

## Validation gate (closing phase — handled by `/backlog-next`, not these tasks)

- Unit: Tasks 1/5/7/8 green via the per-file runs above; final `pnpm nx run-many -t test,lint -p ui,dashboard-mfe,dashboard-bff`.
- Deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff` (schema + resolver + publisher), then redeploy/serve the dashboard-mfe bundle as the deploy script handles MFE assets.
- E2E (deployed dev): the involved scenario is the deposit→dashboard-KPI live-update path. Run only that scenario, not the full suite. If no dedicated scenario asserts KPI live-update yet, file a QUEUED e2e follow-up (per the e2e-gaps-go-queued rule) rather than parking.
