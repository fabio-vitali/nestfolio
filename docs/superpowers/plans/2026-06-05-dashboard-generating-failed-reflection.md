# Dashboard Generating + Failed Reflection (WS-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface advisory decision-cycle **generating** and **failed** states on the `/dashboard` surface (consistent with `/advisory`), driven by extending advisory-bff's authoritative `AdvisoryStatus` aggregate — no new event, subscription, or adapter rule.

**Architecture:** advisory-bff's existing post-commit recompute (`advisory-status-projector`) derives `generatingCount` / `failedCount` / `oldestGeneratingAt` from `DecisionReadModel` rows in ONE query and writes them on the same atomic-`__version` `AdvisoryStatus` row. CDC carries them in `ADVISORY_STATUS_UPDATED`; dashboard-bff projects them onto its P3 row and exposes them via GraphQL + the `onDashboardUpdate` broadcast. dashboard-mfe renders a distinct, presentational cycle-status banner; the store owns the generating/failed derivation incl. a client-side staleness ceiling (parity with `/advisory`).

**Tech Stack:** TypeScript, AWS DynamoDB (lib-dynamodb), event-processor pipelines, AppSync JS resolvers + GraphQL, Angular 21 + @ngrx/signals signalStore, Jest, Playwright. Source spec: `docs/superpowers/specs/2026-06-05-dashboard-generating-failed-reflection-design.md`.

**Conventions:**
- Run all commands from the worktree root. Worktree commits need `--no-verify` (pre-commit hook can't run nx-affected in a worktree) — see `feedback_worktree_commit_no_verify`; verify each commit landed.
- Scope a single Jest file: `JEST_PATH='<regex>' pnpm nx run <project>:test`. Scope Playwright: `PLAYWRIGHT_GREP='<regex>' pnpm nx run nestfolio-e2e:e2e`.
- Deploy order at the end matters: **dashboard-bff + advisory-bff BEFORE investor-web** (the MFE's new fragment fields must already be served).

---

## File Structure

**advisory-bff (producer aggregate):**
- Modify: `services/advisory/advisory-bff/src/repositories/advisory.repository.ts` — replace `countInFlightDecisions` with `deriveAdvisoryAggregate`.
- Modify: `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts` — call the new method, write 4 fields.
- Test: `services/advisory/advisory-bff/test/unit/advisory.repository.test.ts`, `.../test/unit/handlers/advisory-status-projector.test.ts`.

**dashboard-bff (consumer projection + GraphQL + broadcast):**
- Modify: `services/investor/dashboard-bff/src/transforms/advisory-status.ts` — project 3 new fields.
- Modify: `services/investor/dashboard-bff/src/schema.graphql` — extend `AdvisoryStatus` + `AdvisoryStatusInput`.
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js` — map 3 new fields.
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` — selection + `mapImage` + `whenChanged`.
- Test: `.../test/unit/transforms/advisory-status.test.ts`, `.../test/unit/handlers/dashboard-publisher.test.ts`, `.../test/integration/dashboard-bff.integration.test.ts`.

**dashboard-mfe (store + component + container + queries + i18n):**
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts` — fragment fields.
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts` — interface, `now`/`setNow`, computeds, `STALE_CYCLE_MS`.
- Create: `apps/dashboard-mfe/src/app/dashboard/advisory-cycle-status.component.ts` — presentational banner.
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts` — render banner + tick.
- Modify: `libs/shell/src/i18n/assets/en-GB.json`, `libs/shell/src/i18n/assets/it-IT.json` — i18n keys.
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`, create `apps/dashboard-mfe/test/app/dashboard/advisory-cycle-status.component.spec.ts`.

**e2e:**
- Modify: `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts` — replace `injectDashboardBffTriggerEvent` with `injectAdvisoryStatusUpdated`.
- Create: `apps/nestfolio-e2e/src/fixtures/wait-for-dashboard-advisory.ts` — `waitForDashboardAdvisoryStatus`.
- Modify: `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts` — unskip + rewrite the 3rd test.

---

## Phase A — advisory-bff producer aggregate

### Task A1: Replace `countInFlightDecisions` with `deriveAdvisoryAggregate`

**Files:**
- Modify: `services/advisory/advisory-bff/src/repositories/advisory.repository.ts:104-132`
- Test: `services/advisory/advisory-bff/test/unit/advisory.repository.test.ts:266-291`

- [ ] **Step 1: Replace the repo test block** — swap the `countInFlightDecisions` describe (lines 266-291) for:

```ts
  describe('deriveAdvisoryAggregate', () => {
    it('derives the full aggregate in one query (counts + oldest generating)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { status: 'PENDING' },
          { status: 'AWAITING_CONFIRMATION' },
          { status: 'GENERATING', createdAt: '2026-06-05T10:00:00.000Z' },
          { status: 'GENERATING', createdAt: '2026-06-05T09:00:00.000Z' },
          { status: 'FAILED' },
        ],
        LastEvaluatedKey: undefined,
      });

      const agg = await repo.deriveAdvisoryAggregate('t1');

      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('Query');
      expect(call.input.IndexName).toBe('tenantId-index');
      expect(call.input.FilterExpression).toContain('#status IN');
      expect(call.input.ProjectionExpression).toContain('createdAt');
      expect(agg).toEqual({
        inFlightCount: 2, generatingCount: 2, failedCount: 1,
        oldestGeneratingAt: '2026-06-05T09:00:00.000Z',
      });
    });

    it('returns zeros and null when there are no non-terminal rows', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      expect(await repo.deriveAdvisoryAggregate('t1')).toEqual({
        inFlightCount: 0, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null,
      });
    });

    it('paginates across LastEvaluatedKey pages', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ status: 'GENERATING', createdAt: '2026-06-05T08:00:00.000Z' }], LastEvaluatedKey: { pk: 'x' } })
        .mockResolvedValueOnce({ Items: [{ status: 'PENDING' }], LastEvaluatedKey: undefined });

      const agg = await repo.deriveAdvisoryAggregate('t1');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'x' });
      expect(agg).toEqual({
        inFlightCount: 1, generatingCount: 1, failedCount: 0,
        oldestGeneratingAt: '2026-06-05T08:00:00.000Z',
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='advisory.repository' pnpm nx run advisory-bff:test`
Expected: FAIL — `repo.deriveAdvisoryAggregate is not a function`.

- [ ] **Step 3: Implement** — replace the `countInFlightDecisions` block (lines 104-132) of `advisory.repository.ts` with:

```ts
  /** Non-terminal statuses that participate in the AdvisoryStatus aggregate. */
  static readonly IN_FLIGHT_STATUSES = ['PENDING', 'AWAITING_CONFIRMATION'] as const;
  static readonly CYCLE_STATUSES = ['GENERATING', 'FAILED'] as const;
  static readonly AGGREGATE_STATUSES = [
    ...AdvisoryRepository.IN_FLIGHT_STATUSES,
    ...AdvisoryRepository.CYCLE_STATUSES,
  ] as const;

  /**
   * Derive the full AdvisoryStatus aggregate for a tenant in ONE paginated query.
   * Reads only `status`+`createdAt` of this tenant's non-terminal DecisionReadModel
   * rows and tallies every signal in a single pass. Replaces the prior COUNT-only
   * `countInFlightDecisions` — cleaner, one round-trip per page, and the single
   * reusable derivation surface.
   */
  readonly deriveAdvisoryAggregate = this.log('deriveAdvisoryAggregate', async (
    tenantId: string,
  ): Promise<{
    inFlightCount: number; generatingCount: number; failedCount: number;
    oldestGeneratingAt: string | null;
  }> => {
    const statuses = AdvisoryRepository.AGGREGATE_STATUSES;
    let inFlightCount = 0, generatingCount = 0, failedCount = 0;
    let oldestGeneratingAt: string | null = null;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tenantId AND #typ = :typename',
        FilterExpression: `#status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})`,
        ProjectionExpression: '#status, createdAt',
        ExpressionAttributeNames: { '#status': 'status', '#typ': '__typename' },
        ExpressionAttributeValues: {
          ':tenantId': tenantId, ':typename': 'DecisionReadModel',
          ...Object.fromEntries(statuses.map((s, i) => [`:s${i}`, s])),
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }));
      for (const row of result.Items ?? []) {
        const status = row['status'];
        if (status === 'PENDING' || status === 'AWAITING_CONFIRMATION') {
          inFlightCount++;
        } else if (status === 'FAILED') {
          failedCount++;
        } else if (status === 'GENERATING') {
          generatingCount++;
          const createdAt = typeof row['createdAt'] === 'string' ? row['createdAt'] : null;
          // ISO-8601 strings sort lexicographically, so `<` gives the earliest.
          if (createdAt && (oldestGeneratingAt === null || createdAt < oldestGeneratingAt)) {
            oldestGeneratingAt = createdAt;
          }
        }
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return { inFlightCount, generatingCount, failedCount, oldestGeneratingAt };
  });
