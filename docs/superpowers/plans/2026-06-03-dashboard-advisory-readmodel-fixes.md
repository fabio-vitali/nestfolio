# dashboard-bff + advisory read-model fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four BFF read-model residuals — `quantity:0` ghost holdings, AdvisoryStatus dead code + structural-zero fields, three w3 hardening nits, and the shared `TableEntry.timestamp` type gap — with no event-contract or producer-behavior change.

**Architecture:** Read-side resolver filters + one write-side count fix (ghost holdings); dead-code/field deletions across dashboard-bff backend + dashboard-mfe (AdvisoryStatus); localized handler/transform hardening (version source, taskToken cleanup, union narrowing, strict drop); one additive optional field on the shared `TableEntry` (clears 8 tsc errors across two services). All work is in the `worktree-dashboard-advisory-readmodel-fixes` worktree.

**Tech Stack:** TypeScript, AWS Lambda + DynamoDB Streams, `@nestfolio/event-processor` (intents/executor), AppSync JS resolvers (`*.fn.js`), Angular (dashboard-mfe), Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-06-03-dashboard-advisory-readmodel-fixes-design.md`

**Conventions:** Tests live in `test/unit/**` (services). Run a single Jest file with
`pnpm nx test <project> -- <file>` (or the service's documented runner). Commit after every green step.

---

## Task 1: Part D — add `timestamp?` to shared `TableEntry`

Clears all 8 `TS2353 'timestamp' does not exist in type 'TableEntry'` errors (advisory-bff 6, ledger-ctrl 2). `timestamp` is the SK of the system-wide `typename-timestamp-index` GSI and `getTime()` returns `string`. Verified safe: zero `TableEntry<…>` generic usages exist, so the additive optional field cannot conflict.

**Files:**
- Modify: `libs/event-processor/src/platform/table.ts`
- Modify: `services/advisory/advisory-bff/project.json` (typecheck target)

- [ ] **Step 1: Confirm the failing typecheck (baseline)**

Run: `pnpm exec tsc --noEmit -p services/advisory/advisory-bff/tsconfig.spec.json`
Expected: FAIL — 6 errors `'timestamp' does not exist in type 'TableEntry'` (lines 30/179/204/229/247/265 of `advisory.repository.ts`).

Run: `pnpm exec tsc --noEmit -p services/ledger/ledger-ctrl/tsconfig.spec.json`
Expected: FAIL — 2 errors at `ledger.repository.ts:79` and `:185`.

- [ ] **Step 2: Add the optional field**

In `libs/event-processor/src/platform/table.ts`, add `timestamp?: string` alongside the other system attributes:

```ts
import type { RequestContext } from '../domain/schemas';

export type TableEntry<T extends object = object, S = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  createdAt: string;
  updatedAt?: string;
  timestamp?: string;
  ttl?: number;
} & S;
```

- [ ] **Step 3: Verify both services typecheck clean**

Run: `pnpm exec tsc --noEmit -p services/advisory/advisory-bff/tsconfig.spec.json`
Expected: PASS (0 errors).

Run: `pnpm exec tsc --noEmit -p services/ledger/ledger-ctrl/tsconfig.spec.json`
Expected: PASS (0 errors).

- [ ] **Step 4: Repoint advisory-bff `typecheck` to the full spec config**

In `services/advisory/advisory-bff/project.json`, the `typecheck` target currently runs the isolated WS-A workaround config. Change the command from `tsconfig.type-test.json` to `tsconfig.spec.json`:

```json
"typecheck": {
  ...
  "options": {
    "command": "tsc --noEmit -p services/advisory/advisory-bff/tsconfig.spec.json"
  }
}
```

- [ ] **Step 5: Verify the repointed target + event-processor type gate**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS.

Run: `pnpm nx run event-processor:typecheck`
Expected: PASS (the additive field does not break the ownership type-tests).

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/platform/table.ts services/advisory/advisory-bff/project.json
git commit -m "fix(event-processor): add optional timestamp to TableEntry

timestamp is the SK of the system-wide typename-timestamp-index GSI;
adding it (optional, string) clears the 8 TS2353 errors in advisory-bff (6)
and ledger-ctrl (2), and lets advisory-bff typecheck point at its full spec
config. Resolves ledger-ctrl-2-latent-tsc-errors by construction."
```

---

## Task 2: Part C3 — narrow `WorkflowStatus` to reachable members

`WorkflowStatus` lists 13 members; only 6 are reachable post-w3. Verified: the 7 unreachable members appear ONLY in the union definition (no code constructs them), so narrowing is non-breaking.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/models.ts:2-15`

- [ ] **Step 1: Narrow the union**

Replace the `WorkflowStatus` type with the 6 reachable values:

```ts
/** Status of a DecisionPacket through the Step Functions workflow. */
export type WorkflowStatus =
  | 'PENDING'
  | 'AWAITING_CONFIRMATION'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMED'
  | 'REJECTED';
