# Ledger-ctrl Full CDC Chain Test

## Goal

Close the gap from Issue #4 in `docs/superpowers/plans/integration-test-issues.md`: test the full two-hop CDC chain in ledger-ctrl (LedgerEntry → Reducer → BalanceEvent → CDC → EventBridge).

## Context

The existing integration test at `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts` verifies the Ingress pipeline: `ORDER_FILLED` → SQS → Lambda → `LedgerEntry` DDB write. It uses `TableAssertions` because the Reducer requires a pre-existing `AccountSnapshot` to compute a balance delta.

The Reducer Lambda is triggered by DDB Streams (filtered on `__typename = 'LedgerEntry'` INSERTs). It reads the current `AccountSnapshot`, applies the new LedgerEntry, writes a `BalanceEvent` record, and updates the snapshot. The Egress CDC then publishes `BALANCE_UPDATED` to the ledgerBus.

## What to build

### 1. AccountSeedingFixture in `libs/integration-testing`

Add a new fixture class `AccountSeedingFixture` (or similar) that:

- Takes an `IntegrationContext` + service name
- Resolves the DDB table name via `ctx.ssm.tableName('ledger-ctrl')`
- Writes an initial `AccountSnapshot` record to DDB with:
  - `pk: Account#<tenantId>#actual`, `sk: Snapshot`
  - `__typename: AccountSnapshot`
  - `tenantId: ctx.tenantId`
  - Minimal valid fields: `cashBalanceCents: 1_000_000`, `positions: []`, `sequenceNo: 0`, `updatedAt: <now>`
- Read `services/ledger/ledger-ctrl/src/handlers/reducer.ts` and `src/domain/account.reducer.ts` to understand the exact `AccountSnapshot` schema the Reducer expects
- Export from `libs/integration-testing/src/index.ts`

### 2. Update ledger-ctrl integration test

Replace (or add to) the existing test with a full CDC chain test:

```typescript
import { createIntegrationContext, EventBridgeClient, EventBusTrap, AccountSeedingFixture, type IntegrationContext } from '@nestfolio/integration-testing';

describe('ledger-ctrl: ORDER_FILLED → full CDC chain', () => {
  let ctx, eb, trap, seeder;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    // Seed initial account state so Reducer has something to delta against
    await seeder.seed('ledger-ctrl');

    // Trap the CDC output
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 60_000);

  afterAll(async () => { await ctx.cleanup.runAll(); }, 30_000);

  it('should emit BALANCE_UPDATED via full Reducer CDC chain', async () => {
    await eb.putEvent({
      bus: 'ledger', targetService: 'ledger-ctrl', detailType: 'ORDER_FILLED',
      detail: { orderId: 'full-cdc-test', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150.0, filledAt: new Date().toISOString(), executionMode: 'paper' },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
```

### 3. Verify

- Run `pnpm nx run ledger-ctrl:test-integration` — both old + new tests should pass
- The old test (TableAssertions on LedgerEntry) can stay as a fast smoke test

## Key files to read

- `services/ledger/ledger-ctrl/src/handlers/reducer.ts` — how it reads AccountSnapshot and applies LedgerEntries
- `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` — the reduction logic and snapshot schema
- `services/ledger/ledger-ctrl/src/domain/account-state.ts` — AccountSnapshot type definition
- `services/ledger/ledger-ctrl/src/service.stack.ts` — Egress CDC eventTypes config
- `libs/integration-testing/src/fixtures/table-assertions.ts` — pattern for DDB access in fixtures

## Branch

Continue on `feat/all-services-integration-tests` (or create a new branch if you prefer).
