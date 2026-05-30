# dashboard-bff read-model materialization (workstream 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate dashboard-bff's `PortfolioSummary` and `PositionSnapshot` read rows to version-guarded P1 projections sourced from the authoritative ledger snapshot, register ownership, delete dead writers, and remove the read-resolver `|| 0` papering — dissolving the structural-zero + `totalValueCents` double-count bug faces by construction.

**Architecture:** dashboard-bff currently rebuilds `PortfolioSummary`/`PositionSnapshot` field-by-field from order-fill-shaped fields (`accumulate` + `project`), ignoring the ledger snapshot — which is why `cashBalanceCents`/`positionCount` are never written. This workstream re-sources both rows from the same `payload.snapshot.{cashBalanceCents, positions, lastEventSequence}` envelope that ledger-bff (w1) already projects, writing full rows guarded by `lastEventSequence` as `__version` via the `projectVersioned` P1 primitive shipped in w0.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (`projectVersioned`, `materializeToTable`, `toUow`, `ReadModelOwnership` declaration-merging registry), DynamoDB single-table, AppSync JS resolvers, Jest (`@nestfolio/test-support` + `@nestfolio/integration-testing`), Nx.

---

## CRITICAL data-shape facts (verified against ledger-ctrl code)

The ledger snapshot is the single authoritative source for these rows. Both
`BALANCE_UPDATED` and `PORTFOLIO_UPDATED` carry a `snapshot` field on the event
subject (appended by `defineSnapshotProjection` in
`services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts:48-52`):

```ts
subject.snapshot = {
  positions: Record<string, PositionState>,   // KEYED BY SYMBOL — NOT an array
  cashBalanceCents: number,
  lastEventSequence: number,                   // → the monotonic __version
}
```

