# dashboard-bff read-model materialization (workstream 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate dashboard-bff's `PortfolioSummary` and `PositionSnapshot` read rows to version-guarded P1 projections sourced from the authoritative ledger snapshot, register ownership, delete dead writers, and remove the read-resolver `|| 0` papering — dissolving the structural-zero + `totalValueCents` double-count bug faces by construction.

**Architecture:** dashboard-bff currently rebuilds `PortfolioSummary`/`PositionSnapshot` field-by-field from order-fill-shaped fields (`accumulate` + `project`), ignoring the ledger snapshot — which is why `cashBalanceCents`/`positionCount` are never written. This workstream re-sources both rows from the same `payload.snapshot.{cashBalanceCents, positions, lastEventSequence}` envelope that ledger-bff (w1) already projects in `services/ledger/ledger-bff/src/handlers/ledger-projector.ts`, writing full rows guarded by `lastEventSequence` as `__version` via the `projectVersioned` P1 primitive shipped in w0.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (`projectVersioned`, `materializeToTable`, `toUow`, `ReadModelOwnership` declaration-merging registry), DynamoDB single-table, AppSync JS resolvers, Jest (`@nestfolio/test-support` `IntegrationTestHarness` + `publishAndWait`), Nx.

---

## Scope (this workstream)

In:
- `PortfolioSummary` → P1 `projectVersioned` from ledger snapshot (`cashBalanceCents`, `positionCount = positions.length`, `totalValueCents = cashBalanceCents + Σ position.marketValueCents`, `version = lastEventSequence`).
- `PositionSnapshot` → P1 `projectVersioned`, one row per holding, from `snapshot.positions[]`.
- `ReadModelOwnership` registration for `PortfolioSummary`, `PositionSnapshot` (both `Projection<'P1'>`) and `Activity` (`Projection<'P2'>`).
- Delete dead `SimulationSummary` / `StreamSnapshot` repository writers (zero callers).
- Remove `driftPercent` from `PortfolioSummary` (zero consumers repo-wide; not in the ledger snapshot; violates single-producer P1) and remove the `|| 0` read-resolver papering.
- Rewrite the `read-model-projection` integration test to assert version-guarded full-row projection + stale-drop + structural-zeros-gone.

## Out of scope (carry-overs — file/note, do NOT implement here)