```

(The old `static readonly IN_FLIGHT_STATUSES` line 105 is subsumed above — do not leave a duplicate.)

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='advisory.repository' pnpm nx run advisory-bff:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/repositories/advisory.repository.ts services/advisory/advisory-bff/test/unit/advisory.repository.test.ts
git commit --no-verify -m "feat(advisory-bff): deriveAdvisoryAggregate — single-query cycle signals"
git log --oneline -1
```

### Task A2: Projector writes the 4 aggregate fields

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts:37-71`
- Test: `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts`

- [ ] **Step 1: Update the projector test** — replace the mock wiring (lines 8-13) and the first assertion block (lines 37-65):

Replace lines 8-13 with:
```ts
const aggregateMock = jest.fn<Promise<{
  inFlightCount: number; generatingCount: number; failedCount: number; oldestGeneratingAt: string | null;
}>, [string]>();
jest.mock('../../../src/repositories/advisory.repository', () => ({
  AdvisoryRepository: jest.fn().mockImplementation(() => ({
    deriveAdvisoryAggregate: aggregateMock,
  })),
}));
```

In `beforeEach` (line 34) replace `countMock.mockReset();` with `aggregateMock.mockReset();`.

Replace the first `it(...)` (lines 37-65) with:
```ts
  it('recomputes AdvisoryStatus (4 fields) via an atomic __version self-increment', async () => {
    aggregateMock.mockResolvedValue({
      inFlightCount: 3, generatingCount: 1, failedCount: 0,
      oldestGeneratingAt: '2026-06-05T09:00:00.000Z',
    });

    await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));

    expect(aggregateMock).toHaveBeenCalledWith('t1');
    type UpdateInput = {
      Key?: Record<string, unknown>;
      UpdateExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, unknown>;
    };
    const call = (ddbMock.calls() as Array<{ args: [{ input: UpdateInput }] }>)
      .find((c) => c.args[0].input.Key?.sk === 'AdvisoryStatus');
    expect(call).toBeDefined();
    const input = call!.args[0].input;
    expect(input.Key!.pk).toBe('T#t1');
    const names = Object.values(input.ExpressionAttributeNames!);
    expect(names).toEqual(expect.arrayContaining([
      'inFlightCount', 'generatingCount', 'failedCount', 'oldestGeneratingAt', '__version',
    ]));
    const values = Object.values(input.ExpressionAttributeValues!);
    expect(values).toEqual(expect.arrayContaining([3, 1, 0, '2026-06-05T09:00:00.000Z']));
    // __version is bumped via an atomic ADD self-increment, NOT a Date.now() PutItem.
    expect(input.UpdateExpression).toMatch(/\bADD\b/);
  });