Each `PositionState` (`services/ledger/ledger-ctrl/src/domain/account-state.ts:1-7`) is **dollar-denominated** — there are NO pre-computed cents/market-value fields:
```ts
interface PositionState { symbol: string; quantity: number; averageCostBasis: number; totalCostBasis: number; lastFillPrice: number; }
```
So dashboard MUST compute cents itself (mirroring ledger-bff's `get-performance.fn.js:28` `marketValueCents += Math.round(qty * lastFillPrice * 100)`):
- `marketValueCents       = round(quantity * lastFillPrice * 100)`
- `avgCostBasisCents      = round(averageCostBasis * 100)`
- `currentPriceCents      = round(lastFillPrice * 100)`
- `unrealizedPnlCents     = marketValueCents - round(totalCostBasis * 100)`
- `totalValueCents        = cashBalanceCents + Σ marketValueCents`
- `positionCount          = Object.keys(positions).length`
- `weightPercent          = marketValueCents / Σ marketValueCents * 100`

`projectVersioned` overload used everywhere here (`libs/event-processor/src/intents/project-versioned.ts:18-22`):
```ts
projectVersioned(typename, fields: Record<string, unknown>, { version: number, overrides?: { pk, sk } }): ProjectVersionedIntent
```
Writes the FULL row guarded by `attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version < :version`. Stale/duplicate → dropped (deduplicated), not redriven.

w1 reference: `services/ledger/ledger-bff/src/transforms/{balance-updated,portfolio-updated}.ts` + ownership at `services/ledger/ledger-bff/src/read-model-ownership.ts` (side-effect-imported from `src/handlers/event-listener.ts`).

---

## Scope (this workstream)

In:
- `PortfolioSummary` → P1 `projectVersioned` from ledger snapshot (full row: `cashBalanceCents`, `positionCount`, `totalValueCents`, `version`).
- `PositionSnapshot` → P1 `projectVersioned`, one row per holding, from `snapshot.positions`.
- `ReadModelOwnership` registration for `PortfolioSummary`, `PositionSnapshot` (both `Projection<'P1'>`) and `Activity` (`Projection<'P2'>`).
- Delete dead `SimulationSummary` / `StreamSnapshot` repository writers (zero callers).
- Remove `driftPercent` from `PortfolioSummary` (not in the ledger snapshot; violates single-producer P1) and remove the `|| 0` read-resolver papering.
- Rewrite the `read-model-projection` integration test to assert version-guarded full-row projection + stale-drop + structural-zeros-gone.

## Out of scope (carry-overs — file/note, do NOT implement here)

- **`InvestorSnapshot` → P1 deferred to w4.** Its producer (investor-bff) does not stamp a version, and a full-row P1 write would wipe `onboardedAt` on `INVESTOR_PROFILE_UPDATED` (only set on CREATED). Both the producer `__version` stamping and the dashboard-side migration belong to w4. `InvestorSnapshot` stays on `project()` and is NOT registered in the ownership map this workstream. → Carry-over note added to the w4 dossier (Task 7).
- **`AdvisoryStatus` → P3 deferred to w3.** A true P3 derived count needs an authoritative set of decision rows to count over; those arrive when w3 emits versioned `DecisionPacket` snapshots that dashboard projects. The `accumulate` counter stays in place and is NOT registered (registering as P3 would break `accumulate`). → Carry-over note added to the w3 dossier (Task 7).
- **Orphan position rows on sell.** A fully-sold holding leaves a stale `PositionSnapshot#<symbol>` row (never overwritten). Pre-existing limitation of the w1 reference (`ledger-bff` `Position` has identical behavior), NOT introduced here. → File a parking item via `backlog-add` (Task 7).
- Live-push transport (`dashboard-live-push-*`) — deferred, rebuilt on this clean read model afterward.
- `TimeTravelAvailability` — stays on `project()`, untouched.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` | Project `PortfolioSummary` full row from ledger snapshot | Rewrite (Task 1) |
| `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` | Project one `PositionSnapshot` per holding from ledger snapshot | Rewrite (Task 2) |
| `services/investor/dashboard-bff/src/handlers/event-listener.ts` | Route events; flatten the per-position intent array | Modify (Task 2) |
| `services/investor/dashboard-bff/src/read-model-ownership.ts` | Declare ownership tags for dashboard typenames | Create (Task 3) |
| `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts` | Read-model repo; remove dead writers | Modify (Task 4) |
| `services/investor/dashboard-bff/src/schema.graphql` | GraphQL types; drop `driftPercent` | Modify (Task 5) |
| `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js` | Aggregate resolver; remove `|| 0` papering + `driftPercent` | Modify (Task 5) |
| `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts` | Unit-test the rewritten transform | Rewrite (Task 1) |
| `services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts` | Unit-test the rewritten transform | Rewrite (Task 2) |
| `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts` | Handler routing/shape assertions | Modify (Task 2) |
| `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts` | Version-guard + stale-drop + structural-zero assertions | Rewrite (Task 6) |
| `services/investor/dashboard-bff/CLAUDE.md` | Service card | Modify (Task 7) |

---

## Task 1: Rewrite `portfolio-summary` transform to versioned snapshot projection

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts`

- [ ] **Step 1: Replace the unit test with the new expected behavior**

Overwrite `test/unit/transforms/portfolio-summary.test.ts`:
```ts
import { portfolioSummary } from '../../../src/transforms/portfolio-summary';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const makeUow = (type: string, subject: Record<string, unknown>): TestUow => ({
  event: {
    id: 'e1',
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    subject,
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
}) as unknown as TestUow;

// AAPL: 10 @ $150 → 150000c market; MSFT: 5 @ $100 → 50000c market. Σ market = 200000c.
const snapshot = {
  cashBalanceCents: 5000,
  lastEventSequence: 7,
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 200, totalCostBasis: 1000, lastFillPrice: 100 },
  },
};

describe('portfolioSummary transform', () => {
  it('projects a versioned full PortfolioSummary row from a ledger snapshot', () => {
    expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot }))).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        cashBalanceCents: 5000,
        positionCount: 2,
        totalValueCents: 205000, // 5000 cash + 150000 + 50000 market
      },
      version: 7,
      overrides: { pk: 'T#t1', sk: 'PortfolioSummary' },
    });
  });

  it('accepts a bare snapshot payload (no `snapshot` wrapper)', () => {
    expect(portfolioSummary(makeUow('BALANCE_UPDATED', { ...snapshot }))).toMatchObject({
      _tag: 'projectVersioned',
      version: 7,
      fields: { cashBalanceCents: 5000, positionCount: 2, totalValueCents: 205000 },
    });
  });

  it('returns undefined when no snapshot/cashBalance is present', () => {
    expect(portfolioSummary(makeUow('RECONCILIATION_COMPLETED', { foo: 'bar' }))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff --testPathPatterns=portfolio-summary`
Expected: FAIL — current transform returns `accumulate`/`project`/`undefined`, not `projectVersioned`.

- [ ] **Step 3: Rewrite the transform**

Overwrite `src/transforms/portfolio-summary.ts`:
```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = { quantity?: number; lastFillPrice?: number };
type LedgerSnapshot = {
  cashBalanceCents?: number;
  positions?: Record<string, LedgerPosition>;
  lastEventSequence?: number;
};

/**
 * Projects the PortfolioSummary read row from the authoritative ledger snapshot
 * carried on BALANCE_UPDATED / PORTFOLIO_UPDATED. Full-row, version-guarded write
 * keyed on `lastEventSequence` — fixes the cashBalanceCents/positionCount
 * structural zeros and the totalValueCents double-count by construction (no more
 * `accumulate`). Position values are dollar-denominated in the snapshot, so
 * market value is computed here. See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const portfolioSummary = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;

  if (!snapshot || snapshot.cashBalanceCents === undefined) return undefined;

  const positions = snapshot.positions ?? {};
  const positionMarketValueCents = Object.values(positions).reduce(
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
      positionCount: Object.keys(positions).length,
      totalValueCents: snapshot.cashBalanceCents + positionMarketValueCents,
    },
    {
      version: Number(snapshot.lastEventSequence ?? 0),
      overrides: { pk: `T#${tenantId}`, sk: 'PortfolioSummary' },
    },
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test dashboard-bff --testPathPatterns=portfolio-summary`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/portfolio-summary.ts services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts
git commit -m "refactor(dashboard-bff): project PortfolioSummary from ledger snapshot via projectVersioned"
```