- **`InvestorSnapshot` → P1 deferred to w4.** Its producer (investor-bff) does not stamp a version, and a full-row P1 write would wipe `onboardedAt` on `INVESTOR_PROFILE_UPDATED` (only set on CREATED). Both the producer `__version` stamping and the dashboard-side migration belong to w4 when investor-bff is migrated. `InvestorSnapshot` stays on `project()` and is NOT registered in the ownership map this workstream (registering it as P1 would force the unsafe migration). → Add carry-over note to `docs/backlog/bff-readmodel-w4-investor-bff.md` (Task 8).
- **`AdvisoryStatus` → P3 deferred to w3.** A true P3 derived count needs an authoritative set of decision rows to count over; those arrive when w3 emits versioned `DecisionPacket` snapshots that dashboard projects. The `accumulate` counter stays in place for w2 and is NOT registered in the ownership map (registering as P3 would break `accumulate`). → Add carry-over note to `docs/backlog/bff-readmodel-w3-advisory-decision-packet.md` (Task 8).
- **Orphan position rows on sell.** A `PositionSnapshot#<symbol>` row for a fully-sold holding is no longer in `snapshot.positions[]`, so it is never overwritten and persists stale. This is a pre-existing limitation of the w1 reference (`ledger-projector.ts` `Position` projection has the identical behavior), NOT introduced here. → File a parking item via `backlog-add` (Task 8) shared with ledger-bff; do not fix here.
- Live-push transport (`dashboard-live-push-*`) — deferred, rebuilt on this clean read model afterward.
- `TimeTravelAvailability` — stays on `project()`, untouched.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` | Project `PortfolioSummary` full row from ledger snapshot | Rewrite (Task 1) |
| `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` | Project one `PositionSnapshot` per holding from ledger snapshot | Rewrite (Task 2) |
| `services/investor/dashboard-bff/src/handlers/event-listener.ts` | Route events; flatten the per-position intent array | Modify (Task 2) |
| `services/investor/dashboard-bff/src/handlers/read-model-ownership.ts` | Declare ownership tags for dashboard typenames | Create (Task 3) |
| `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts` | Read-model repo; remove dead writers | Modify (Task 4) |
| `services/investor/dashboard-bff/src/schema.graphql` | GraphQL types; drop `driftPercent` | Modify (Task 5) |
| `services/investor/dashboard-bff/src/graphql/resolvers/Query.getDashboard.js` | Aggregate resolver; remove `|| 0` papering + `driftPercent` | Modify (Task 5) |
| `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts` | Unit-test the rewritten transform | Rewrite (Task 1) |
| `services/investor/dashboard-bff/test/unit/transforms/position-snapshot.test.ts` | Unit-test the rewritten transform | Rewrite (Task 2) |
| `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts` | Handler routing/shape assertions | Modify (Task 2) |
| `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts` | Version-guard + stale-drop + structural-zero assertions | Rewrite (Task 6) |
| `services/investor/dashboard-bff/CLAUDE.md` | Service card | Modify (Task 8) |

---

## Reference snippets (read before starting)

**w0 `projectVersioned` signature** (`libs/event-processor/src/intents/project-versioned.ts`), overload used here:
```ts
projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fields: Record<string, unknown>,
  opts: { version: number; overrides?: KeyOverrides },
): ProjectVersionedIntent;
```
Writes the FULL row guarded by `attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version < :version`. Stale/duplicate → dropped (deduplicated), not redriven.

**w1 reference** (`services/ledger/ledger-bff/src/handlers/ledger-projector.ts`): reads `extractSnapshot(payload)` (`payload.snapshot ?? payload`), `versionOf` = `Number(snapshot.lastEventSequence ?? 0)`, then `projectVersioned('PortfolioLatest', { cashBalanceCents, positions }, { version, overrides: { sk } })`.

**Ledger snapshot position shape** (`services/ledger/ledger-ctrl/src/handlers/snapshot-projector.ts:9-23`): each `Position` = `{ symbol, quantity, avgCostBasisCents, currentPriceCents, marketValueCents, costBasisCents, unrealizedPnlCents }`. (`assetClass` and `weightPercent` are NOT present — defaulted/derived in the transform.)

**Cross-domain integration publish pattern** (`services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`):
```ts
await publishAndWait(ctx, {
  source: 'integration-test:dashboard-bff',
  detailType: LedgerCrossDomainEventTypes.BALANCE_UPDATED,
  detail: { context: { tenantId, userId: 'u-1', region: 'us-east-1' }, subject: { /* snapshot */ } },
});
```

---

## Task 1: Rewrite `portfolio-summary` transform to versioned snapshot projection

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/portfolio-summary.test.ts`

- [ ] **Step 1: Replace the unit test with the new expected behavior**

Overwrite `test/unit/transforms/portfolio-summary.test.ts` with:
```ts
import { portfolioSummary } from '../../../src/transforms/portfolio-summary';
import { toUow } from '@nestfolio/event-processor';

type Ctx = Parameters<typeof toUow>[1];

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  ...(over as Record<string, unknown>),
});

const ev = (type: string, subject: Record<string, unknown>) =>
  toUow({ type, subject, id: 'e-1', timestamp: '2026-01-01T00:00:00Z' }, ctx());

const snapshot = {
  cashBalanceCents: 5000,
  positions: [
    { symbol: 'AAPL', quantity: 10, avgCostBasisCents: 1000, currentPriceCents: 1500, marketValueCents: 15000, costBasisCents: 10000, unrealizedPnlCents: 5000 },
    { symbol: 'MSFT', quantity: 2, avgCostBasisCents: 2000, currentPriceCents: 3000, marketValueCents: 6000, costBasisCents: 4000, unrealizedPnlCents: 2000 },
  ],
  lastEventSequence: 7,
};

describe('portfolioSummary transform', () => {
  it('projects a versioned full PortfolioSummary row from a ledger snapshot', () => {
    const intent = portfolioSummary(ev('PORTFOLIO_UPDATED', { snapshot }));
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: {
        tenantId: 't-1',
        userId: 'u-1',
        region: 'us-east-1',
        cashBalanceCents: 5000,
        positionCount: 2,
        totalValueCents: 26000, // 5000 cash + 15000 + 6000 market value
      },
      version: 7,
      overrides: { pk: 'T#t-1', sk: 'PortfolioSummary' },
    });
  });

  it('accepts a bare snapshot payload (no `snapshot` wrapper)', () => {
    const intent = portfolioSummary(ev('BALANCE_UPDATED', { ...snapshot }));
    expect(intent).toMatchObject({ _tag: 'projectVersioned', version: 7 });
  });

  it('returns undefined when no snapshot is present', () => {
    expect(portfolioSummary(ev('RECONCILIATION_COMPLETED', { foo: 'bar' }))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff --testPathPatterns=portfolio-summary`
