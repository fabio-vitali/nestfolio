# Dashboard InvestorSnapshot live-push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `InvestorSnapshot.executionMode` `sim→live` changes live to the mounted dashboard so the go-live execution-mode badge flips without a reload.

**Architecture:** Ride the existing shared `publishDashboardUpdate` / `onDashboardUpdate` channel (Approach A: scalar singleton surfaces share the Dashboard channel) — add `investorSnapshot` as a 3rd optional surface, register an `InvestorSnapshot` broadcaster in `dashboard-publisher.ts`, and merge the live frame into the store via a guarded LWW setter. Mirrors the shipped PortfolioSummary template.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` `broadcastFromStream`, AppSync JS resolvers (`@aws-appsync/utils`), Angular + `@ngrx/signals`, Jest.

Design: `docs/superpowers/specs/2026-06-16-investor-snapshot-live-push-design.md`

---

### Task 1: dashboard-bff — InvestorSnapshot broadcaster + resolver passthrough + schema

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/publish-dashboard-update.fn.js`
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`
- Test: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Update the now-wrong test + add failing InvestorSnapshot broadcast tests**

In `dashboard-publisher.test.ts`, the existing test `'skips records whose typename has no broadcast entry'` uses `__typename: 'InvestorSnapshot'` as its example of a NON-broadcast typename. Repoint it to a typename that still has no broadcaster:

```ts
  it('skips records whose typename has no broadcast entry', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'TimeTravelAvailability', __typename: 'TimeTravelAvailability', available: 1 },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