```

In the third `it(...)` (line 73-82) change `countMock.mockResolvedValue(1);` → `aggregateMock.mockResolvedValue({ inFlightCount: 1, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null });` and `expect(countMock).toHaveBeenCalledTimes(1);` → `expect(aggregateMock).toHaveBeenCalledTimes(1);`.

In the second `it(...)` (line 67-71) change `expect(countMock).not.toHaveBeenCalled();` → `expect(aggregateMock).not.toHaveBeenCalled();`.

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='advisory-status-projector' pnpm nx run advisory-bff:test`
Expected: FAIL — handler still calls `countInFlightDecisions`; `generatingCount`/etc. not written.

- [ ] **Step 3: Implement** — in `advisory-status-projector.ts`, replace lines 47-70 (the per-tenant loop body) with:

```ts
  for (const tenantId of tenants) {
    const { inFlightCount, generatingCount, failedCount, oldestGeneratingAt } =
      await repo.deriveAdvisoryAggregate(tenantId);
    // System-originated recompute: no end-user request context. RequestContext
    // sentinels are copied onto the row (harmless — keyed/queried by pk/tenantId).
    const ctx: EventContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId('system'),
      region: process.env.AWS_REGION ?? 'us-east-1',
      eventId: `recompute-${tenantId}-${Date.now()}`,
      eventType: 'ADVISORY_STATUS_RECOMPUTED',
      timestamp: new Date().toISOString(),
      serviceName: 'advisory-bff',
      record: {},
    };
    await executor.execute(
      update('AdvisoryStatus',
        { tenantId, inFlightCount, generatingCount, failedCount, oldestGeneratingAt },
        { add: { __version: 1 }, overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' } }),
      ctx,
    );
  }
```

Then update the file-header comment (lines 16-21): replace the sentence describing `inFlightCount` counting with: `// The aggregate (inFlightCount/generatingCount/failedCount/oldestGeneratingAt) is`
`// RECOMPUTED post-commit by deriveAdvisoryAggregate (one query over this tenant's`
`// non-terminal DecisionReadModel rows), then written with an atomic self-increment`
`// of __version via update(..., { add: { __version: 1 } }).`

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='advisory-status-projector' pnpm nx run advisory-bff:test`
Expected: PASS.

- [ ] **Step 5: Run the full advisory-bff unit suite + typecheck**

Run: `pnpm nx run advisory-bff:test && pnpm nx run advisory-bff:typecheck`
Expected: PASS (no remaining `countInFlightDecisions` references).

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts
git commit --no-verify -m "feat(advisory-bff): project generating/failed signals on AdvisoryStatus"
git log --oneline -1
```

---

## Phase B — dashboard-bff consumer projection + GraphQL + broadcast

