# Activity feed subscribe-before-query + merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard Activity feed self-healing so a live `onActivityUpdate` frame is never lost to the mount→subscribe gap or a WS reconnect — closing the residual on `happy-path-pendingcount-wss-decrement-race`.

**Architecture:** Three client-side changes in `dashboard-mfe`, no schema/resolver/BFF change. (1) The store gains a single `mergeActivities` reducer that both the query and the live subscription feed, so neither source can clobber the other regardless of arrival order. (2) `ngOnInit` subscribes *before* taking the initial snapshot query. (3) On WS reconnect, re-query and merge. `getRecentActivity` already exists end-to-end.

**Tech Stack:** Angular 21, `@ngrx/signals` signal store, RxJS (`retry`, `timer`), Apollo + `aws-appsync-subscription-link`, Jest (`@nx/jest:jest`, jsdom).

**Spec:** `docs/superpowers/specs/2026-05-29-activity-feed-subscribe-before-query-design.md`

---

## File Structure

- **Modify** `apps/dashboard-mfe/src/app/stores/dashboard.store.ts` — add public `mergeActivities(incoming: ActivityEntry[])`; route `setActivities` and `addActivity` through it. One responsibility: the activity list is an append-log reduced from two sources.
- **Modify** `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts` — subscribe-before-query ordering in `ngOnInit`; add `backfillActivities()` + RxJS `retry` reconnect wiring on the activity subscription.
- **Test** `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts` — add merge order-independence + clobber-regression tests (existing `addActivity` tests are preserved as regression guards).
- **Test** `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts` — add subscribe-before-query and reconnect-backfill tests.

## Merge contract (pinned by existing tests — do not break)

The existing `DashboardStore.addActivity` tests (`dashboard.store.spec.ts:227-254`) require these exact semantics, so `mergeActivities` MUST be:
- **union = incoming-first**: `[...incoming, ...existing]`
- **dedupe by `activityId`, keep first occurrence** (so a live frame wins over an older snapshot copy of the same row)
- **stable sort by `createdAt` descending** (equal timestamps preserve insertion order — V8 sort is stable)
- **cap at 50** via `.slice(0, 50)`

Verification that this keeps the existing tests green:
- `prepends the new entry` → `merge([c])` into `[a,b]` (all equal ts) → `[c,a,b]` ✓
- `dedupes by activityId` → `merge([a])` into `[a]` → `[a]` ✓
- `caps at 50` → `merge([new])` into 50 → `[new, a0..a48]`, `a49` dropped ✓

---

### Task 1: Store — `mergeActivities` reducer (clobber repro)

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block at the end of `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts` (the `entry()` helper already exists at line 217, reuse it):

```typescript
describe('DashboardStore.mergeActivities', () => {
  let store: InstanceType<typeof DashboardStore>;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
    store.reset();
  });

  it('preserves a live row when a later query snapshot arrives (clobber regression)', () => {
    // Live frame lands first (subscription established before query returns)
    store.mergeActivities([entry('live', '2026-05-28T12:48:03Z')]);
    // Snapshot query returns WITHOUT the just-arrived live row (it committed after the read)
    store.mergeActivities([entry('snap', '2026-05-28T12:47:00Z')]);

    const ids = store.activities().map((a) => a.activityId);
    expect(ids).toContain('live'); // must NOT be clobbered
    expect(ids).toContain('snap');
    expect(ids).toEqual(['live', 'snap']); // newest createdAt first
  });

  it('is order-independent (query-then-live == live-then-query)', () => {
    store.mergeActivities([entry('a', '2026-05-28T10:00:00Z')]);
    store.mergeActivities([entry('b', '2026-05-28T11:00:00Z')]);
    const ab = store.activities().map((a) => a.activityId);

    store.reset();
    store.mergeActivities([entry('b', '2026-05-28T11:00:00Z')]);
    store.mergeActivities([entry('a', '2026-05-28T10:00:00Z')]);
    const ba = store.activities().map((a) => a.activityId);

    expect(ab).toEqual(ba);
    expect(ab).toEqual(['b', 'a']); // newest first regardless of arrival order
  });

  it('dedupes by activityId across merges', () => {
    store.mergeActivities([entry('x', '2026-05-28T10:00:00Z')]);
    store.mergeActivities([entry('x', '2026-05-28T10:00:00Z')]);
    expect(store.activities()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard.store.spec.ts`
Expected: FAIL — `mergeActivities` is not a function on the store.

- [ ] **Step 3: Add the `mergeActivities` method**

In `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`, inside the `withMethods((store) => ({ ... }))` block, add `mergeActivities` and route the existing two methods through it. Replace the current `setActivities` (line 128-130) and `addActivity` (line 131-136) with:

```typescript
    mergeActivities(incoming: ActivityEntry[]): void {
      const existing = store.activities();
      const seen = new Set<string>();
      const merged: ActivityEntry[] = [];
      for (const a of [...incoming, ...existing]) {   // incoming-first: live wins
        if (seen.has(a.activityId)) continue;          // dedupe, keep first
        seen.add(a.activityId);
        merged.push(a);
      }
      merged.sort((l, r) => (l.createdAt < r.createdAt ? 1 : l.createdAt > r.createdAt ? -1 : 0)); // stable desc
      patchState(store, { activities: merged.slice(0, 50) });
    },
    setActivities(activities: ActivityEntry[]): void {
      this.mergeActivities(activities);
    },
    addActivity(entry: ActivityEntry): void {
      this.mergeActivities([entry]);
    },
```