---

## Task 2: Rewrite `position-snapshot` transform to per-holding versioned projections + flatten handler

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/position-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts`
- Test: `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts`

- [ ] **Step 1: Replace the position-snapshot unit test**

Overwrite `test/unit/transforms/position-snapshot.test.ts`:
```ts
import { positionSnapshot } from '../../../src/transforms/position-snapshot';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const makeUow = (subject: Record<string, unknown>): TestUow => ({
  event: {
    id: 'e1',
    type: 'PORTFOLIO_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject,
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
}) as unknown as TestUow;

// AAPL: 10 @ $150 → 150000c market (75%); MSFT: 5 @ $100 → 50000c market (25%).
const snapshot = {
  lastEventSequence: 9,
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 200, totalCostBasis: 1000, lastFillPrice: 100 },
  },
};

describe('positionSnapshot transform', () => {
  it('emits one versioned PositionSnapshot intent per holding with computed cents + weight', () => {
    const intents = positionSnapshot(makeUow({ snapshot }));
    expect(intents).toHaveLength(2);

    const aapl = intents.find((i) => (i as { overrides?: { sk?: string } }).overrides?.sk === 'PositionSnapshot#AAPL');
    expect(aapl).toEqual({
      _tag: 'projectVersioned',
      typename: 'PositionSnapshot',
      fields: {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        quantity: 10,
        avgCostBasisCents: 10000,   // 100 * 100
        currentPriceCents: 15000,   // 150 * 100
        marketValueCents: 150000,   // 10 * 150 * 100
        weightPercent: 75,          // 150000 / 200000 * 100
        unrealizedPnlCents: 50000,  // 150000 - (1000 * 100)
      },
      version: 9,
      overrides: { pk: 'T#t1', sk: 'PositionSnapshot#AAPL' },
    });

    const msft = intents.find((i) => (i as { overrides?: { sk?: string } }).overrides?.sk === 'PositionSnapshot#MSFT');
    expect(msft).toMatchObject({
      fields: { marketValueCents: 50000, weightPercent: 25, unrealizedPnlCents: -50000 },
      version: 9,
    });
  });

  it('returns an empty array when the snapshot has no positions', () => {
    expect(positionSnapshot(makeUow({ snapshot: { positions: {}, lastEventSequence: 1 } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff --testPathPatterns=position-snapshot`
Expected: FAIL — current transform returns a single `project` intent.

- [ ] **Step 3: Rewrite the transform to return `WriteIntent[]`**

Overwrite `src/transforms/position-snapshot.ts`:
```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = {
  symbol?: string;
  quantity?: number;
  averageCostBasis?: number;
  totalCostBasis?: number;
  lastFillPrice?: number;
};
type LedgerSnapshot = { positions?: Record<string, LedgerPosition>; lastEventSequence?: number };

/**
 * Projects one PositionSnapshot row per holding from the authoritative ledger
 * snapshot. Full-row, version-guarded writes keyed on `lastEventSequence`.
 * Snapshot positions are dollar-denominated, so cents/market-value are computed
 * here; `assetClass` defaults to EQUITY (absent from the snapshot) and
 * `weightPercent` is each holding's share of total market value.
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const positionSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
  const entries = Object.entries(snapshot?.positions ?? {});
  if (entries.length === 0) return [];

  const version = Number(snapshot?.lastEventSequence ?? 0);
  const marketValueCentsOf = (p: LedgerPosition) =>
    Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100);
  const totalMarketValueCents = entries.reduce((sum, [, p]) => sum + marketValueCentsOf(p), 0);

  return entries.map(([key, pos]) => {
    const symbol = pos.symbol ?? key;
    const marketValueCents = marketValueCentsOf(pos);
    return projectVersioned(
      'PositionSnapshot',
      {
        tenantId,
        userId,
        region,
        symbol,
        assetClass: 'EQUITY',
        quantity: pos.quantity ?? 0,
        avgCostBasisCents: Math.round((pos.averageCostBasis ?? 0) * 100),
        currentPriceCents: Math.round((pos.lastFillPrice ?? 0) * 100),
        marketValueCents,
        weightPercent: totalMarketValueCents > 0 ? (marketValueCents / totalMarketValueCents) * 100 : 0,
        unrealizedPnlCents: marketValueCents - Math.round((pos.totalCostBasis ?? 0) * 100),
      },
      { version, overrides: { pk: `T#${tenantId}`, sk: `PositionSnapshot#${symbol}` } },
    );
  });
};
```

- [ ] **Step 4: Update the event-listener handler to flatten the per-position array**

In `src/handlers/event-listener.ts`, replace the `[LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]` entry with a version that spreads the `positionSnapshot` array:
```ts
    [LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]: (payload: EventPayload, ctx: EventContext) => {
      const uow = toUow(payload, ctx);
      return [
        portfolioSummary(uow),
        ...positionSnapshot(uow),
        recentActivity(uow),
      ].filter((i): i is NonNullable<typeof i> => i != null);
    },
```
Leave the `BALANCE_UPDATED` and `RECONCILIATION_COMPLETED` branches unchanged (they call only `portfolioSummary`, which still returns `WriteIntent | undefined`).

- [ ] **Step 5: Update the event-listener unit test for the new position-snapshot shape**

In `test/unit/handlers/event-listener.test.ts`, any assertion that `PORTFOLIO_UPDATED` yields a single `positionSnapshot` `project` intent must expect a flattened list of `projectVersioned` `PositionSnapshot` intents (one per position) plus a `projectVersioned` `PortfolioSummary`. Run the test (Step 6) to surface exactly which assertions need updating, then align them to the Task 1 & 2 shapes.

- [ ] **Step 6: Run the affected tests to verify they pass**

Run: `pnpm nx test dashboard-bff --testPathPatterns="position-snapshot|event-listener"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/position-snapshot.ts services/investor/dashboard-bff/src/handlers/event-listener.ts services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts
git commit -m "refactor(dashboard-bff): project PositionSnapshot per holding from ledger snapshot via projectVersioned"
```

---

## Task 3: Register dashboard-bff read-model ownership

**Files:**
- Create: `services/investor/dashboard-bff/src/read-model-ownership.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`

- [ ] **Step 1: Create the ownership augmentation file**

Mirror `services/ledger/ledger-bff/src/read-model-ownership.ts`. Create `src/read-model-ownership.ts`:
```ts
/**
 * dashboard-bff read-model ownership registration (workstream 2).
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement:
 *   - PortfolioSummary / PositionSnapshot : P1 → projectVersioned only
 *     (accumulate/project/update on them fail typecheck).
 *   - Activity : P2 append-log → record only.
 *
 * NOT registered (intentional carry-overs, see the w2 plan "Out of scope"):
 *   - InvestorSnapshot → P1 deferred to w4 (producer __version + stable onboardedAt).
 *   - AdvisoryStatus → P3 deferred to w3 (needs authoritative decision rows).
 *   - TimeTravelAvailability → untouched.
 *
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    Activity: Projection<'P2'>;
  }
}

export {};
```

- [ ] **Step 2: Side-effect import it from the handler entrypoint**

In `src/handlers/event-listener.ts`, add at the top of the import block (mirroring ledger-bff):
```ts
import '../read-model-ownership';
```

- [ ] **Step 3: Typecheck to verify enforcement holds**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns=__never__ 2>/dev/null; pnpm exec tsc -p services/investor/dashboard-bff/tsconfig.json --noEmit`
(If a `tsconfig.json` path differs, use the lib build: `pnpm nx run event-processor:typecheck` then `pnpm nx build dashboard-bff`.)
Expected: PASS — the transforms migrated in Tasks 1–2 already use `projectVersioned`, so registering them as P1 typechecks cleanly; `record('Activity', …)` in `recent-activity.ts` is allowed for P2.

- [ ] **Step 4: Prove the guard fires (negative check, then revert)**

Temporarily change `src/transforms/portfolio-summary.ts` to `import { accumulate }` and `return accumulate('PortfolioSummary', { field: 'totalValueCents', increment: 1 })`. Re-run the typecheck (Step 3). Expected: FAIL — `Argument of type '"PortfolioSummary"' is not assignable to parameter of type 'never'`. Then `git checkout services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` to revert. No commit from this step — it only confirms the registration is load-bearing.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/read-model-ownership.ts services/investor/dashboard-bff/src/handlers/event-listener.ts
git commit -m "refactor(dashboard-bff): register PortfolioSummary/PositionSnapshot P1 + Activity P2 ownership"
```

---

## Task 4: Delete dead `SimulationSummary` / `StreamSnapshot` writers

**Files:**
- Modify: `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts`
- Test: `services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts`

- [ ] **Step 1: Confirm zero callers**

Run:
```bash
grep -rn "SimulationSummary\|StreamSnapshot\|upsertSimulationSummary\|getSimulationSummary\|upsertStreamSnapshot\|getStreamSnapshot" services/investor/dashboard-bff/src
```
Expected: matches ONLY inside `dashboard.repository.ts` (the definitions) and the `getSimulationSummary` JS resolver `src/graphql/js-function/get-simulation-summary.fn.js` + its `schema.graphql` query field. The `SimulationSummary` GraphQL type/query is a separate read path (`getSimulationSummary`) — leave the GraphQL `getSimulationSummary` query + resolver + type intact (it returns `null`); this task removes only the dead *repository writers* that no transform calls. If any *transform* references them, STOP.

- [ ] **Step 2: Delete the four repository methods**

In `src/repositories/dashboard.repository.ts`, remove the `upsertStreamSnapshot`, `getStreamSnapshot`, `upsertSimulationSummary`, and `getSimulationSummary` method definitions (the `// --- Simulation Summary ---` block). Leave every other method untouched.

Note: the `getSimulationSummary` GraphQL resolver (`get-simulation-summary.fn.js`) does its own `GetItem` and does NOT call the repo method, so deleting the repo method does not break it. Confirm with: `grep -n "repo\|Repository\|getSimulationSummary" services/investor/dashboard-bff/src/graphql/js-function/get-simulation-summary.fn.js` — expect no repo reference.

- [ ] **Step 3: Remove dead-method assertions from the repository unit test**

Run: `grep -n "SimulationSummary\|StreamSnapshot" services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts`
Delete any test cases exercising the four removed methods.

- [ ] **Step 4: Run the repository unit test**

Run: `pnpm nx test dashboard-bff --testPathPatterns=dashboard.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/repositories/dashboard.repository.ts services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts
git commit -m "refactor(dashboard-bff): delete dead SimulationSummary/StreamSnapshot repository writers"
```

---

## Task 5: Remove `driftPercent` + the `|| 0` read-resolver papering

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js`
- Modify (frontend): `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`, `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts`, `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts` + the three dashboard-mfe specs that assert `driftPercent`

> NOTE: `driftPercent` IS consumed by the dashboard MFE (a KPI card). It is currently always `0`/`2.5`-via-papering and is NOT in the ledger snapshot. Per the single-producer P1 rule it cannot live on `PortfolioSummary`. Dev-phase is breaking-changes-free, so remove the drift KPI card end-to-end in this task. (A real weight-drift signal is the separate `weight-drift-detector` backlog item; reintroducing a drift card belongs there.)

- [ ] **Step 1: Drop `driftPercent` from the schema**

In `src/schema.graphql`, change `PortfolioSummary` to:
```graphql
type PortfolioSummary @aws_cognito_user_pools @aws_iam {
  totalValueCents: Int!
  cashBalanceCents: Int!
  positionCount: Int!
  updatedAt: String!
}
```

- [ ] **Step 2: Remove papering + drift in the aggregate resolver**

Read `src/graphql/js-function/get-dashboard.fn.js`. In the `response`, replace the `portfolioSummary` object build (currently `totalValueCents: rawPs.totalValueCents || 0`, `cashBalanceCents: … || 0`, `positionCount: … || 0`, `driftPercent: … || 0`) so it (a) drops `driftPercent` and (b) returns `null` when the row is absent (mirroring the existing `investorSnapshot` null-gate), keeping the raw values when present:
```js
  const portfolioSummary = rawPs && rawPs.sk
    ? {
        totalValueCents: rawPs.totalValueCents,
        cashBalanceCents: rawPs.cashBalanceCents,
        positionCount: rawPs.positionCount,
        updatedAt: rawPs.updatedAt,
      }
    : null;
```
Then use `portfolioSummary` in the returned `Dashboard` object. Leave `advisoryStatus.pendingDecisionsCount || 0` intact (deferred-to-w3 carry-over). Adjust to the file's actual variable names (`rawPs`/`raw`/`item`) as written.

- [ ] **Step 3: Verify no `driftPercent` / structural-zero papering remains for PortfolioSummary**

Run: `grep -n "driftPercent\|totalValueCents || 0\|cashBalanceCents || 0\|positionCount || 0" services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js`
Expected: no matches.

- [ ] **Step 4: Remove `driftPercent` from the dashboard MFE**

- `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts`: remove the `driftPercent` selection from the `portfolioSummary` block.
- `apps/dashboard-mfe/src/app/stores/dashboard.store.ts`: remove `driftPercent: number;` from the `PortfolioSummary` interface.
- `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts`: remove the drift KPI card `<div>` (the line rendering `portfolioSummary?.driftPercent`).
- The three specs (`test/app/stores/dashboard.store.spec.ts`, `test/app/dashboard/kpi-cards.component.spec.ts`): remove `driftPercent` from fixtures + any assertion on the drift card.

- [ ] **Step 5: Run the dashboard-bff unit suite + dashboard-mfe tests**

Run: `pnpm nx test dashboard-bff` and `pnpm nx test dashboard-mfe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js apps/dashboard-mfe/src/app apps/dashboard-mfe/test/app
git commit -m "refactor(dashboard): drop unwritten driftPercent KPI + remove read-resolver || 0 papering"
```

---

## Task 6: Rewrite the read-model-projection integration test

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts`

> The existing `dashboard-bff.integration.test.ts` uses `createIntegrationTestContext()` + `EventBridgeClient.putEvent({ bus, targetService, detailType, detail })` + `TableAssertions.waitForItem`. Mirror that harness exactly (NOT a hand-rolled `publishAndWait`).

- [ ] **Step 1: Replace the placeholder with version-guard assertions**

Overwrite `test/integration/read-model-projection.integration.test.ts`:
```ts
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
} from '@nestfolio/integration-testing';

const snapshotDetail = (lastEventSequence: number, cashBalanceCents: number) => ({
  cashBalanceCents,
  snapshot: {
    cashBalanceCents,
    lastEventSequence,
    positions: {
      AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    },
  },
});

describe('dashboard-bff read-model projection (w2)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  const publish = (seq: number, cash: number) =>
    eb.putEvent({
      bus: 'investor',
      targetService: 'dashboard-bff',
      detailType: 'BALANCE_UPDATED',
      detail: snapshotDetail(seq, cash),
    });

  it('projects a full PortfolioSummary row — no structural zeros, no double-count', async () => {
    await publish(7, 5000);
    const row = await table.waitForItem({
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      sk: 'PortfolioSummary',
      timeoutMs: 60_000,
      predicate: (i) => i['__version'] === 7,
    });
    expect(row['cashBalanceCents']).toBe(5000);
    expect(row['positionCount']).toBe(1);
    expect(row['totalValueCents']).toBe(155000); // 5000 + 10*150*100
  }, 120_000);

  it('drops a stale (lower-version) snapshot and keeps the newest', async () => {
    await publish(20, 9999);
    await table.waitForItem({
      table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PortfolioSummary',
      timeoutMs: 60_000, predicate: (i) => i['__version'] === 20,
    });

    await publish(3, 1111); // stale → must be dropped
    await new Promise((r) => setTimeout(r, 6_000));
    for (let i = 0; i < 6; i++) {
      const item = await table.waitForItem({ table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PortfolioSummary', timeoutMs: 30_000 });
      expect(item['__version']).toBe(20);
      expect(item['cashBalanceCents']).toBe(9999);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }, 180_000);

  it('projects one versioned PositionSnapshot row per holding', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'dashboard-bff',
      detailType: 'PORTFOLIO_UPDATED',
      detail: snapshotDetail(25, 5000),
    });
    const aapl = await table.waitForItem({
      table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PositionSnapshot#AAPL',
      timeoutMs: 60_000, predicate: (i) => i['__version'] === 25,
    });
    expect(aapl['marketValueCents']).toBe(150000);
    expect(aapl['quantity']).toBe(10);
  }, 120_000);
});
```

- [ ] **Step 2: Run after the closing-phase deploy (see below)**

Integration tests run against deployed dev. Defer running until the closing-phase deploy. Command:
```bash
pnpm nx run dashboard-bff:test-integration
```
Expected: PASS (3 tests). (If `predicate`/`waitForItem` option names differ from those in `dashboard-bff.integration.test.ts`, align to that file's actual API.)

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts
git commit -m "test(dashboard-bff): assert version-guarded full-row projection + stale-drop"
```

---

## Task 7: Service card + carry-over docs + parking item

**Files:**
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `docs/backlog/bff-readmodel-w3-advisory-decision-packet.md`
- Modify: `docs/backlog/bff-readmodel-w4-investor-bff.md`
- (via `backlog-add`) Create: `docs/backlog/dashboard-position-orphan-on-sell.md`

- [ ] **Step 1: Update the service card**

In `services/investor/dashboard-bff/CLAUDE.md`: describe `portfolio-summary.ts` + `position-snapshot.ts` as version-guarded P1 projections from the ledger snapshot; add a "Read model" section noting `ReadModelOwnership` registers `PortfolioSummary`/`PositionSnapshot` (P1) + `Activity` (P2), with `InvestorSnapshot`/`AdvisoryStatus` as documented carry-overs; note the dead `SimulationSummary`/`StreamSnapshot` writers were removed and `driftPercent` dropped.

- [ ] **Step 2: Add carry-over notes to the w3 and w4 dossiers**

- `docs/backlog/bff-readmodel-w3-advisory-decision-packet.md` body: "Carry-over from w2: `AdvisoryStatus` in-flight count remains an `accumulate` counter (NOT registered in `ReadModelOwnership`); this workstream lands the real P3 derivation over the authoritative `DecisionPacket` rows it projects."
- `docs/backlog/bff-readmodel-w4-investor-bff.md` body: "Carry-over from w2: dashboard-bff's `InvestorSnapshot` stays on `project()` and is unregistered until investor-bff stamps `__version` on `INVESTOR_PROFILE_*` with a stable `onboardedAt`; this workstream then migrates dashboard's `InvestorSnapshot` to `projectVersioned` P1 and registers it."

- [ ] **Step 3: File the orphan-position parking item**

Invoke the `backlog-add` skill: id `dashboard-position-orphan-on-sell`, type `bug`, status `parking`, noting a fully-sold holding leaves a stale `PositionSnapshot#<symbol>` row (shared with the ledger-bff `Position` projection from w1; pre-existing, not introduced by w2). State in chat what was filed; continue.

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/CLAUDE.md docs/backlog/bff-readmodel-w3-advisory-decision-packet.md docs/backlog/bff-readmodel-w4-investor-bff.md docs/backlog/dashboard-position-orphan-on-sell.md docs/BACKLOG.md
git commit -m "docs(dashboard-bff): regen service card + w3/w4 carry-overs + orphan-position parking"
```

---

## Closing phase (run via /backlog-next Step 6 after all tasks pass)

1. **nx affected verify:** `pnpm nx affected -t test,lint --base=origin/main` — must pass before deploy.
2. **Deploy dev:** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff` (handler bundle + AppSync resolvers + schema changed; subscriptions unchanged — no new event types).
3. **Integration:** `pnpm nx run dashboard-bff:test-integration` (runs Task 6).
4. **Scoped e2e (NOT full suite, NOT Playwright):** run only the dashboard/portfolio-touching `apps/e2e-feature-tests` scenarios — candidates surfaced during research: `src/advisory/accept-decision.e2e.test.ts`, `src/advisory/reconciliation-correction.e2e.test.ts`, `src/funding/withdraw-cash.e2e.test.ts`, `src/account/request-closure.e2e.test.ts` (all assert `totalValueCents`/`cashBalanceCents`/`positionCount`). Pick the subset that touch dashboard read rows. If any fails-then-passes on rerun, pull CloudWatch evidence from the failing window and run a second confirmation pass before continuing.
5. Fill `validation_gate` in `docs/backlog/bff-readmodel-w2-dashboard-bff.md` with commit SHAs + integ/e2e output, set `status: shipped`, regen the index, then route to `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage** (spec §"Decomposition" item 2 + §"Per-row classification"):
- P1 `PortfolioSummary` from authoritative snapshot, full-row, no `accumulate` → Task 1. ✓
- P1 `PositionSnapshot` from authoritative snapshot → Task 2. ✓
- `InvestorSnapshot` → P1: deferred to w4 (documented Task 7) per user decision. ✓ (documented, not silent)
- `AdvisoryStatus` count → P3: deferred to w3 (documented Task 7) per user decision. ✓
- Delete dead `SimulationSummary`/`StreamSnapshot` repository writers → Task 4. ✓
- Register typenames in `ReadModelOwnership` → Task 3. ✓
- Remove `|| 0` read-resolver papering → Task 5. ✓
- `event-processor:typecheck` + integration green; deploy + scoped dashboard e2e green → Closing phase. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type/value consistency:**
- `projectVersioned(typename, fields, { version, overrides })` matches the w0 overload-1 signature in every task. ✓
- `positions` treated as `Record<string,…>` everywhere (`Object.keys`/`Object.values`/`Object.entries`) — matches `snapshot-to-events.ts` + `PositionState`. ✓
- Cents computed from dollar fields consistently (`round(quantity*lastFillPrice*100)` etc.) in transform + tests; test values recomputed (totalValueCents 205000 unit / 155000 integration; weights 75/25; unrealizedPnl 50000/−50000). ✓
- Ownership file at `src/read-model-ownership.ts` imported via `../read-model-ownership` from `src/handlers/event-listener.ts` — matches the ledger-bff convention. ✓
- `portfolioSummary` returns `WriteIntent | undefined`; `positionSnapshot` returns `WriteIntent[]`; handler flattens with spread (Task 2 Step 4). ✓