### Task B1: Transform projects the 3 new fields

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/advisory-status.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts`

- [ ] **Step 1: Add failing tests** — append inside the `describe` in `advisory-status.test.ts` (before its closing `});` at line 32):

```ts
  it('projects the generating/failed cycle signals onto the P3 row', () => {
    expect(
      advisoryStatus(makeUow({
        tenantId: 't1', inFlightCount: 0, generatingCount: 1, failedCount: 0,
        oldestGeneratingAt: '2026-06-05T09:00:00.000Z', __version: 5,
      }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        {
          pendingDecisionsCount: 0, generatingCount: 1, failedCount: 0,
          oldestGeneratingAt: '2026-06-05T09:00:00.000Z',
        },
        { version: 5, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });

  it('defaults the new fields when an older producer omits them (rollout safety)', () => {
    expect(
      advisoryStatus(makeUow({ tenantId: 't1', inFlightCount: 2, __version: 7 }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        { pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null },
        { version: 7, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });
```

Also update the FIRST existing test (lines 17-27) expectation to include the defaulted fields (it now projects them):
```ts
      projectVersioned(
        'AdvisoryStatus',
        { pendingDecisionsCount: 3, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null },
        { version: 99, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='transforms/advisory-status' pnpm nx run dashboard-bff:test`
Expected: FAIL — transform doesn't emit the new fields.

- [ ] **Step 3: Implement** — replace the body of `advisory-status.ts` (lines 8-18) with:

```ts
export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<{
    tenantId: string; inFlightCount: number; __version: number;
    generatingCount?: number; failedCount?: number; oldestGeneratingAt?: string | null;
  }>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  if (typeof p.__version !== 'number') return undefined;
  return projectVersioned(
    'AdvisoryStatus',
    {
      pendingDecisionsCount: p.inFlightCount,
      generatingCount: p.generatingCount ?? 0,
      failedCount: p.failedCount ?? 0,
      oldestGeneratingAt: p.oldestGeneratingAt ?? null,
    },
    { version: p.__version, overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' } },
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='transforms/advisory-status' pnpm nx run dashboard-bff:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/advisory-status.ts services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts
git commit --no-verify -m "feat(dashboard-bff): project generating/failed onto AdvisoryStatus P3 row"
git log --oneline -1
```

### Task B2: GraphQL schema + getDashboard resolver + broadcaster

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql:29-32, 74-77`
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js:29-33`
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts:7-17, 43-60`
- Test: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Add failing publisher tests** — in `dashboard-publisher.test.ts`, update the first test's `toMatchObject` (lines 52-57) to assert the new fields, and add a cycle-start test. Replace lines 44-58 with:

```ts
  it('broadcasts publishDashboardUpdate with the full advisory aggregate (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 1, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T12:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      advisoryStatus: { pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0 },
    });
  });

  it('broadcasts when only generatingCount changes (cycle start, pending unchanged)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 0, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 0, generatingCount: 1, failedCount: 0, oldestGeneratingAt: '2026-05-01T00:05:00Z', updatedAt: '2026-05-01T00:05:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.advisoryStatus).toMatchObject({
      generatingCount: 1, oldestGeneratingAt: '2026-05-01T00:05:00Z',
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='dashboard-publisher' pnpm nx run dashboard-bff:test`
Expected: FAIL — `generatingCount` absent from broadcast; cycle-start MODIFY not broadcast (whenChanged only watches `pendingDecisionsCount`).

- [ ] **Step 3a: Schema** — in `schema.graphql`, replace `input AdvisoryStatusInput` (lines 29-32) and `type AdvisoryStatus` (lines 74-77) so BOTH read:

```graphql
input AdvisoryStatusInput {
  pendingDecisionsCount: Int!
  generatingCount: Int!
  failedCount: Int!
  oldestGeneratingAt: String
  updatedAt: String!
}
```

```graphql
type AdvisoryStatus @aws_cognito_user_pools @aws_iam {
  pendingDecisionsCount: Int!
  generatingCount: Int!
  failedCount: Int!
  oldestGeneratingAt: String
  updatedAt: String!
}
```

- [ ] **Step 3b: getDashboard resolver** — in `get-dashboard.fn.js`, replace the `advisoryStatus` map (lines 30-33) with:

```js
  const advisoryStatus = rawAs ? {
    pendingDecisionsCount: rawAs.pendingDecisionsCount || 0,
    generatingCount: rawAs.generatingCount || 0,
    failedCount: rawAs.failedCount || 0,
    oldestGeneratingAt: rawAs.oldestGeneratingAt || null,
    updatedAt: rawAs.updatedAt || util.time.nowISO8601(),
  } : null;
```

(`publish-dashboard-update.fn.js` passes `advisoryStatus` through wholesale — no change needed.)

- [ ] **Step 3c: Broadcaster** — in `dashboard-publisher.ts`, replace the `PUBLISH_DASHBOARD_UPDATE` advisoryStatus selection (lines 11-14) with:

```js
      advisoryStatus {
        pendingDecisionsCount
        generatingCount
        failedCount
        oldestGeneratingAt
        updatedAt
      }
```

and replace the `AdvisoryStatus` broadcast entry's `whenChanged` + `mapImage` (lines 49-59) with:

```js
      whenChanged: ['pendingDecisionsCount', 'generatingCount', 'failedCount', 'oldestGeneratingAt'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item['pendingDecisionsCount'] ?? 0),
            generatingCount: Number(item['generatingCount'] ?? 0),
            failedCount: Number(item['failedCount'] ?? 0),
            oldestGeneratingAt: item['oldestGeneratingAt'] != null ? String(item['oldestGeneratingAt']) : null,
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='dashboard-publisher' pnpm nx run dashboard-bff:test`
Expected: PASS.

- [ ] **Step 5: Run full dashboard-bff unit suite + typecheck**

Run: `pnpm nx run dashboard-bff:test && pnpm nx run dashboard-bff:typecheck`
Expected: PASS (read-model-ownership type-test still green — AdvisoryStatus stays P3).

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit --no-verify -m "feat(dashboard-bff): expose+broadcast generating/failed on AdvisoryStatus"
git log --oneline -1
```

### Task B3: Integration assertion (deploy-gated — runs in Phase E)

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts:758-778`

- [ ] **Step 1: Extend the first AdvisoryStatus integration test** — replace the test body (lines 758-778) with:

```ts
    it('projects the announced aggregate (counts + oldest generating)', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ADVISORY_STATUS_UPDATED',
        detail: {
          tenantId: ctx.tenantId, inFlightCount: 3, generatingCount: 1, failedCount: 0,
          oldestGeneratingAt: '2026-06-05T09:00:00.000Z', __version: 1_000,
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
        predicate: (i) => i['__version'] === 1_000,
      });

      expect(item['__typename']).toBe('AdvisoryStatus');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['pendingDecisionsCount']).toBe(3);
      expect(item['generatingCount']).toBe(1);
      expect(item['failedCount']).toBe(0);
      expect(item['oldestGeneratingAt']).toBe('2026-06-05T09:00:00.000Z');
      expect(item['__version']).toBe(1_000);
    }, 120_000);
```

- [ ] **Step 2: Commit (runs in Phase E after deploy)**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit --no-verify -m "test(dashboard-bff): integration asserts generating/failed projection"
git log --oneline -1
```

---

## Phase C — dashboard-mfe store + component + container + i18n

### Task C1: Store — interface, `now`/`setNow`, derivation computeds

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`
- Test: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts`

- [ ] **Step 1: Add failing store tests** — in `dashboard.store.spec.ts`, update `mockAdvisory` (lines 31-34) to the new shape and add a derivation describe. Replace lines 31-34 with:

```ts
  const mockAdvisory: AdvisoryStatus = {
    pendingDecisionsCount: 3,
    generatingCount: 0,
    failedCount: 0,
    oldestGeneratingAt: null,
    updatedAt: '2026-03-01T00:00:00Z',
  };
```

Add before the final `});` of the first `describe('DashboardStore', …)` (line 211):

```ts
  describe('advisory cycle derivation', () => {
    const FIXED_NOW = Date.parse('2026-06-05T12:00:00.000Z');
    const advisory = (over: Partial<AdvisoryStatus>): AdvisoryStatus => ({
      pendingDecisionsCount: 0, generatingCount: 0, failedCount: 0,
      oldestGeneratingAt: null, updatedAt: '2026-06-05T12:00:00Z', ...over,
    });

    it('advisoryGenerating is true for a fresh GENERATING row', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ generatingCount: 1, oldestGeneratingAt: '2026-06-05T11:59:00.000Z' }));
      expect(store.advisoryGenerating()).toBe(true);
      expect(store.advisoryFailed()).toBe(false);
    });

    it('advisoryFailed is true for a FAILED row with nothing pending/generating', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ failedCount: 1 }));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(true);
    });

    it('a stale GENERATING row (older than the ceiling) becomes failed', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ generatingCount: 1, oldestGeneratingAt: '2026-06-05T11:50:00.000Z' }));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(true);
    });

    it('pending decisions suppress the failed banner', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ pendingDecisionsCount: 2, failedCount: 1 }));
      expect(store.advisoryFailed()).toBe(false);
      expect(store.advisoryGenerating()).toBe(false);
    });

    it('neither banner when idle', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({}));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='dashboard.store' pnpm nx run dashboard-mfe:test`
Expected: FAIL — `setNow` / `advisoryGenerating` / `advisoryFailed` undefined; `AdvisoryStatus` missing fields.

- [ ] **Step 3a: Extend the `AdvisoryStatus` interface** — in `dashboard.store.ts`, replace (lines 38-41):

```ts
export interface AdvisoryStatus {
  pendingDecisionsCount: number;
  generatingCount: number;
  failedCount: number;
  oldestGeneratingAt: string | null;
  updatedAt: string;
}
```

- [ ] **Step 3b: Add the staleness helper + constant** — after the imports (line 9), add:

```ts
// Keep in sync with advisory-mfe decision-list.component.ts STALE_CYCLE_MS.
// A GENERATING signal older than this (with no transition) renders as failed —
// covers uncatchable States.Runtime failures that emit no DECISION_CYCLE_FAILED.
// TODO(extract-shared-advisory-cycle-state-helper): fold into @nestfolio/ui.
const STALE_CYCLE_MS = 6 * 60 * 1000;