```

- [ ] **Step 2: Verify typecheck + unit tests**

Run: `pnpm exec tsc --noEmit -p services/advisory/decision-workflow-ctrl/tsconfig.spec.json`
Expected: PASS (nothing constructed the removed members).

Run: `pnpm nx test decision-workflow-ctrl`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/models.ts
git commit -m "refactor(decision-workflow-ctrl): narrow WorkflowStatus to reachable states

Drop 7 unreachable members (INITIATED/PROFILING/CONSTRUCTING/NARRATING/
PROPOSED/COMPLIANCE_REVIEW/FAILED) — none reach DecisionReadModel post-w3.
Makes the status: DecisionStatus! contract provable rather than incidental."
```

---

## Task 3: Part C2 — drop `taskToken` on terminal CONFIRMED/REJECTED rows

The USER_RESPONSE handler in `sfn-callback.ts` sets the terminal status but leaves the now-dead `taskToken` on the row. `update()` options support `removes?: string[]` (verified).

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts:106-114`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test asserting the USER_RESPONSE update intent removes `taskToken`. Mirror the existing test's setup for invoking the USER_CONFIRMED handler (reuse the file's existing harness for building `payload`/`ctx`). The new assertion:

```ts
it('removes the dead taskToken on terminal CONFIRMED', async () => {
  const result = await invokeUserResponse('USER_CONFIRMED', {
    decisionId: 'd1', tenantId: 't1',
  });
  const intent = result.intents[0];
  expect(intent._tag).toBe('update');
  expect(intent.typename).toBe('DecisionPacket');
  expect(intent.removes).toEqual(['taskToken']);
  expect(intent.updates.status).toBe('CONFIRMED');
});
```

> If the test file does not already expose an `invokeUserResponse`-style helper, build the handler the same way the file's other tests do (it calls `createHandlers()` or imports the handler map) and pass `{ subject }` as `payload` plus an `EventContext` whose `eventType` is `AdvisoryBffEventTypes.USER_CONFIRMED`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test decision-workflow-ctrl -- sfn-callback`
Expected: FAIL — `intent.removes` is `undefined`.

- [ ] **Step 3: Add `removes: ['taskToken']`**

In the USER_RESPONSE handler, add `removes` to the `update('DecisionPacket', …)` options:

```ts
intents: decisionId ? [update('DecisionPacket', {
  status: decision,
  userDecision: decision,
  ...(isConfirmed ? { confirmedAt: now } : { rejectedAt: now }),
  ...(reason ? { rejectionReason: reason } : {}),
}, {
  add: { __version: 1 },
  removes: ['taskToken'],
  overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
})] : [],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test decision-workflow-ctrl -- sfn-callback`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts
git commit -m "fix(decision-workflow-ctrl): drop dead taskToken on terminal decisions