Note: `withMethods` methods can call sibling methods via `this` in `@ngrx/signals`. If the toolchain flags `this` usage, inline the merge body into a module-scoped `function mergeActivitiesList(existing, incoming)` pure helper and have all three call it — but try `this` first (matches existing `signalStore` usage in the repo).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard.store.spec.ts`
Expected: PASS — all new `mergeActivities` tests AND the pre-existing `addActivity` / `should set activities` tests stay green (the merge contract was designed to preserve them).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts
git commit -m "fix(dashboard-mfe): merge-reduce activities from both query and live sources

Single mergeActivities reducer (incoming-first, dedupe by activityId,
stable createdAt-desc, cap 50). setActivities + addActivity route through
it so a query snapshot can no longer clobber a live row. Regression test
for the clobber case. Part of happy-path-pendingcount-wss-decrement-race."
```

---

### Task 2: Container — subscribe before query

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts:162-165` (`ngOnInit`)
- Test: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('DashboardContainerComponent', ...)` in `dashboard-container.component.spec.ts`. This test proves a live frame arriving *during* the initial load survives — the mount→subscribe gap behaviour:

```typescript
  it('preserves a live activity frame that arrives during the initial load', async () => {
    const activityFrame$ = new Subject<{ onActivityUpdate: { activity: ActivityEntry } | null }>();
    mockService.subscribeToActivityUpdates = jest.fn(() => activityFrame$);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });

    // getRecentActivity resolves AFTER we emit a live frame — simulating the
    // snapshot read completing later than a concurrently-arriving live event.
    let resolveActivity!: (v: ActivityEntry[]) => void;
    mockService.getRecentActivity = jest.fn(
      () => new Promise<ActivityEntry[]>((res) => { resolveActivity = res; }),
    );

    const init = component.ngOnInit();           // subscribe happens first now
    activityFrame$.next({                          // live frame during the load
      onActivityUpdate: {
        activity: {
          activityId: 'live-during-load',
          activityType: 'DEPOSIT_DETECTED',
          description: 'Deposit detected: 1000 USD',
          createdAt: '2026-05-28T12:48:03Z',
          metadata: null,
        },
      },
    });
    resolveActivity([]);                           // snapshot returns empty (row not yet visible)
    await init;

    expect(store.activities().map((a) => a.activityId)).toContain('live-during-load');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard-container.component.spec.ts`
Expected: FAIL — today `loadDashboard()` runs before `subscribeToUpdates()`, so the live frame is dropped (no subscription yet) and the empty snapshot leaves `activities` empty.

- [ ] **Step 3: Reorder `ngOnInit`**

In `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`, change `ngOnInit` (currently lines 162-165) to subscribe first:

```typescript
  async ngOnInit(): Promise<void> {
    this.subscribeToUpdates();   // establish subscriptions BEFORE the snapshot query
    await this.loadDashboard();  // merge() absorbs any frame that arrived meanwhile
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard-container.component.spec.ts`
Expected: PASS — the live frame is merged in; the empty snapshot no longer clobbers it (depends on Task 1's merge). All pre-existing container tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit -m "fix(dashboard-mfe): subscribe before initial query in dashboard ngOnInit

Establish the WSS subscriptions before taking the getRecentActivity
snapshot so a live frame arriving during the load is merged, not lost to
the mount->subscribe gap. Part of happy-path-pendingcount-wss-decrement-race."
```

---

### Task 3: Container — reconnect re-query (backfill)

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts` (imports + `subscribeToUpdates` + new `backfillActivities`)
- Test: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the same container `describe`. On a subscription error (WS drop), the feed must re-query to recover any frames missed while disconnected:

```typescript
  it('backfills via getRecentActivity when the activity subscription reconnects', async () => {
    const activityFrame$ = new Subject<{ onActivityUpdate: { activity: ActivityEntry } | null }>();
    mockService.subscribeToActivityUpdates = jest.fn(() => activityFrame$);
    mockService.getRecentActivity = jest.fn().mockResolvedValue([]);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });

    await component.ngOnInit();
    expect(mockService.getRecentActivity).toHaveBeenCalledTimes(1); // initial load

    activityFrame$.error(new Error('ws dropped'));                  // simulate reconnect
    await Promise.resolve();                                        // flush the backfill microtask

    expect(mockService.getRecentActivity).toHaveBeenCalledTimes(2); // backfill on reconnect

    component.ngOnDestroy();                                        // cancel pending retry timer
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard-container.component.spec.ts`
Expected: FAIL — today the activity subscription has no `retry`/backfill; an error tears it down and `getRecentActivity` is never called again (stays at 1 call).

- [ ] **Step 3: Add retry + backfill**

In `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`:

Add to the rxjs import at the top (currently `import type { Subscription } from 'rxjs';`):

```typescript
import { retry, timer, type Subscription } from 'rxjs';
```

Add a module-scoped constant near the top of the file (after imports, before `@Component`):

```typescript
const ACTIVITY_RECONNECT_BACKOFF_MS = 2_000;
```

Replace the activity-subscription block inside `subscribeToUpdates()` (currently lines 187-196) with a `retry` that backfills on each reconnect:

```typescript
    this.activitySubscription = this.dashboardService
      .subscribeToActivityUpdates(tenantId)
      .pipe(
        retry({
          delay: () => {
            // WS dropped: re-query to recover rows missed while disconnected,
            // then re-subscribe after a short backoff.
            void this.backfillActivities();
            return timer(ACTIVITY_RECONNECT_BACKOFF_MS);
          },
        }),
      )
      .subscribe({
        next: (data) => {
          const activity = data?.onActivityUpdate?.activity;
          if (activity) {
            this.store.addActivity(activity);
          }
        },
      });
```

Add the `backfillActivities` method to the class (e.g. after `loadDashboard`):

```typescript
  private async backfillActivities(): Promise<void> {
    try {
      const activities = await this.dashboardService.getRecentActivity(20);
      this.store.mergeActivities(activities);
    } catch {
      // best-effort; the next reconnect or a manual reload recovers
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testFile=dashboard-container.component.spec.ts`
Expected: PASS — the error triggers the `retry` delay callback, which calls `backfillActivities()` → `getRecentActivity` a second time.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit -m "fix(dashboard-mfe): re-query activity feed on WSS reconnect

retry() on the activity subscription backfills via getRecentActivity +
mergeActivities whenever the WS drops, recovering rows missed while
disconnected. Closes the reconnect hole in
happy-path-pendingcount-wss-decrement-race."
```

---

### Task 4: Full suite + lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full dashboard-mfe unit suite**

Run: `pnpm nx run dashboard-mfe:test`
Expected: PASS — all spec files green (store, container, and the rest of the MFE).

- [ ] **Step 2: Run lint**

Run: `pnpm nx run dashboard-mfe:lint`
Expected: PASS — no new lint errors (watch for unused-import on `retry`/`timer` if a refactor changed usage).

- [ ] **Step 3: Run affected unit + lint as a final gate**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS across affected projects.

- [ ] **Step 4: Commit (only if Step 1-3 surfaced a fixup; otherwise skip)**

```bash
git add -A
git commit -m "chore(dashboard-mfe): lint/test fixups for activity subscribe-before-query"
```

---

### Task 5: E2E validation gate (cost-bearing — confirm before running)

**Files:** none (validation only). No code edits; this is the integration-level proof and the dossier `validation_gate`.

> **Cost note (per `feedback_e2e_cost_conscious.md`):** this runs the real Playwright e2e against deployed dev with real agents/LLMs. The dashboard-mfe change must be **deployed** first (`deploy-mfe`) because the e2e drives the deployed bundle. Surface the run/repeat count to the user via AskUserQuestion before executing.

- [ ] **Step 1: Deploy the dashboard-mfe bundle to dev**

Run: `pnpm nx run dashboard-mfe:deploy-mfe --prefix=dev`
Expected: build + `deploy-mfe.sh dev dashboard` complete; new bundle live.

- [ ] **Step 2: Reproduce-then-confirm the journey gate**

Run: `pnpm nx run nestfolio-e2e:e2e` (the `new-investor-happy-path` journey, Step 8 `waitForActivityByEventId` at `spec.ts:153`).
Expected: PASS. Per `apps/nestfolio-e2e/CLAUDE.md` anti-flake discipline, run it **twice consecutively** and require both green. Tee each run to `/tmp/pw-resid-run-{1,2}.log`.

  - If a run fails first-try, that IS the repro — capture `apps/nestfolio-e2e/test-results/.../error-context.md` and confirm the signature is the `waitForActivityByEventId` locator timeout (the hypothesis), not the old `>= 3 / 2` counter signature. If it's a *different* signature, STOP and revise the spec (systematic-debugging Phase 3).

- [ ] **Step 3: Ship the dossier**

Set `status: shipped` and fill `validation_gate:` in `docs/backlog/happy-path-pendingcount-wss-decrement-race.md` with: the two green e2e run logs, the dashboard-mfe deploy timestamp, the unit-suite result, and the commit range. Then:

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: `✓ all 8 rules pass`; `BACKLOG.md` regenerated.

```bash
git add docs/backlog/happy-path-pendingcount-wss-decrement-race.md docs/BACKLOG.md
git commit -m "docs(backlog): ship happy-path-pendingcount-wss-decrement-race (residual fixed)"
```

---

## Out of scope

- PortfolioSummary / PositionSnapshot live-push (separate dossiers — generalisation noted there).
- Surfacing a public connect signal from `GraphqlService` (rejected: `start_ack` is internal to `aws-appsync-subscription-link@4.0.3`).
- `onDashboardUpdate` (AdvisoryStatus) path — single-value last-write-wins, not affected.
- Schema / resolver / dashboard-bff changes — `getRecentActivity` already exists end-to-end.