function generatingFresh(s: AdvisoryStatus | null, now: number): boolean {
  return !!s && s.generatingCount > 0 && !!s.oldestGeneratingAt
    && now - Date.parse(s.oldestGeneratingAt) < STALE_CYCLE_MS;
}
```

- [ ] **Step 3c: Add `now` to state + initial** — in `DashboardState` (lines 67-74) add `now: number;`; in `initialState` (lines 76-83) add `now: Date.now(),`.

- [ ] **Step 3d: Add computeds** — inside `withComputed((store) => ({ … }))` (after `hasAdvisoryAlerts`, line 106), add:

```ts
    advisoryGenerating: computed(() => generatingFresh(store.advisoryStatus(), store.now())),
    advisoryFailed: computed(() => {
      const s = store.advisoryStatus();
      if (!s || (s.pendingDecisionsCount ?? 0) > 0) return false;
      if (generatingFresh(s, store.now())) return false;
      return s.failedCount > 0 || s.generatingCount > 0;
    }),
```

- [ ] **Step 3e: Add `setNow` method** — inside `withMethods((store) => ({ … }))` (after `setAdvisoryStatus`, line 121), add:

```ts
    setNow(now: number): void {
      patchState(store, { now });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='dashboard.store' pnpm nx run dashboard-mfe:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): store advisory cycle derivation + staleness"
git log --oneline -1
```

### Task C2: Presentational `advisory-cycle-status` component

**Files:**
- Create: `apps/dashboard-mfe/src/app/dashboard/advisory-cycle-status.component.ts`
- Test: `apps/dashboard-mfe/test/app/dashboard/advisory-cycle-status.component.spec.ts`

- [ ] **Step 1: Write the failing test** — create the spec:

```ts
import { ComponentFixture } from '@angular/core/testing';
import { AdvisoryCycleStatusComponent } from '../../../src/app/dashboard/advisory-cycle-status.component';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shell/testing';