Expected: FAIL — current transform returns `accumulate`/`project`/`undefined`, not `projectVersioned`.

- [ ] **Step 3: Rewrite the transform**

Overwrite `src/transforms/portfolio-summary.ts` with:
```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = { marketValueCents?: number; [k: string]: unknown };
type LedgerSnapshot = {
  cashBalanceCents?: number;
  positions?: LedgerPosition[];
  lastEventSequence?: number;
};

/**
 * Projects the PortfolioSummary read row from the authoritative ledger snapshot
 * carried on BALANCE_UPDATED / PORTFOLIO_UPDATED (and any other snapshot-bearing
 * event). Full-row, version-guarded write keyed on `lastEventSequence` — fixes
 * the cashBalanceCents/positionCount structural zeros and the totalValueCents
 * double-count by construction (no more `accumulate`). See
 * docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const portfolioSummary = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;

  if (!snapshot || snapshot.cashBalanceCents === undefined) return undefined;

  const positions = snapshot.positions ?? [];
  const positionMarketValueCents = positions.reduce(
    (sum, p) => sum + (p.marketValueCents ?? 0),
    0,
  );

  return projectVersioned(
    'PortfolioSummary',
    {
      tenantId,
      userId,
      region,
      cashBalanceCents: snapshot.cashBalanceCents,
      positionCount: positions.length,
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

Overwrite `test/unit/transforms/position-snapshot.test.ts` with:
```ts
import { positionSnapshot } from '../../../src/transforms/position-snapshot';
import { toUow } from '@nestfolio/event-processor';

type Ctx = Parameters<typeof toUow>[1];

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  tenantId: 't-1',
  userId: 'u-1',
  region: 'us-east-1',
  ...(over as Record<string, unknown>),
});

const ev = (type: string, subject: Record<string, unknown>) =>
  toUow({ type, subject, id: 'e-1', timestamp: '2026-01-01T00:00:00Z' }, ctx());

const snapshot = {
  lastEventSequence: 9,
  positions: [
    { symbol: 'AAPL', quantity: 10, avgCostBasisCents: 1000, currentPriceCents: 1500, marketValueCents: 15000, costBasisCents: 10000, unrealizedPnlCents: 5000 },
    { symbol: 'MSFT', quantity: 2, avgCostBasisCents: 2000, currentPriceCents: 3000, marketValueCents: 5000, costBasisCents: 4000, unrealizedPnlCents: 1000 },
  ],
};