USER_CONFIRMED/USER_REJECTED are terminal; the L2 waitForTaskToken token is
already consumed. removes: ['taskToken'] strips the stale attribute."
```

---

## Task 4: Part C1 — version AdvisoryStatus by max stream SequenceNumber

`advisory-status-projector.ts` uses `version = Date.now()`; two same-ms recomputes collide and the `#__version < :version` guard drops the fresher count. Replace with the max DynamoDB-stream `SequenceNumber` of the tenant's `DecisionReadModel` records in the batch (strictly monotonic per shard; a tenant's rows share a `pk` → same shard). The executor writes `Item.__version = intent.version` via PutCommand (verified).

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts`
- Test: `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts`

- [ ] **Step 1: Write the failing test**

Update the `streamEvent` helper to stamp a `SequenceNumber` per record, then add a version assertion. Replace the helper and add the new test:

```ts
function streamEvent(rows: Record<string, unknown>[]): DynamoDBStreamEvent {
  return {
    Records: rows.map((row, i) => ({
      eventID: `evt-${i}`,
      eventName: 'MODIFY',
      eventSource: 'aws:dynamodb',
      dynamodb: {
        SequenceNumber: String(1000 + i),
        NewImage: marshall(row, { removeUndefinedValues: true }),
      },
    })),
  } as unknown as DynamoDBStreamEvent;
}
```

```ts
it('versions the AdvisoryStatus write with the max SequenceNumber for the tenant', async () => {
  countMock.mockResolvedValue(2);

  await handler(streamEvent([
    { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }, // seq 1000
    { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d2' }, // seq 1001
  ]));

  const put = (ddbMock.calls() as Array<{ args: [{ input: { Item?: Record<string, unknown> } }] }>)
    .find((c) => c.args[0].input.Item?.sk === 'AdvisoryStatus');
  expect(put!.args[0].input.Item!.__version).toBe(1001);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test advisory-bff -- advisory-status-projector`
Expected: FAIL — `__version` is a `Date.now()` value, not `1001`.

- [ ] **Step 3: Implement max-SequenceNumber versioning**

Rewrite the handler body to track a per-tenant max SequenceNumber and use it as the version. Add `getTime` to the event-processor import and use it for the envelope timestamp (the version is no longer an epoch ms, so `new Date(version)` would be a garbage date):

```ts
import { IntentExecutor, projectVersioned, asTenantId, asUserId, getTime, type EventContext } from '@nestfolio/event-processor';
```

```ts
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  // Strictly-monotonic version per tenant: max DynamoDB-stream SequenceNumber of
  // the tenant's DecisionReadModel records in this batch. SequenceNumbers are
  // increasing within a shard, and a tenant's rows share a pk -> same shard.
  // Number() is lossy above 2^53, but distinct invocations are temporally
  // separated well above that floor -- strictly better than the Date.now()
  // same-ms collision it replaces.
  const tenantMaxSeq = new Map<string, number>();
  for (const rec of event.Records) {
    const image = rec.dynamodb?.NewImage ?? rec.dynamodb?.OldImage;
    if (!image) continue;
    const row = unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
    if (row.__typename !== 'DecisionReadModel') continue; // loop guard
    if (typeof row.tenantId !== 'string') continue;
    const seq = Number(rec.dynamodb?.SequenceNumber ?? 0);
    if (seq > (tenantMaxSeq.get(row.tenantId) ?? 0)) tenantMaxSeq.set(row.tenantId, seq);
  }

  for (const [tenantId, version] of tenantMaxSeq) {
    const inFlightCount = await repo.countInFlightDecisions(tenantId);
    // System-originated recompute: no end-user request context. Supply system
    // sentinels for the required RequestContext fields.
    const ctx: EventContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId('system'),
      region: process.env.AWS_REGION ?? 'us-east-1',
      eventId: `recompute-${tenantId}-${version}`,
      eventType: 'ADVISORY_STATUS_RECOMPUTED',
      timestamp: getTime(),
      serviceName: 'advisory-bff',
      record: {},
    };
    await executor.execute(
      projectVersioned('AdvisoryStatus', { tenantId, inFlightCount }, {
        version,
        overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' },
      }),
      ctx,
    );
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test advisory-bff -- advisory-status-projector`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts
git commit -m "fix(advisory-bff): version AdvisoryStatus by max stream SequenceNumber

Date.now() collides for two same-ms recomputes and the version guard drops
the fresher count. Use the max DynamoDB-stream SequenceNumber of the tenant's
DecisionReadModel records (strictly monotonic per shard)."
```

---

## Task 5: Part A (count) + C4 — portfolio-summary: exclude zero from count + strict drop

`portfolio-summary.ts` (a) counts zeroed positions in `positionCount` (KPI over-counts exited symbols) and (b) uses the `Number(... ?? 0)` no-drop fallback. Fix both: count only `quantity > 0`, and drop-on-absent like `investor-snapshot`/`time-travel-availability`.

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add two tests to `portfolio-summary.test.ts`:

```ts
it('excludes zero-quantity (fully-exited) positions from positionCount', () => {
  const withGhost = {
    cashBalanceCents: 5000,
    lastEventSequence: 8,
    positions: {
      AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
      TSLA: { symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 200 },
    },
  };
  expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot: withGhost }))).toMatchObject({
    fields: { positionCount: 1, totalValueCents: 155000 }, // only AAPL counted; TSLA contributes 0
    version: 8,
  });
});

it('drops (returns undefined) when lastEventSequence is absent', () => {
  const noVersion = { cashBalanceCents: 5000, positions: {} };
  expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot: noVersion }))).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test dashboard-bff -- portfolio-summary`
Expected: FAIL — `positionCount` is 2; absent-version case writes `version: 0` instead of `undefined`.

- [ ] **Step 3: Implement count filter + strict drop**

Replace the body of `portfolioSummary` from the version line down:

```ts
  if (!snapshot || snapshot.cashBalanceCents === undefined) return undefined;

  const version = snapshot.lastEventSequence;
  if (typeof version !== 'number') return undefined;

  const positions = snapshot.positions ?? {};
  const held = Object.values(positions).filter((p) => (p.quantity ?? 0) > 0);
  const positionMarketValueCents = held.reduce(
    (sum, p) => sum + Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100),
    0,
  );

  return projectVersioned(
    'PortfolioSummary',
    {
      tenantId,
      userId,
      region,
      cashBalanceCents: snapshot.cashBalanceCents,
      positionCount: held.length,
      totalValueCents: snapshot.cashBalanceCents + positionMarketValueCents,
    },
    {
      version,
      overrides: { pk: `T#${tenantId}`, sk: 'PortfolioSummary' },
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test dashboard-bff -- portfolio-summary`
Expected: PASS (existing 3 + new 2; the existing "no snapshot/cashBalance → undefined" test still passes).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/portfolio-summary.ts services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts
git commit -m "fix(dashboard-bff): exclude zero-quantity holdings from positionCount + strict drop

positionCount counted fully-exited (quantity:0) symbols; count only held
positions. Also align the version fallback to drop-on-absent (matches
investor-snapshot/time-travel-availability) instead of Number(... ?? 0)."
```

---

## Task 6: Part C4 — position-snapshot: strict drop-on-absent version

`position-snapshot.ts` uses `Number(snapshot?.lastEventSequence ?? 0)`. Align to the strict drop pattern. (It intentionally still WRITES `quantity:0` rows — they are version-correct and filtered at read in Task 7.)

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/position-snapshot.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `position-snapshot.test.ts`:

```ts
it('drops (returns empty array) when lastEventSequence is absent', () => {
  expect(positionSnapshot(makeUow({ snapshot: {
    positions: { AAPL: { symbol: 'AAPL', quantity: 1, averageCostBasis: 1, totalCostBasis: 1, lastFillPrice: 1 } },
  } }))).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff -- position-snapshot`
Expected: FAIL — currently emits an intent with `version: 0` instead of `[]`.

- [ ] **Step 3: Implement strict drop**

In `positionSnapshot`, move the version extraction above the loop and drop on absence. Replace the empty-positions check + version line:

```ts
  const version = snapshot?.lastEventSequence;
  if (typeof version !== 'number') return [];

  const entries = Object.entries(snapshot?.positions ?? {});
  if (entries.length === 0) return [];

  const marketValueCentsOf = (p: LedgerPosition) =>
    Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100);
```

(Remove the later `const version = Number(snapshot?.lastEventSequence ?? 0);` line — `version` is now defined above.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test dashboard-bff -- position-snapshot`
Expected: PASS (existing 2 + new 1; the "no positions → []" test still passes since version 9 is present).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/position-snapshot.ts services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts
git commit -m "refactor(dashboard-bff): position-snapshot strict drop-on-absent version

Align to the strict P1 pattern (return [] when lastEventSequence is absent)
instead of the Number(... ?? 0) v0-sentinel fallback."
```

---

## Task 7: Part A — dashboard get-position-snapshots resolver filters `quantity > 0`

The materialized `quantity:0` rows are correct projections; holdings are `quantity > 0`. Filter at the read boundary.

**Files:**
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/get-position-snapshots.fn.js`
- Test (create): `services/investor/dashboard-bff/test/unit/graphql/get-position-snapshots.test.ts`

- [ ] **Step 1: Write the failing test**

Create the test (direct `.fn.js` import, mirroring advisory-bff's `mutation-region.test.ts`):

```ts
import { response } from '../../../src/graphql/js-function/get-position-snapshots.fn.js';

describe('get-position-snapshots resolver', () => {
  it('filters out zero-quantity ghost holdings', () => {
    const ctx = { result: { items: [
      { symbol: 'AAPL', quantity: 10 },
      { symbol: 'TSLA', quantity: 0 },
    ] } };
    expect(response(ctx)).toEqual([{ symbol: 'AAPL', quantity: 10 }]);
  });

  it('returns [] when there are no items', () => {
    expect(response({ result: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff -- get-position-snapshots`
Expected: FAIL — returns both items (TSLA not filtered).

- [ ] **Step 3: Add the filter**

In `get-position-snapshots.fn.js`, update `response`:

```js
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  return items.filter((p) => (p.quantity ?? 0) > 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test dashboard-bff -- get-position-snapshots`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/graphql/js-function/get-position-snapshots.fn.js services/investor/dashboard-bff/test/unit/graphql/get-position-snapshots.test.ts
git commit -m "fix(dashboard-bff): filter zero-quantity ghost holdings at read

Fully-exited symbols persist as version-correct quantity:0 PositionSnapshot
rows; holdings are quantity > 0. Filter in the resolver response."
```

---

## Task 8: Part A — ledger-bff position resolvers filter `quantity > 0`

Same ghost-holdings fix on the Ledger read surface. `get-positions` (all-positions list branch only — leave the explicit single-symbol lookup) and `get-portfolio` (positions array). `get-performance` is deliberately unchanged (zeroed positions contribute 0 to every aggregate).

**Files:**
- Modify: `services/ledger/ledger-bff/src/graphql/js-function/get-positions.fn.js`
- Modify: `services/ledger/ledger-bff/src/graphql/js-function/get-portfolio.fn.js`
- Test (create): `services/ledger/ledger-bff/test/unit/graphql/get-positions.test.ts`
- Test (create): `services/ledger/ledger-bff/test/unit/graphql/get-portfolio.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `get-positions.test.ts`:

```ts
import { response } from '../../../src/graphql/js-function/get-positions.fn.js';

describe('get-positions resolver', () => {
  it('filters zero-quantity rows from the all-positions list', () => {
    const ctx = { arguments: {}, result: { items: [
      { symbol: 'AAPL', quantity: 10, averageCostBasis: 1, totalCostBasis: 1, lastFillPrice: 2 },
      { symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 5 },
    ] } };
    const out = response(ctx);
    expect(out.map((p) => p.symbol)).toEqual(['AAPL']);
  });

  it('returns the single-symbol lookup as-is even at quantity 0', () => {
    const ctx = { arguments: { symbol: 'TSLA' }, result: { symbol: 'TSLA', quantity: 0 } };
    expect(response(ctx)).toEqual([{
      symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0,
    }]);
  });
});
```

Create `get-portfolio.test.ts`:

```ts
import { response } from '../../../src/graphql/js-function/get-portfolio.fn.js';

describe('get-portfolio resolver', () => {
  it('omits zero-quantity positions but keeps totals correct', () => {
    const ctx = { result: { items: [
      { sk: 'Latest', cashBalanceCents: 5000 },
      { sk: 'Position#AAPL', symbol: 'AAPL', quantity: 10, totalCostBasis: 10, lastFillPrice: 150 },
      { sk: 'Position#TSLA', symbol: 'TSLA', quantity: 0, totalCostBasis: 0, lastFillPrice: 200 },
    ] } };
    const out = response(ctx);
    expect(out.positions.map((p) => p.symbol)).toEqual(['AAPL']);
    expect(out.totalValueCents).toBe(155000); // 5000 cash + 150000 AAPL; TSLA contributes 0
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test ledger-bff -- get-positions`
Run: `pnpm nx test ledger-bff -- get-portfolio`
Expected: FAIL — TSLA present in both lists.

- [ ] **Step 3: Add the filters**

In `get-positions.fn.js`, filter the all-positions branch (leave the single-symbol branch):

```js
  // All positions
  const items = ctx.result.items || [];
  return items
    .filter((p) => (p.quantity ?? 0) > 0)
    .map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity ?? 0,
      averageCostBasis: p.averageCostBasis ?? 0,
      totalCostBasis: p.totalCostBasis ?? 0,
      lastFillPrice: p.lastFillPrice ?? 0,
    }));
```

In `get-portfolio.fn.js`, filter the positions array before the totals loop:

```js
  const positions = items
    .filter((i) => i.sk && i.sk.startsWith('Position#'))
    .filter((p) => (p.quantity ?? 0) > 0)
    .map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity ?? 0,
      averageCostBasis: p.averageCostBasis ?? 0,
      totalCostBasis: p.totalCostBasis ?? 0,
      lastFillPrice: p.lastFillPrice ?? 0,
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test ledger-bff -- get-positions`
Run: `pnpm nx test ledger-bff -- get-portfolio`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/graphql/js-function/get-positions.fn.js services/ledger/ledger-bff/src/graphql/js-function/get-portfolio.fn.js services/ledger/ledger-bff/test/unit/graphql/get-positions.test.ts services/ledger/ledger-bff/test/unit/graphql/get-portfolio.test.ts
git commit -m "fix(ledger-bff): filter zero-quantity ghost holdings at read

Mirror the dashboard fix on the ledger read surface: get-positions list +
get-portfolio positions array filter quantity > 0. Single-symbol lookup and
get-performance aggregates left unchanged (zeroed rows contribute 0)."
```

---

## Task 9: Part B1 — delete the two dead AdvisoryStatus repo methods

`upsertAdvisoryStatus` and `guardedUpsertAdvisoryStatus` have no `src` callers (the P3 projectVersioned path superseded them).

**Files:**
- Modify: `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts` (remove both methods)
- Modify: `services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts` (remove the `upsertAdvisoryStatus` describe block, L207-236)

- [ ] **Step 1: Delete both methods**

In `dashboard.repository.ts`, delete the entire `upsertAdvisoryStatus = this.log(...)` member (starts ~L287) and the entire `guardedUpsertAdvisoryStatus = this.log(...)` member (starts ~L345), including the `// --- Advisory Status ---` section comment if it now precedes nothing else. Remove any imports left unused only by these methods (e.g. `guardedWrite`) — check with the build in Step 3.

- [ ] **Step 2: Delete the dead method's tests**

In `dashboard.repository.test.ts`, delete the `describe('upsertAdvisoryStatus', () => { … })` block (L207-236). `guardedUpsertAdvisoryStatus` has no test.

- [ ] **Step 3: Verify typecheck + tests**

Run: `pnpm exec tsc --noEmit -p services/investor/dashboard-bff/tsconfig.spec.json`
Expected: PASS (no unused-import or dangling-reference errors).

Run: `pnpm nx test dashboard-bff -- dashboard.repository`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/src/repositories/dashboard.repository.ts services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts
git commit -m "refactor(dashboard-bff): remove dead AdvisoryStatus repo writers

upsertAdvisoryStatus + guardedUpsertAdvisoryStatus have no src callers since
the P3 projectVersioned path replaced the accumulate writers."
```

---

## Task 10: Part B2 (backend) — drop `lastRecommendationAt` + `lastDecisionStatus`

Never written by any producer (the P3 projection writes only `pendingDecisionsCount`). Remove from schema, publisher, query resolver.

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql` (type `AdvisoryStatus` L80-81; input `AdvisoryStatusInput` L30-31)
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` (L12-14, L51, L58-59)
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js` (L32-33)
- Test: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts`

- [ ] **Step 1: Remove from the GraphQL schema**

In `schema.graphql`, delete the two field lines from BOTH the `input AdvisoryStatusInput` block and the `type AdvisoryStatus` block, leaving:

```graphql
input AdvisoryStatusInput {
  pendingDecisionsCount: Int!
  updatedAt: String!
}
```
```graphql
type AdvisoryStatus @aws_cognito_user_pools @aws_iam {
  pendingDecisionsCount: Int!
  updatedAt: String!
}
```

- [ ] **Step 2: Remove from the publisher**

In `dashboard-publisher.ts`: delete the two lines from the mutation selection set (L13-14), drop them from `whenChanged` (→ `whenChanged: ['pendingDecisionsCount']`), and remove the two `mapImage` payload lines:

```ts
        advisoryStatus {
          pendingDecisionsCount
          updatedAt
        }
```
```ts
      whenChanged: ['pendingDecisionsCount'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2);
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item['pendingDecisionsCount'] ?? 0),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
```

- [ ] **Step 3: Remove from the query resolver**

In `get-dashboard.fn.js`, delete the two lines (L32-33) building `lastRecommendationAt` / `lastDecisionStatus` from `rawAs`.

- [ ] **Step 4: Update the publisher test**

In `dashboard-publisher.test.ts`, remove `lastRecommendationAt` / `lastDecisionStatus` from the `oldImage`/`newImage` fixtures and from any expected broadcast payload (L47-95). For the "whenChanged" test that asserts a broadcast fires when only those fields change, repurpose it to assert a `pendingDecisionsCount` change fires and that a change to an unrelated field does NOT (drop assertions keyed on the removed fields).

- [ ] **Step 5: Verify typecheck + tests**

Run: `pnpm exec tsc --noEmit -p services/investor/dashboard-bff/tsconfig.spec.json`
Expected: PASS.

Run: `pnpm nx test dashboard-bff -- dashboard-publisher`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts
git commit -m "refactor(dashboard-bff): drop unwritten AdvisoryStatus fields

lastRecommendationAt + lastDecisionStatus are never written by any producer
(P3 projection carries only pendingDecisionsCount) — structural zeros. Remove
from schema, publisher selection/whenChanged/payload, and query resolver."
```

---

## Task 11: Part B2 (MFE) — drop the fields from dashboard-mfe

Remove the two fields from the store type, the GraphQL fragment, the alert-bar component (the `@if lastDecisionStatus` block + its now-unused style), and the specs.

**Files:**
- Modify: `apps/dashboard-mfe/src/app/stores/dashboard.store.ts:40-41`
- Modify: `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts:39-40`
- Modify: `apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts`
- Modify: `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts:33-34`
- Modify: `apps/dashboard-mfe/test/app/dashboard/advisory-alert-bar.component.spec.ts:28-29`

- [ ] **Step 1: Remove from the store interface**

In `dashboard.store.ts`, delete the two fields so the interface is:

```ts
export interface AdvisoryStatus {
  pendingDecisionsCount: number;
  updatedAt: string;
}
```

- [ ] **Step 2: Remove from the GraphQL fragment**

In `dashboard-bff.queries.ts`, delete the two lines from `ADVISORY_STATUS_FIELDS`:

```ts
const ADVISORY_STATUS_FIELDS = `
  fragment AdvisoryStatusFields on AdvisoryStatus {
    pendingDecisionsCount
    updatedAt
  }
`;
```

- [ ] **Step 3: Remove the alert-bar `lastDecisionStatus` block**

In `advisory-alert-bar.component.ts`, delete the `@if (advisoryStatus?.lastDecisionStatus) { … }` template block (the `.alert-status` span) and the now-unused `.alert-status { … }` style rule. The `dashboard.advisory.lastStatus` i18n key is referenced only here — no separate translation file to edit.

- [ ] **Step 4: Remove from the specs**

In `dashboard.store.spec.ts` (L33-34) and `advisory-alert-bar.component.spec.ts` (L28-29), delete the `lastRecommendationAt` / `lastDecisionStatus` fixture lines (the assertions key only on `pendingDecisionsCount`, so they stay).

- [ ] **Step 5: Verify the MFE builds + tests**

Run: `pnpm nx test dashboard-mfe`
Expected: PASS.

Run: `pnpm nx lint dashboard-mfe`
Expected: PASS (no unused-symbol warnings from the removed style/field).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard-mfe/src/app/stores/dashboard.store.ts apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts apps/dashboard-mfe/test/app/dashboard/advisory-alert-bar.component.spec.ts
git commit -m "refactor(dashboard-mfe): drop unwritten AdvisoryStatus fields

Mirror the dashboard-bff schema change: remove lastRecommendationAt +
lastDecisionStatus from the store type, GraphQL fragment, alert-bar template,
and specs. Alert bar keeps the pending-decisions count."
```

---

## Task 12: Whole-workstream cheap-gate verification

Run the read-model program's cheap gates (deploy + integration + ledger-ctrl-2 drop are handled in the backlog-next closing phase, not here).

- [ ] **Step 1: Per-service typecheck**

Run, each expecting PASS:
```
pnpm nx run event-processor:typecheck
pnpm nx run event-processor:read-model-drift
pnpm nx run advisory-bff:typecheck
pnpm nx run dashboard-bff:typecheck
```
`read-model-drift` MUST report 0 new drift (no projection-shape change in this workstream).

- [ ] **Step 2: nx affected test + lint**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS across the affected projects (event-processor, advisory-bff, dashboard-bff, ledger-bff, ledger-ctrl, decision-workflow-ctrl, dashboard-mfe).

- [ ] **Step 3: Final commit if any incidental fixups were needed**

```bash
git add -A && git commit -m "chore: cheap-gate fixups for dashboard-advisory-readmodel-fixes" || echo "nothing to commit"
```

---

## Closing phase (backlog-next, not plan tasks)

Handled by `/backlog-next` step 6 after the plan executes:
- `nx affected -t test-integration --base=origin/main` (mocked agents).
- Dev deploy of the behavior-affecting services: **dashboard-bff, ledger-bff, advisory-bff, decision-workflow-ctrl** (`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff,ledger-bff,advisory-bff,decision-workflow-ctrl`).
- Mark `docs/backlog/ledger-ctrl-2-latent-tsc-errors.md` `dropped` with a forward-pointer to this workstream (Part D resolved it).
- Set this item `status: shipped` with the `validation_gate`, regen the index, finish the branch.
- Real-LLM e2e is **deferred** per the read-model program's validation cadence (topic dossier 2026-06-02) — not run for this residual workstream.

## Self-review notes (coverage vs spec)

- Part A (ghost holdings): Tasks 5 (count), 7 (dashboard read), 8 (ledger read). ✓
- Part B1 (dead methods): Task 9. ✓
- Part B2 (drop fields): Tasks 10 (backend) + 11 (MFE). ✓
- Part B3 (MANDATE_ISSUED): no-op (doc-only), noted in spec. ✓
- Part C1 (version): Task 4. C2 (taskToken): Task 3. C3 (union): Task 2. C4 (strict drop): Tasks 5 + 6. ✓
- Part D (TableEntry): Task 1 (also clears ledger-ctrl-2). ✓