describe('AdvisoryCycleStatusComponent', () => {
  let component: AdvisoryCycleStatusComponent;
  let fixture: ComponentFixture<AdvisoryCycleStatusComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(AdvisoryCycleStatusComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
    });
    component = fixture.componentInstance;
  });

  const el = (testid: string) =>
    fixture.nativeElement.querySelector(`[data-testid=${testid}]`);

  it('renders nothing when idle', () => {
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });

  it('renders the generating banner when generating', () => {
    component.generating = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).not.toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });

  it('renders the failed banner when failed (and not generating)', () => {
    component.failed = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-failed')).not.toBeNull();
    expect(el('dashboard-advisory-generating')).toBeNull();
  });

  it('generating takes precedence over failed', () => {
    component.generating = true;
    component.failed = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).not.toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JEST_PATH='advisory-cycle-status' pnpm nx run dashboard-mfe:test`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Implement the component**:

```ts
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/shell/i18n';

@Component({
  selector: 'app-advisory-cycle-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (generating) {
      <div class="cycle-banner generating" data-testid="dashboard-advisory-generating">
        <span class="pi pi-spin pi-spinner"></span>
        <span class="cycle-text">{{ i18n.t('dashboard.advisory.generatingTitle') }}</span>
      </div>
    } @else if (failed) {
      <div class="cycle-banner failed" data-testid="dashboard-advisory-failed">
        <span class="pi pi-exclamation-triangle"></span>
        <span class="cycle-text">
          {{ i18n.t('dashboard.advisory.failedTitle') }} — {{ i18n.t('dashboard.advisory.failedHint') }}
        </span>
      </div>
    }
  `,
  styles: [`
    .cycle-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .cycle-banner.generating {
      background: var(--p-surface-50, #f8f9fa);
      border: 1px dashed var(--p-primary-300, #93c5fd);
      color: var(--p-surface-700, #374151);
    }
    .cycle-banner.generating .pi-spinner { color: var(--p-primary-500, #3b82f6); }
    .cycle-banner.failed {
      background: var(--orange-50, #fff7ed);
      border: 1px solid var(--orange-200, #fed7aa);
      color: var(--nf-text-primary, #212529);
    }
    .cycle-banner.failed .pi-exclamation-triangle { color: var(--orange-500, #f97316); }
  `],
})
export class AdvisoryCycleStatusComponent {
  readonly i18n = inject(I18nService);
  @Input() generating = false;
  @Input() failed = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JEST_PATH='advisory-cycle-status' pnpm nx run dashboard-mfe:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/advisory-cycle-status.component.ts apps/dashboard-mfe/test/app/dashboard/advisory-cycle-status.component.spec.ts
git commit --no-verify -m "feat(dashboard-mfe): advisory-cycle-status presentational banner"
git log --oneline -1
```

### Task C3: Query fragment + container wiring + i18n

**Files:**
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts:36-41`
- Modify: `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts`
- Modify: `libs/shell/src/i18n/assets/en-GB.json:70-75`, `libs/shell/src/i18n/assets/it-IT.json:70-75`

- [ ] **Step 1: Extend the query fragment** — in `dashboard-bff.queries.ts` replace the `ADVISORY_STATUS_FIELDS` fragment (lines 36-41) with:

```ts
const ADVISORY_STATUS_FIELDS = `
  fragment AdvisoryStatusFields on AdvisoryStatus {
    pendingDecisionsCount
    generatingCount
    failedCount
    oldestGeneratingAt
    updatedAt
  }
`;
```

- [ ] **Step 2: i18n — en-GB** — in `libs/shell/src/i18n/assets/en-GB.json`, replace the `dashboard.advisory` block (lines 70-75) with:

```json
    "advisory": {
      "pendingCount": "Pending Decisions",
      "lastRecommendation": "Last Recommendation",
      "lastStatus": "Last Status",
      "viewAll": "View All Advisory",
      "generatingTitle": "Generating your advice…",
      "failedTitle": "Advice generation failed",
      "failedHint": "Please try again shortly."
    },
```

- [ ] **Step 3: i18n — it-IT** — in `libs/shell/src/i18n/assets/it-IT.json`, replace the `dashboard.advisory` block (lines 70-75) with:

```json
    "advisory": {
      "pendingCount": "Decisioni in Attesa",
      "lastRecommendation": "Ultima Raccomandazione",
      "lastStatus": "Ultimo Stato",
      "viewAll": "Vedi Tutta la Consulenza",
      "generatingTitle": "Generazione della consulenza…",
      "failedTitle": "Generazione della consulenza non riuscita",
      "failedHint": "Riprova tra poco."
    },
```

- [ ] **Step 4: Container — render banner + drive the `now` tick** — in `dashboard-container.component.ts`:

(a) Add the import (after line 16):
```ts
import { AdvisoryCycleStatusComponent } from './advisory-cycle-status.component';
```
(b) Add `AdvisoryCycleStatusComponent` to the `imports` array (after `AdvisoryAlertBarComponent`, line 31).
(c) Render the banner directly under the KPI row — insert after the closing `</div>` of `.kpi-row` (after line 57, before `<div class="main-content">`):
```html
        <app-advisory-cycle-status
          [generating]="store.advisoryGenerating()"
          [failed]="store.advisoryFailed()"
        />
```
(d) Add a tick field (after line 162, `private activitySubscription`):
```ts
  private nowTickHandle: ReturnType<typeof setInterval> | null = null;
```
(e) In `ngOnInit` (after line 165 `this.subscribeToUpdates();`) add:
```ts
    this.store.setNow(Date.now());
    this.nowTickHandle = setInterval(() => this.store.setNow(Date.now()), 30_000);
```
(f) In `ngOnDestroy` (after line 173) add:
```ts
    if (this.nowTickHandle !== null) {
      clearInterval(this.nowTickHandle);
      this.nowTickHandle = null;
    }
```

- [ ] **Step 5: Run dashboard-mfe unit suite + lint**

Run: `pnpm nx run dashboard-mfe:test && pnpm nx run dashboard-mfe:lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts libs/shell/src/i18n/assets/en-GB.json libs/shell/src/i18n/assets/it-IT.json
git commit --no-verify -m "feat(dashboard-mfe): render advisory cycle banner + query fields + i18n"
git log --oneline -1
```

---

## Phase D — e2e (Playwright) retarget

### Task D1: Inject + wait fixtures

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:135-151`
- Create: `apps/nestfolio-e2e/src/fixtures/wait-for-dashboard-advisory.ts`

- [ ] **Step 1: Replace `injectDashboardBffTriggerEvent`** — in `inject-advisory-update.ts`, delete the `injectDashboardBffTriggerEvent` function (lines 135-151) and add:

```ts
/**
 * Emit ADVISORY_STATUS_UPDATED on the investor bus, scoped to dashboard-bff (the
 * same event advisory-bff's aggregate announces, forwarded by investor-adpt). This
 * drives dashboard-bff's P3 projection directly — the dashboard generating/failed +
 * alert-bar UI under test. `pendingDecisionsCount` maps to the producer's
 * `inFlightCount` subject field; `version` must strictly increase per tenant.
 */
export async function injectAdvisoryStatusUpdated(
  ctx: TestContext,
  tenant: FreshTenant,
  fields: {
    pendingDecisionsCount?: number;
    generatingCount?: number;
    failedCount?: number;
    oldestGeneratingAt?: string | null;
    version: number;
  },
): Promise<{ eventId: string }> {
  return putScopedEvent(
    ctx,
    'investor',
    'integration-test:dashboard-bff',
    'ADVISORY_STATUS_UPDATED',
    {
      tenantId: tenant.tenantId,
      inFlightCount: fields.pendingDecisionsCount ?? 0,
      generatingCount: fields.generatingCount ?? 0,
      failedCount: fields.failedCount ?? 0,
      oldestGeneratingAt: fields.oldestGeneratingAt ?? null,
      __version: fields.version,
    },
    advisoryContext(ctx, tenant),
  );
}
```

- [ ] **Step 2: Create the wait helper** — `wait-for-dashboard-advisory.ts`:

```ts
import { bffClient, waitForGraphQL } from '@nestfolio/e2e-feature-tests';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

const GET_DASHBOARD = `
  query GetDashboard {
    getDashboard {
      advisoryStatus {
        pendingDecisionsCount
        generatingCount
        failedCount
        oldestGeneratingAt
      }
    }
  }
`;

interface GetDashboardResult {
  getDashboard: {
    advisoryStatus: {
      pendingDecisionsCount: number;
      generatingCount: number;
      failedCount: number;
      oldestGeneratingAt: string | null;
    } | null;
  };
}

/**
 * Block until dashboard-bff has materialised an AdvisoryStatus row satisfying
 * `predicate`. Polls the same getDashboard query the production dashboard fires
 * (Cognito-authed AppSync) — observable user-side behaviour, eliminating the
 * EB→SQS→Lambda race against the component's on-mount query.
 */
export async function waitForDashboardAdvisoryStatus(
  ctx: TestContext,
  tenant: FreshTenant,
  predicate: (s: NonNullable<GetDashboardResult['getDashboard']['advisoryStatus']>) => boolean,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const dashboard = bffClient(ctx, tenant).dashboard;
  await waitForGraphQL<GetDashboardResult>(
    dashboard,
    GET_DASHBOARD,
    {},
    (result) => {
      const s = result.getDashboard?.advisoryStatus;
      return !!s && predicate(s);
    },
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
  );
}
```

- [ ] **Step 3: Verify no dangling references to the removed injector**

Run: `grep -rn "injectDashboardBffTriggerEvent" apps/nestfolio-e2e/src`
Expected: no matches.

- [ ] **Step 4: Lint**

Run: `pnpm nx run nestfolio-e2e:lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts apps/nestfolio-e2e/src/fixtures/wait-for-dashboard-advisory.ts
git commit --no-verify -m "test(e2e): dashboard advisory-status inject + wait fixtures"
git log --oneline -1
```

### Task D2: Unskip + rewrite the dashboard scenario

**Files:**
- Modify: `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts:77-85`

- [ ] **Step 1: Replace the skipped 3rd test** (lines 77-85) with a real scenario, and add the imports. Update the import block (lines 3-8) to also import the new fixtures:

```ts
import {
  injectDecisionCycleStarted,
  injectDecisionCycleFailed,
  injectDecisionPacketCreated,
  injectAdvisoryStatusUpdated,
} from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';
import { waitForDashboardAdvisoryStatus } from '../fixtures/wait-for-dashboard-advisory';
```

Replace the `test.skip(...)` (lines 77-85) with:

```ts
  /**
   * Dashboard reflects the cycle: a fresh GENERATING aggregate shows the dashboard
   * generating banner (deterministic on-mount query after the row exists); a FAILED
   * announcement flips it to the failed banner live via onDashboardUpdate; a
   * pendingDecisionsCount announcement then shows the "ready to review" alert bar
   * (the reachable path the removed accumulate test was rewritten onto).
   * UI-only assertions (per the e2e charter); versions strictly increase.
   */
  test('dashboard reflects generating, failed, then ready-to-review', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    // GENERATING: project the row first, then load so the on-mount query returns it.
    await injectAdvisoryStatusUpdated(ctx, tenant, {
      generatingCount: 1,
      oldestGeneratingAt: new Date().toISOString(),
      version: 1,
    });
    await waitForDashboardAdvisoryStatus(ctx, tenant, (s) => s.generatingCount >= 1, {
      timeoutMs: 60_000,
    });

    await onboardedPage.goto('/dashboard');
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-generating]'),
    ).toBeVisible({ timeout: 15_000 });

    // FAILED arrives while mounted → delivered live by the WSS subscription.
    await injectAdvisoryStatusUpdated(ctx, tenant, { failedCount: 1, version: 2 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-failed]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-generating]'),
    ).toBeHidden();

    // Decisions become ready to review → the alert bar (failed banner clears).
    await injectAdvisoryStatusUpdated(ctx, tenant, { pendingDecisionsCount: 2, version: 3 });
    await expect(
      onboardedPage.locator('[data-testid=advisory-alert-bar]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-failed]'),
    ).toBeHidden();
  });
```

- [ ] **Step 2: Lint + typecheck the e2e app**

Run: `pnpm nx run nestfolio-e2e:lint`
Expected: PASS (no unused imports; `waitForAdvisoryDecisionRow` still used by the other tests).

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
git commit --no-verify -m "test(e2e): dashboard generating/failed/ready scenario (retarget)"
git log --oneline -1
```

---

## Phase E — validate, deploy, ship

### Task E1: Local gate

- [ ] **Step 1: nx affected test + lint**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS across advisory-bff, dashboard-bff, dashboard-mfe, shell, nestfolio-e2e.

- [ ] **Step 2: typecheck both bffs**

Run: `pnpm nx run advisory-bff:typecheck && pnpm nx run dashboard-bff:typecheck`
Expected: PASS (read-model-ownership type-tests green).

### Task E2: Deploy + integration + scoped Playwright (dev sandbox)

- [ ] **Step 1: Deploy bffs first, then the MFE host** (order matters — MFE fragment fields must already be served):

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,dashboard-bff 2>&1 | tee /tmp/ws4-bff-deploy.log
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web 2>&1 | tee /tmp/ws4-web-deploy.log
```
Expected: both deploys succeed (grep the logs for `✅`/stack-update-complete).

- [ ] **Step 2: dashboard-bff integration (B3) against deployed dev**

Run: `pnpm nx run dashboard-bff:test-integration`
Expected: PASS — `projects the announced aggregate (counts + oldest generating)` green.

- [ ] **Step 3: Scoped Playwright — twice consecutively (anti-flake charter)**

Run: `PLAYWRIGHT_GREP='generating, failed, then ready-to-review' pnpm nx run nestfolio-e2e:e2e`
Then run the same command a SECOND time.
Expected: PASS both runs. If it fails-then-passes, pull CloudWatch from the failing window before continuing and run a third confirmation pass — a flake is a real failure (`feedback_flake_means_broken`).

- [ ] **Step 4: Commit the integration test (B3) if not already**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit --no-verify -m "test(dashboard-bff): integration asserts generating/failed projection" || echo "already committed"
```

### Task E3: Regenerate derived docs

- [ ] **Step 1: Regenerate the two service cards** (they reference `countInFlightDecisions` / the advisory-status transform shape, now changed):

Run: `pnpm nx run advisory-bff:test >/dev/null` then invoke the `audit-service advisory-bff` and `audit-service dashboard-bff` skills to regenerate `services/advisory/advisory-bff/CLAUDE.md` and `services/investor/dashboard-bff/CLAUDE.md`. Confirm the advisory card no longer mentions `countInFlightDecisions` and the dashboard card lists the new `AdvisoryStatus` fields.

- [ ] **Step 2: Commit regen**

```bash
git add services/advisory/advisory-bff/CLAUDE.md services/investor/dashboard-bff/CLAUDE.md
git commit --no-verify -m "docs(advisory-ux): regen service cards for WS-4 aggregate fields"
git log --oneline -1
```

> **Ship (handled by /backlog-next closing phase):** set `docs/backlog/dashboard-generating-failed-reflection.md` → `status: shipped` with the `validation_gate` (commit SHAs + integ + 2× Playwright evidence), `backlog-lint --fix`, then `finishing-a-development-branch` for merge + worktree cleanup.

---

## Self-Review

**Spec coverage** (against `2026-06-05-dashboard-generating-failed-reflection-design.md`):
- §3.1 repo `deriveAdvisoryAggregate` → Task A1. §3.2 projector → Task A2. §3.3 no Egress change → confirmed (CDC serialises the row; not touched).
- §4.1 transform → B1. §4.2 schema → B2 (3a). §4.3 resolvers + broadcaster → B2 (3b/3c).
- §5.1 fragment → C3. §5.2 store derivation + `now`/`setNow` → C1. §5.3 component → C2; container render + tick → C3. §5.4 staleness constant + parking note → C1 (Step 3b). §5.5 i18n → C3.
- §6 e2e inject/wait fixtures → D1; unskip + rewrite → D2.
- §7.1 advisory-bff unit → A1/A2. §7.2 dashboard-bff transform/type-test/integration → B1/B2/B3. §7.3 component unit → C2; store derivation → C1.
- §8 validation gate → E1/E2.

**Placeholder scan:** none — every code step shows full content; the only `TODO(...)` is an intentional in-code pointer to the filed parking item.

**Type consistency:** `deriveAdvisoryAggregate` returns `{ inFlightCount, generatingCount, failedCount, oldestGeneratingAt }` everywhere (A1 repo, A2 projector + mock, B-side reads the same names on the subject). `AdvisoryStatus` carries `generatingCount`/`failedCount`/`oldestGeneratingAt` consistently across schema, input, resolver, publisher, store interface, GraphQL fragment, and the e2e subject. `setNow`/`advisoryGenerating`/`advisoryFailed`/`generatingFresh`/`STALE_CYCLE_MS` match between store and tests. Testids `dashboard-advisory-generating` / `dashboard-advisory-failed` / `advisory-alert-bar` match between component, container, and e2e.