describe('positionSnapshot transform', () => {
  it('emits one versioned PositionSnapshot intent per holding with derived weightPercent', () => {
    const intents = positionSnapshot(ev('PORTFOLIO_UPDATED', { snapshot }));
    expect(intents).toHaveLength(2);
    expect(intents[0]).toEqual({
      _tag: 'projectVersioned',
      typename: 'PositionSnapshot',
      fields: {
        tenantId: 't-1',
        userId: 'u-1',
        region: 'us-east-1',
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        quantity: 10,
        avgCostBasisCents: 1000,
        currentPriceCents: 1500,
        marketValueCents: 15000,
        weightPercent: 75, // 15000 / (15000 + 5000) * 100
        unrealizedPnlCents: 5000,
      },
      version: 9,
      overrides: { pk: 'T#t-1', sk: 'PositionSnapshot#AAPL' },
    });
    expect(intents[1]).toMatchObject({ overrides: { sk: 'PositionSnapshot#MSFT' }, fields: { weightPercent: 25 } });
  });

  it('returns an empty array when the snapshot has no positions', () => {
    expect(positionSnapshot(ev('BALANCE_UPDATED', { snapshot: { positions: [], lastEventSequence: 1 } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff --testPathPatterns=position-snapshot`
Expected: FAIL — current transform returns a single `project` intent.

- [ ] **Step 3: Rewrite the transform to return `WriteIntent[]`**

Overwrite `src/transforms/position-snapshot.ts` with:
```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = {
  symbol?: string;
  instrument?: string;
  assetClass?: string;
  quantity?: number;
  avgCostBasisCents?: number;
  currentPriceCents?: number;
  marketValueCents?: number;
  unrealizedPnlCents?: number;
};
type LedgerSnapshot = { positions?: LedgerPosition[]; lastEventSequence?: number };

/**
 * Projects one PositionSnapshot row per holding from the authoritative ledger
 * snapshot. Full-row, version-guarded writes keyed on `lastEventSequence`.
 * `assetClass` defaults to EQUITY (absent from the ledger snapshot) and
 * `weightPercent` is derived from each holding's share of total market value.
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const positionSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
  const positions = snapshot?.positions ?? [];
  if (positions.length === 0) return [];

  const version = Number(snapshot?.lastEventSequence ?? 0);
  const totalMarketValueCents = positions.reduce((sum, p) => sum + (p.marketValueCents ?? 0), 0);

  return positions.flatMap((pos) => {
    const symbol = pos.symbol ?? pos.instrument;
    if (!symbol) return [];
    const marketValueCents = pos.marketValueCents ?? 0;
    return [
      projectVersioned(
        'PositionSnapshot',
        {
          tenantId,
          userId,
          region,
          symbol,
          assetClass: pos.assetClass ?? 'EQUITY',
          quantity: pos.quantity ?? 0,
          avgCostBasisCents: pos.avgCostBasisCents ?? 0,
          currentPriceCents: pos.currentPriceCents ?? 0,
          marketValueCents,
          weightPercent: totalMarketValueCents > 0 ? (marketValueCents / totalMarketValueCents) * 100 : 0,
          unrealizedPnlCents: pos.unrealizedPnlCents ?? 0,
        },
        { version, overrides: { pk: `T#${tenantId}`, sk: `PositionSnapshot#${symbol}` } },
      ),
    ];
  });
};
```

- [ ] **Step 4: Update the event-listener handler to flatten the per-position array**

In `src/handlers/event-listener.ts`, change the `PORTFOLIO_UPDATED` branch (currently spreads three single intents) so the `positionSnapshot` array is flattened. Replace the `[LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]` entry with:
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
(The `BALANCE_UPDATED` and `RECONCILIATION_COMPLETED` branches already only use `portfolioSummary`, which still returns a single `WriteIntent | undefined` — leave them unchanged.)

- [ ] **Step 5: Update the event-listener unit test for the new position-snapshot shape**

In `test/unit/handlers/event-listener.test.ts`, any assertion that `PORTFOLIO_UPDATED` produces a `positionSnapshot` `project` intent must expect a flattened list of `projectVersioned` `PositionSnapshot` intents (one per position) and a `projectVersioned` `PortfolioSummary` intent. Mirror the field shapes from Tasks 1 & 2. Run the test (Step 6) to surface exactly which assertions need updating, then update them to match.

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
- Create: `services/investor/dashboard-bff/src/handlers/read-model-ownership.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`

- [ ] **Step 1: Create the ownership augmentation file**

Mirror `services/ledger/ledger-bff/src/handlers/read-model-ownership.ts`. Create `src/handlers/read-model-ownership.ts`:
```ts
import type { Projection } from '@nestfolio/event-processor';

/**
 * Read-model ownership augmentation for dashboard-bff (workstream 2).
 *
 * Declares ownership tags so the event-processor write-intent factories enforce
 * at compile time that these rows are written only through their allowed intents:
 *   - PortfolioSummary / PositionSnapshot : P1 → projectVersioned only
 *     (accumulate/project/update now fail to typecheck).
 *   - Activity : P2 append-log → record only.
 *
 * NOT registered (intentional carry-overs, see the w2 plan "Out of scope"):
 *   - InvestorSnapshot → P1 deferred to w4 (producer __version + onboardedAt).
 *   - AdvisoryStatus → P3 deferred to w3 (needs authoritative decision rows).
 *   - TimeTravelAvailability → untouched.
 *
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    Activity: Projection<'P2'>;
  }
}
```

- [ ] **Step 2: Side-effect import it from the handler entrypoint**

In `src/handlers/event-listener.ts`, add this import at the top of the import block (mirroring ledger-bff, which imports its ownership file from its handler):
```ts
import './read-model-ownership';
```

- [ ] **Step 3: Run the event-processor typecheck to verify enforcement holds**

Run: `pnpm nx run dashboard-bff:typecheck`
(If dashboard-bff has no `typecheck` target, use `pnpm nx run event-processor:typecheck` per the dossier "Done" definition and `pnpm exec tsc -p services/investor/dashboard-bff/tsconfig.json --noEmit`.)
Expected: PASS — the transforms migrated in Tasks 1–2 already use `projectVersioned`, so registering them as P1 typechecks cleanly.

- [ ] **Step 4: Prove the guard actually fires (negative check, then revert)**

Temporarily edit `src/transforms/portfolio-summary.ts` to `import { accumulate }` and return `accumulate('PortfolioSummary', { field: 'totalValueCents', increment: 1 })`. Run the typecheck (Step 3 command). Expected: FAIL — `Argument of type '"PortfolioSummary"' is not assignable to parameter of type 'never'` (RejectProjection). Then `git checkout services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` to revert. This step produces no commit — it only confirms the registration is load-bearing.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/read-model-ownership.ts services/investor/dashboard-bff/src/handlers/event-listener.ts
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
Expected: matches ONLY inside `dashboard.repository.ts` (the definitions themselves). If any other src file references them, STOP — they are not dead; re-scope.

- [ ] **Step 2: Delete the four methods**

In `src/repositories/dashboard.repository.ts`, remove the `upsertStreamSnapshot`, `getStreamSnapshot`, `upsertSimulationSummary`, and `getSimulationSummary` method definitions (the `// --- Simulation Summary ---` block, repo lines ~496–591). Leave all other methods untouched.

- [ ] **Step 3: Remove any dead-method assertions from the repository unit test**

Run: `grep -n "SimulationSummary\|StreamSnapshot" services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts`
Delete any test cases exercising the removed methods.

- [ ] **Step 4: Run the repository unit test**

Run: `pnpm nx test dashboard-bff --testPathPatterns=dashboard.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/repositories/dashboard.repository.ts services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts
git commit -m "refactor(dashboard-bff): delete dead SimulationSummary/StreamSnapshot writers"
```

---

## Task 5: Remove `driftPercent` + the `|| 0` read-resolver papering

**Files:**
- Modify: `services/investor/dashboard-bff/src/schema.graphql`
- Modify: `services/investor/dashboard-bff/src/graphql/resolvers/Query.getDashboard.js`

- [ ] **Step 1: Confirm `driftPercent` has no consumers**

Run:
```bash
grep -rn "driftPercent" services apps libs | grep -v node_modules
```
Expected: matches ONLY in dashboard-bff `schema.graphql` + `Query.getDashboard.js` (and the now-rewritten transform/tests, which no longer reference it). If a frontend/app consumer appears, STOP and ask before removing.

- [ ] **Step 2: Drop `driftPercent` from the schema**

In `src/schema.graphql`, change the `PortfolioSummary` type to:
```graphql
type PortfolioSummary {
  totalValueCents: Int!
  cashBalanceCents: Int!
  positionCount: Int!
}
```

- [ ] **Step 3: Rewrite the resolver response to remove papering + drift, and null-gate the summary**

In `src/graphql/resolvers/Query.getDashboard.js`, replace the `portfolioSummary` block in the `return` of `response(ctx)` with a null-when-absent shape (mirroring the existing `investorSnapshot` pattern), and remove the `driftPercent` line:
```js
    portfolioSummary: portfolio.sk
      ? {
          totalValueCents: portfolio.totalValueCents,
          cashBalanceCents: portfolio.cashBalanceCents,
          positionCount: portfolio.positionCount,
        }
      : null,
```
Rationale: with the full-row P1 projection, a `PortfolioSummary` row always carries all three fields once it exists, so per-field `|| 0` papering is no longer needed; an absent row (new tenant, no `BALANCE_UPDATED` yet) returns `null` (the `Dashboard.portfolioSummary` field is already nullable in the schema), which is the correct CQRS empty-state.

- [ ] **Step 4: Verify no `|| 0` papering remains for these fields**

Run: `grep -n "|| 0\|driftPercent" services/investor/dashboard-bff/src/graphql/resolvers/Query.getDashboard.js`
Expected: no matches for `driftPercent`; the only remaining `|| 0` (if any) is `advisoryStatus.pendingDecisionsCount || 0`, which is the deferred-to-w3 carry-over and is left intact.

- [ ] **Step 5: Run the full dashboard-bff unit suite**

Run: `pnpm nx test dashboard-bff`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/schema.graphql services/investor/dashboard-bff/src/graphql/resolvers/Query.getDashboard.js
git commit -m "refactor(dashboard-bff): drop unwritten driftPercent + remove read-resolver || 0 papering"
```

---

## Task 6: Rewrite the read-model-projection integration test

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts`

- [ ] **Step 1: Replace the placeholder with real version-guard assertions**

Overwrite `test/integration/read-model-projection.integration.test.ts`:
```ts
import {
  IntegrationTestHarness,
  publishAndWait,
  type TestContext,
} from '@nestfolio/test-support';
import { DashboardRepository } from '../../src/repositories/dashboard.repository';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';

const snapshot = (lastEventSequence: number, cashBalanceCents: number) => ({
  cashBalanceCents,
  lastEventSequence,
  positions: [
    { symbol: 'AAPL', quantity: 10, avgCostBasisCents: 1000, currentPriceCents: 1500, marketValueCents: 15000, costBasisCents: 10000, unrealizedPnlCents: 5000 },
  ],
});

describe('dashboard-bff read-model projection (w2)', () => {
  const harness = new IntegrationTestHarness('dashboard-bff');
  let ctx: TestContext;
  let repo: DashboardRepository;

  beforeAll(async () => {
    ctx = await harness.setup();
    repo = new DashboardRepository(ctx.tableName, ctx.client);
  });

  afterAll(async () => {
    await harness.teardown();
  });

  const publishSnapshot = (seq: number, cash: number) =>
    publishAndWait(ctx, {
      source: 'integration-test:dashboard-bff',
      detailType: LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED,
      detail: {
        context: { tenantId: ctx.tenantId, userId: 'u-1', region: 'us-east-1' },
        subject: { snapshot: snapshot(seq, cash) },
      },
    });

  it('projects a full PortfolioSummary row — no structural zeros, no double-count', async () => {
    await publishSnapshot(7, 5000);
    const row = await repo.getPortfolioSummary(ctx.tenantId);
    expect(row?.cashBalanceCents).toBe(5000);
    expect(row?.positionCount).toBe(1);
    expect(row?.totalValueCents).toBe(20000); // 5000 + 15000, NOT accumulated
    expect(row?.__version).toBe(7);
  });

  it('projects one PositionSnapshot row per holding', async () => {
    await publishSnapshot(8, 5000);
    const positions = await repo.getPositionSnapshots(ctx.tenantId);
    const aapl = positions.find((p) => p.symbol === 'AAPL');
    expect(aapl?.marketValueCents).toBe(15000);
    expect(aapl?.__version).toBe(8);
  });

  it('drops a stale (lower-version) snapshot', async () => {
    await publishSnapshot(20, 9999);
    await publishSnapshot(3, 1111); // stale → must be dropped
    const row = await repo.getPortfolioSummary(ctx.tenantId);
    expect(row?.cashBalanceCents).toBe(9999);
    expect(row?.__version).toBe(20);
  });
});
```

- [ ] **Step 2: Run the integration test (after the Task-7 deploy, see below)**

Integration tests run against deployed dev. Defer running this until the closing-phase deploy (Task 7). Command:
```bash
pnpm nx run dashboard-bff:test-integration
```
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts
git commit -m "test(dashboard-bff): assert version-guarded full-row projection + stale-drop"
```

---

## Task 7: Service card + carry-over documentation + parking item

**Files:**
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `docs/backlog/bff-readmodel-w3-advisory-decision-packet.md`
- Modify: `docs/backlog/bff-readmodel-w4-investor-bff.md`
- (via `backlog-add`) Create: parking item for orphan position rows

- [ ] **Step 1: Update the service card Transforms section**

In `services/investor/dashboard-bff/CLAUDE.md`, update the Transforms section so `portfolio-summary.ts` and `position-snapshot.ts` are described as version-guarded P1 projections from the ledger snapshot (no longer "unchanged"), note the ownership registration, and note the dead `SimulationSummary`/`StreamSnapshot` writers were removed.

- [ ] **Step 2: Add carry-over notes to the w3 and w4 dossiers**

- In `docs/backlog/bff-readmodel-w3-advisory-decision-packet.md` body, add a line under scope: "Carry-over from w2: `AdvisoryStatus` in-flight count remains an `accumulate` counter (NOT registered in `ReadModelOwnership`); this workstream lands the real P3 derivation over the authoritative `DecisionPacket` rows it projects."
- In `docs/backlog/bff-readmodel-w4-investor-bff.md` body, add: "Carry-over from w2: `InvestorSnapshot` stays on `project()` and is unregistered until investor-bff stamps `__version` on `INVESTOR_PROFILE_*` and the producer carries a stable `onboardedAt`; this workstream migrates `InvestorSnapshot` to `projectVersioned` P1 and registers it."

- [ ] **Step 3: File the orphan-position parking item**

Invoke the `backlog-add` skill to create a parking item: id `dashboard-position-orphan-on-sell`, type `bug`, noting that a fully-sold holding leaves a stale `PositionSnapshot#<symbol>` row (shared with the ledger-bff `Position` projection from w1; pre-existing, not introduced by w2). State briefly in chat what was filed and continue.

- [ ] **Step 4: Commit the doc changes**

```bash
git add services/investor/dashboard-bff/CLAUDE.md docs/backlog/bff-readmodel-w3-advisory-decision-packet.md docs/backlog/bff-readmodel-w4-investor-bff.md docs/BACKLOG.md docs/backlog/dashboard-position-orphan-on-sell.md
git commit -m "docs(dashboard-bff): regen service card + w3/w4 carry-overs + orphan-position parking"
```

---

## Closing phase (run via /backlog-next Step 6 after all tasks pass)

1. **nx affected verify:** `pnpm nx affected -t test,lint --base=origin/main` — must pass before deploy.
2. **Deploy dev:** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=dashboard-bff` (dashboard-bff ingress subscriptions unchanged — no new event types added — but the handler bundle + resolvers changed, so a deploy is required).
3. **Integration:** `pnpm nx run dashboard-bff:test-integration` (runs Task 6).
4. **Scoped e2e (NOT full suite, NOT Playwright):** run only the dashboard-touching `apps/e2e-feature-tests` scenarios (the dashboard / portfolio-summary / holdings scenarios) against deployed dev. If any scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window and run a second confirmation pass before continuing.
5. Fill `validation_gate` in `docs/backlog/bff-readmodel-w2-dashboard-bff.md` with the commit SHAs + integ/e2e command output, set `status: shipped`, regen the index, then route to `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage** (spec §"Decomposition" item 2 + §"Per-row classification"):
- P1 `PortfolioSummary` from authoritative snapshot, full-row, no `accumulate` → Task 1. ✓ (fixes structural zeros + double-count)
- P1 `PositionSnapshot` from authoritative snapshot → Task 2. ✓
- `InvestorSnapshot` → P1: deliberately deferred to w4 (out-of-scope, documented Task 7) per user decision — the spec lists it under w2 but its producer-coupling (version + stable `onboardedAt`) belongs to w4. ✓ (documented gap, not silent)
- `AdvisoryStatus` count → P3: deferred to w3 (out-of-scope, documented Task 7) per user decision. ✓ (documented gap)
- Delete dead `SimulationSummary`/`StreamSnapshot` → Task 4. ✓
- Register typenames in `ReadModelOwnership` → Task 3. ✓
- Remove `|| 0` read-resolver papering → Task 5. ✓
- `event-processor:typecheck` + integration green; deploy + scoped dashboard e2e green → Closing phase. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `projectVersioned(typename, fields, { version, overrides })` matches the w0 overload-1 signature in every task; `portfolioSummary` returns `WriteIntent | undefined`, `positionSnapshot` returns `WriteIntent[]` (handler flattened in Task 2 Step 4); ownership keys `PortfolioSummary`/`PositionSnapshot`/`Activity` match the typenames passed to the intent factories. ✓
