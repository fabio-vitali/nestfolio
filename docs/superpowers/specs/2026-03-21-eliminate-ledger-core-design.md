# Eliminate ledger-core: Snapshot History Architecture

## Problem

`libs/ledger-core` is the only domain-specific shared library in the system. It creates coupling between `ledger-ctrl` (write-side) and `ledger-bff` (read-side) by sharing the `accountReducer`, `AccountState` types, and 6 command definitions. This violates two principles:

1. **Service boundary**: Every other BFF is a pure read-side projection. `ledger-bff` is the only one that contains domain logic (event replay via `accountReducer`).
2. **Independent deployability**: Changing the reducer requires coordinated releases of both services.

The coupling exists because both services replay events through the same reducer — `ledger-ctrl` for snapshot materialization (DDB Stream handler) and `ledger-bff` for time-travel queries (`getPortfolioAt`).

## Solution: Snapshot History Table

Instead of replaying events on-demand in the BFF, `ledger-ctrl` writes a snapshot history entry on every stream batch. The BFF queries pre-computed snapshots for time-travel — no reducer, no replay, no shared domain logic.

## Data Flow

### Current

```
DDB Stream → ledger-ctrl/reducer
  → Snapshot#latest (overwrite)
  → Checkpoint#date (daily)
  → publishes BALANCE_UPDATED / PORTFOLIO_UPDATED / LEDGER_ENTRY_RECORDED
  → ledger-bff/event-listener → pipes → BFF table (Portfolio#Latest, Position#, History#)

Time-travel (BFF): checkpoint → query history entries → filter by timestamp → replayEvents(accountReducer)
```

### Proposed

```
DDB Stream → ledger-ctrl/reducer
  → Snapshot#latest (overwrite, unchanged)
  → SnapshotAt#<timestamp> (NEW — append per batch)
  → publishes events (ENRICHED with snapshot state in payload)
  → ledger-bff/event-listener → pipes → BFF table (Portfolio#Latest, Position#, History#, SnapshotAt#<timestamp>)

Time-travel (BFF): query SnapshotAt# where sk <= target, ScanIndexForward=false, Limit=1 → return directly
```

## What Moves Where

### Into `ledger-ctrl/src/domain/`

All source files currently in `libs/ledger-core/src/`:

- `account-state.ts` — `AccountState`, `PositionState`, `INITIAL_ACCOUNT_STATE`
- `account.reducer.ts` — `accountReducer`
- `record-fill.ts`, `record-deposit.ts`, `record-withdrawal.ts`, `record-corporate-action.ts`, `submit-order.ts`, `cancel-order.ts` — command definitions with Zod schemas

All test files from `libs/ledger-core/test/` → `services/ledger/ledger-ctrl/test/domain/`

### In `ledger-bff`

- `TimeTravelService` — rewritten to a single DDB query (no `replayEvents`, no `accountReducer`)
- `graphql-resolver.ts` — inline default `cashBalanceCents: 10_000_000`, drop `INITIAL_ACCOUNT_STATE` import
- Zero imports from `@nestfolio/ledger-core` or `@nestfolio/command-core`

### Deleted

- `libs/ledger-core/` — entire library (source, tests, project.json, tsconfig)
- `@nestfolio/ledger-core` tsconfig path alias
- Nx project reference

## ledger-ctrl Changes

### Repository: `saveSnapshotHistory`

New method on `LedgerRepository`:

```ts
readonly saveSnapshotHistory = this.log('saveSnapshotHistory',
  async (
    tenantId: string,
    streamType: string,
    seq: number,
    state: Record<string, unknown>,
    ttlDays: number,
  ): Promise<void> => {
    const now = getTime();
    const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 86400);
    await this.put({
      pk: `Account#${tenantId}#${streamType}`,
      sk: `SnapshotAt#${now}`,
      __typename: 'SnapshotHistory',
      tenantId,
      streamType,
      timestamp: now,
      positions: (state as any).positions ?? {},
      cashBalanceCents: (state as any).cashBalanceCents ?? 0,
      lastEventSequence: seq,
      ttl,
    });
  },
);
```

### Reducer: append snapshot history

After `saveSnapshotWithEvents`, call `saveSnapshotHistory` with the computed `nextState` and `maxSeq`. Same data, additional append.

### Event enrichment

Published events (BALANCE_UPDATED, PORTFOLIO_UPDATED) include the full snapshot in payload:

```ts
{
  ...existingPayload,
  snapshot: {
    positions: nextState.positions,
    cashBalanceCents: nextState.cashBalanceCents,
    lastEventSequence: maxSeq,
  },
}
```

## ledger-bff Changes

### Repository: `getSnapshotAt` and `saveSnapshotAt`

```ts
readonly getSnapshotAt = this.log('getSnapshotAt',
  async (tenantId: string, timestamp: string): Promise<Record<string, unknown> | null> => {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND sk <= :ts',
      ExpressionAttributeValues: {
        ':pk': `SnapshotAt#${tenantId}`,
        ':ts': timestamp,
      },
      ScanIndexForward: false,
      Limit: 1,
    });
    return items[0] ?? null;
  },
);

readonly saveSnapshotAt = this.log('saveSnapshotAt',
  async (
    tenantId: string,
    timestamp: string,
    snapshot: CheckpointState,
    ttlDays: number,
  ): Promise<void> => {
    const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 86400);
    await this.put({
      pk: `SnapshotAt#${tenantId}`,
      sk: timestamp,
      __typename: 'SnapshotAt',
      tenantId,
      timestamp,
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
      ttl,
    });
  },
);
```

### TimeTravelService rewrite

```ts
export class TimeTravelService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getPortfolioAt(tenantId: string, targetTimestamp: string) {
    const snapshot = await this.repository.getSnapshotAt(tenantId, targetTimestamp);
    if (!snapshot) {
      return { positions: {}, cashBalanceCents: 10_000_000, lastEventSequence: 0 };
    }
    return {
      positions: snapshot['positions'] as Record<string, unknown>,
      cashBalanceCents: snapshot['cashBalanceCents'] as number,
      lastEventSequence: (snapshot['lastEventSequence'] as number) ?? 0,
    };
  }
}
```

### Pipes: write SnapshotAt from enriched events

The existing `portfolio-updated` and `balance-updated` pipes extract the `snapshot` field from the enriched event payload and call `saveSnapshotAt`.

## TTL

- Environment variable: `SNAPSHOT_HISTORY_TTL_DAYS` (default: 365)
- Applied to both `ledger-ctrl` SnapshotHistory items and `ledger-bff` SnapshotAt items
- DDB TTL handles automatic cleanup

## Impact Analysis

| Area | Impact |
|------|--------|
| Simulation comparison (`getSimulationComparison`) | None — already pure reads from BFF table |
| Time-travel UI | None — same GraphQL contract, same input/output shape |
| Shadow-fill (simulated stream) | None — reducer processes both stream types, snapshot history written for both |
| Frontend | None — no API contract changes |
| Event schema | Additive — existing fields unchanged, `snapshot` field added to event payloads |
| ledger-ctrl domain | Grows (absorbs reducer + commands) — correct ownership |
| ledger-bff domain | Shrinks to zero domain logic — consistent with all other BFFs |

## Performance Characteristics

| Metric | Current | Proposed |
|--------|---------|----------|
| Time-travel query latency | O(n) — grows with event count | O(1) — single DDB query |
| Time-travel Lambda memory | Higher (holds event list + replay state) | Lower (reads one snapshot row) |
| Write-side cost per batch | 1 transaction (snapshot + events) | 1 transaction + 1 PutItem (snapshot history) |
| DDB storage | Events + 1 snapshot + daily checkpoints | Events + 1 snapshot + daily checkpoints + N snapshot history items (TTL-bounded) |
| BFF bundle size | Includes reducer + command-core | Smaller (no domain logic) |

## Cleanup

After migration:
- Delete `libs/ledger-core/` directory
- Remove `@nestfolio/ledger-core` from root `tsconfig.base.json` paths
- Remove `ledger-core` from `nx.json` / workspace project references
- Remove `@nestfolio/command-core` import from `ledger-bff` (no longer needed)
- Daily checkpoint logic in both services can optionally be removed (snapshot history supersedes it) — but can also be kept as a coarser-grained safety net