```

Then add a new `describe` block (anywhere inside the top-level `describe('dashboard-publisher', …)`):

```ts
  describe('InvestorSnapshot broadcast (shared Dashboard channel)', () => {
    const baseRow = {
      pk: 'T#tenant1', sk: 'InvestorSnapshot', __typename: 'InvestorSnapshot',
      goalType: 'GROWTH', riskLevel: '7', operatingMode: 'BALANCED',
      mandateLevel: 'STANDARD',
    };

    it('broadcasts publishDashboardUpdate with the investorSnapshot surface on the go-live flip (MODIFY)', async () => {
      await handler(streamEvent({
        eventName: 'MODIFY',
        oldImage: { ...baseRow, executionMode: 'simulation', __version: 1, updatedAt: '2026-06-16T00:00:00Z' },
        newImage: { ...baseRow, executionMode: 'live', __version: 2, updatedAt: '2026-06-16T12:00:00Z' },
      }), {} as never, () => {});
      expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
      const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
      expect(call.variables).toMatchObject({
        tenantId: 'tenant1',
        investorSnapshot: {
          executionMode: 'live', operatingMode: 'BALANCED', goalType: 'GROWTH',
          riskLevel: '7', mandateLevel: 'STANDARD', updatedAt: '2026-06-16T12:00:00Z',
        },
      });
    });

    it('broadcasts on INSERT (first InvestorSnapshot materialisation)', async () => {
      await handler(streamEvent({
        eventName: 'INSERT',
        newImage: { ...baseRow, executionMode: 'simulation', __version: 1, updatedAt: '2026-06-16T00:00:00Z' },
      }), {} as never, () => {});
      expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
      const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
      expect(call.variables.investorSnapshot).toMatchObject({ executionMode: 'simulation' });
    });

    it('skips a MODIFY when no display field changed (only updatedAt/__version bumped)', async () => {
      await handler(streamEvent({
        eventName: 'MODIFY',
        oldImage: { ...baseRow, executionMode: 'live', __version: 2, updatedAt: '2026-06-16T12:00:00Z' },
        newImage: { ...baseRow, executionMode: 'live', __version: 3, updatedAt: '2026-06-16T12:05:00Z' },
      }), {} as never, () => {});
      expect(postAppSyncMutation).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the test to verify the new tests fail**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns dashboard-publisher`
Expected: FAIL — the 3 new InvestorSnapshot tests fail (no broadcast fires); the repointed `TimeTravelAvailability` test passes.

- [ ] **Step 3: Implement the broadcaster + resolver + schema**

In `dashboard-publisher.ts`, extend the shared mutation string to carry + select the investorSnapshot surface:

```ts
const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput, $portfolioSummary: PortfolioSummaryInput, $investorSnapshot: InvestorSnapshotInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus, portfolioSummary: $portfolioSummary, investorSnapshot: $investorSnapshot) {
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
      investorSnapshot {
        goalType
        riskLevel
        operatingMode
        executionMode
        mandateLevel
        onboardedAt
        updatedAt
      }
    }
  }
`;
```

Add the `InvestorSnapshot` entry to the `broadcasts` map (after `PositionSnapshot`):

```ts
    InvestorSnapshot: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert default false — first materialisation also broadcasts (matches
      // AdvisoryStatus / PortfolioSummary). Gate MODIFY on the user-visible display
      // fields only (NOT updatedAt/__version, which change on every projectVersioned
      // write) so a go-live executionMode flip broadcasts but a no-op rewrite does not.
      whenChanged: ['executionMode', 'operatingMode', 'goalType', 'riskLevel', 'mandateLevel'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        const s = (k: string) => (item[k] != null ? String(item[k]) : null);
        return {
          tenantId,
          investorSnapshot: {
            goalType: s('goalType'),
            riskLevel: s('riskLevel'),
            operatingMode: s('operatingMode'),
            executionMode: s('executionMode'),
            mandateLevel: s('mandateLevel'),
            onboardedAt: s('onboardedAt'),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
```

In `publish-dashboard-update.fn.js`, replace the hardcoded `investorSnapshot: null` with a passthrough:

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

In `schema.graphql`, add the input type (next to `PortfolioSummaryInput`) and the mutation arg:

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

```graphql
  publishDashboardUpdate(
    tenantId: ID!
    advisoryStatus: AdvisoryStatusInput
    portfolioSummary: PortfolioSummaryInput
    investorSnapshot: InvestorSnapshotInput
  ): Dashboard!
    @aws_iam
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns dashboard-publisher`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql \
        services/investor/dashboard-bff/src/graphql/js-function/publish-dashboard-update.fn.js \
        services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts \
        services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit --no-verify -m "feat(dashboard-bff): broadcast InvestorSnapshot on the shared Dashboard channel"
```

---

### Task 2: dashboard-mfe store — guarded `setInvestorSnapshot` LWW setter

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`

- [ ] **Step 1: Add failing setter tests**

Inside the `describe('live last-write-wins setters', …)` block, add a `snapshotAt` helper next to `summaryAt`/`advisoryAt` and four tests:

```ts
    const snapshotAt = (updatedAt: string, executionMode: string): import('../../../src/app/stores/dashboard.store').InvestorSnapshot => ({
      goalType: 'GROWTH', riskLevel: '7', operatingMode: 'BALANCED',
      executionMode, mandateLevel: 'STANDARD', onboardedAt: '2026-06-01T00:00:00Z', updatedAt,
    });

    it('setInvestorSnapshot applies a newer frame (sim→live)', () => {
      store.setInvestorSnapshot(snapshotAt('2026-06-16T00:00:00Z', 'simulation'));
      store.setInvestorSnapshot(snapshotAt('2026-06-16T12:00:00Z', 'live'));
      expect(store.investorSnapshot()?.executionMode).toBe('live');
    });

    it('setInvestorSnapshot drops a strictly-older frame', () => {
      store.setInvestorSnapshot(snapshotAt('2026-06-16T12:00:00Z', 'live'));
      store.setInvestorSnapshot(snapshotAt('2026-06-16T00:00:00Z', 'simulation')); // older
      expect(store.investorSnapshot()?.executionMode).toBe('live');
    });

    it('setInvestorSnapshot never clobbers a live value with null', () => {
      store.setInvestorSnapshot(snapshotAt('2026-06-16T12:00:00Z', 'live'));
      store.setInvestorSnapshot(null);
      expect(store.investorSnapshot()?.executionMode).toBe('live');
    });

    it('setDashboard does not clobber a newer live investorSnapshot with an older snapshot', () => {
      store.setInvestorSnapshot(snapshotAt('2026-06-16T12:00:00Z', 'live')); // live frame
      store.setDashboard({
        portfolioSummary: null,
        advisoryStatus: null,
        investorSnapshot: snapshotAt('2026-06-16T00:00:00Z', 'simulation'), // older backfill snapshot
      });
      expect(store.investorSnapshot()?.executionMode).toBe('live');
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard.store`
Expected: FAIL — `store.setInvestorSnapshot is not a function`.

- [ ] **Step 3: Implement the guarded setter + route `setDashboard`**

In `dashboard.store.ts`, inside `withMethods`, add `setInvestorSnapshot` (after `setAdvisoryStatus`) and route `setDashboard` through it:

```ts
    setInvestorSnapshot(incoming: InvestorSnapshot | null): void {
      if (!incoming) return;
      const current = store.investorSnapshot();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { investorSnapshot: incoming });
    },
    setDashboard(data: DashboardData): void {
      // All three surfaces ride the shared Dashboard channel; route each through
      // its guarded LWW setter so a (re-query) snapshot can't clobber a newer live frame.
      this.setInvestorSnapshot(data.investorSnapshot);
      this.setPortfolioSummary(data.portfolioSummary);
      this.setAdvisoryStatus(data.advisoryStatus);
    },
```

(Delete the old `setDashboard` body — the direct `patchState(store, { investorSnapshot: data.investorSnapshot })` and the stale "investorSnapshot has no live channel" comment.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard.store`
Expected: PASS (the existing `setDashboard` null test still passes — `setInvestorSnapshot(null)` is a no-op so investorSnapshot stays null).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts \
        apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): guarded setInvestorSnapshot LWW setter on the store"
```

---

### Task 3: dashboard-mfe — subscription selection + service type + container onFrame

**Files:**
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`
- Modify: `apps/dashboard-mfe/src/app/services/dashboard.service.ts`
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`
- Test: `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts`

- [ ] **Step 1: Add a failing container test**

After the `'applies a live portfolioSummary frame to the store'` test, add:

```ts
  it('applies a live investorSnapshot frame to the store (go-live badge flip)', async () => {
    const dashFrame$ = new Subject<{
      onDashboardUpdate: {
        advisoryStatus: import('../../../src/app/stores/dashboard.store').AdvisoryStatus | null;
        portfolioSummary: import('../../../src/app/stores/dashboard.store').PortfolioSummary | null;
        investorSnapshot: import('../../../src/app/stores/dashboard.store').InvestorSnapshot | null;
      } | null;
    }>();
    mockService.subscribeToDashboardUpdates = jest.fn(() => dashFrame$);

    await component.ngOnInit();
    dashFrame$.next({
      onDashboardUpdate: {
        advisoryStatus: null,
        portfolioSummary: null,
        investorSnapshot: {
          goalType: 'GROWTH', riskLevel: '7', operatingMode: 'BALANCED',
          executionMode: 'live', mandateLevel: 'STANDARD',
          onboardedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-16T12:00:00Z',
        },
      },
    });

    expect(store.investorSnapshot()?.executionMode).toBe('live');
  });
```

(If `mockService`'s `subscribeToDashboardUpdates` default mock has a typed frame shape, widen it to include `investorSnapshot: null` so the file compiles — mirror the existing `portfolioSummary` test's local `Subject` typing.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard-container`
Expected: FAIL — `store.investorSnapshot()` is null (container ignores the surface) and/or a TS error on the unselected `investorSnapshot` frame field.

- [ ] **Step 3: Implement queries + service type + container onFrame**

In `dashboard-bff.queries.ts`, extend `ON_DASHBOARD_UPDATE`:

```ts
export const ON_DASHBOARD_UPDATE = `
  subscription OnDashboardUpdate($tenantId: ID!) {
    onDashboardUpdate(tenantId: $tenantId) {
      portfolioSummary {
        ...PortfolioSummaryFields
      }
      advisoryStatus {
        ...AdvisoryStatusFields
      }
      investorSnapshot {
        ...InvestorSnapshotFields
      }
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
  ${INVESTOR_SNAPSHOT_FIELDS}
`;
```

In `dashboard.service.ts`, add `InvestorSnapshot` to the type import from `../stores/dashboard.store` and extend the return type + docstring of `subscribeToDashboardUpdates`:

```ts
  /**
   * Live updates: dashboard-bff fires `publishDashboardUpdate` IAM-signed from a
   * DDB-stream-driven Lambda whenever the `AdvisoryStatus`, `PortfolioSummary`, or
   * `InvestorSnapshot` row mutates (each broadcast carries only its own surface;
   * the others are null). The subscription's `tenantId` argument matches the
   * mutation's `tenantId`, so AppSync only delivers frames for the current tenant.
   */
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

In `dashboard-container.component.ts`, add the third branch to the dashboard-channel `onFrame`:

```ts
      onFrame: (data) => {
        const update = data?.onDashboardUpdate;
        if (update?.portfolioSummary) {
          this.store.setPortfolioSummary(update.portfolioSummary);
        }
        if (update?.advisoryStatus) {
          this.store.setAdvisoryStatus(update.advisoryStatus);
        }
        if (update?.investorSnapshot) {
          this.store.setInvestorSnapshot(update.investorSnapshot);
        }
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run dashboard-mfe:test --testPathPatterns dashboard-container`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts \
        apps/dashboard-mfe/src/app/services/dashboard.service.ts \
        apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts \
        apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): subscribe investorSnapshot on the Dashboard channel + merge to store"
```

---

### Task 4: Affected verification (test + lint)

- [ ] **Step 1: Resolve the true-affected set and run test + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: PASS for `dashboard-bff`, `dashboard-mfe` (+ any others affected). Fix any lint/type fallout before proceeding.

- [ ] **Step 2: Commit any lint fixups (if needed)**

```bash
git add -A && git commit --no-verify -m "chore: lint/type fixups for investor-snapshot live-push"
```

---

### Task 5: Deploy + validation gate (Complex lane)

- [ ] **Step 1: Deploy dashboard-bff to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff 2>&1 | tee /tmp/deploy-dashboard-bff.log`
Expected: AppSync schema update `UPDATE_COMPLETE` (adds `InvestorSnapshotInput` + the mutation arg), `dashboard-mfe` bundle uploaded.

- [ ] **Step 2: Scoped integration**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED" || echo "no affected integration suites"
```
Expected: dashboard-bff integration green.

- [ ] **Step 3: e2e validation gate — the badge's only end-to-end proof**

Run the `new-investor-happy-path` Playwright journey against deployed dev, twice (anti-flake discipline):
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e --grep "new-investor-happy-path"
```
Expected: step 11 reaches `execution-mode-live` visible; PASS twice consecutively. If it fails-then-passes, pull CloudWatch from the failing window before continuing (flake = real failure).

---

## Self-Review notes

- **Spec coverage:** schema input+arg (T1), resolver passthrough (T1), broadcaster (T1), subscription selection (T3), service type (T3), store guarded setter (T2), container onFrame (T3), validation (T4–T5) — all design sections mapped.
- **Pre-existing-test breakage:** the `'skips records whose typename has no broadcast entry'` test used `InvestorSnapshot` and is repointed to `TimeTravelAvailability` in T1 Step 1 (else it would falsely fail once the broadcaster exists).
- **Type consistency:** `InvestorSnapshot` interface (store) reused across service type, container test, publisher payload, and store tests; `setInvestorSnapshot` named identically in store, container, and tests.
