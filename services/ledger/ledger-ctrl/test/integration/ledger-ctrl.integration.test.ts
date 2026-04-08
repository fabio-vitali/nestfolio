import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Helper: wait for a LedgerEntry with a specific eventType ──────────

async function waitForLedgerEntry(
  table: TableAssertions,
  tenantId: string,
  eventType: string,
  timeoutMs = 60_000,
  pollIntervalMs = 3_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  const pk = `Account#${tenantId}#actual`;

  while (Date.now() < deadline) {
    const items = await table.queryItems({
      table: 'ledger-ctrl',
      pk,
      skPrefix: 'Event#',
    });
    const match = items.find(
      (i) => i['__typename'] === 'LedgerEntry' && i['eventType'] === eventType,
    );
    if (match) return match;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `waitForLedgerEntry: timeout waiting for eventType=${eventType} after ${timeoutMs}ms`,
  );
}

// ── Smoke: ORDER_FILLED → LedgerEntry DDB write ───────────────────────

describe('ledger-ctrl: ORDER_FILLED → LedgerEntry DDB write (smoke)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should record a LedgerEntry on ORDER_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: 'test-order-integ-001',
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const item = await table.waitForItem({
      table: 'ledger-ctrl',
      pk: `Account#${ctx.tenantId}#actual`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['eventType']).toBe('ORDER_FILLED');
  }, 120_000);
});

// ── DDB write coverage: each event type creates a LedgerEntry ─────────

describe('ledger-ctrl: event-listener DDB writes', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should record a LedgerEntry on DEPOSIT_DETECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-ddb-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'DEPOSIT_DETECTED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on WITHDRAWAL_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `wd-ddb-${Date.now()}`,
        amountCents: 100_000,
        completedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'WITHDRAWAL_COMPLETED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_PARTIALLY_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      detail: {
        orderId: `partial-ddb-${Date.now()}`,
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 3,
        fillPrice: 420.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_PARTIALLY_FILLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_REJECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `reject-ddb-${Date.now()}`,
        symbol: 'TSLA',
        side: 'BUY',
        quantity: 5,
        reason: 'Insufficient margin',
        rejectedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_REJECTED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_CANCELLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_CANCELLED',
      detail: {
        orderId: `cancel-ddb-${Date.now()}`,
        symbol: 'GOOG',
        side: 'SELL',
        quantity: 2,
        cancelledAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_CANCELLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: balance-affecting events → BALANCE_UPDATED ────────────
// Flow: EB → SQS → event-listener (LedgerEntry DDB write) → DDB Stream →
//       Reducer (snapshot + derived events) → DDB Stream → Egress → EB
//
// SKIPPED — Reducer Lambda sk-prefix mismatch (stale deployment)
// ---------------------------------------------------------------
// Root cause: The deployed Reducer Lambda (2026-04-06) was bundled from
// the replayAndReduce pipeline's `conventionQuery`, which queries:
//   begins_with(sk, '${__typename}#')  →  begins_with(sk, 'LedgerEntry#')
// But putLedgerEntry writes sk = 'Event#<eventId>'. The query always
// returns 0 events, so the Reducer logs "No new events to reduce" and
// never writes BalanceEvent / PortfolioEvent / LedgerEntryEvent records.
//
// Fix: Redeploy ledger-ctrl. The current source (reducer.ts) uses
// EgestionEngine with a custom processGroup that calls
// repository.queryEntriesSince, which correctly queries
// begins_with(sk, 'Event#').
//
// No AccountSeedingFixture needed: INITIAL_ACCOUNT_STATE provides
// cashBalanceCents: 10_000_000, so the Reducer has a baseline to
// delta against on the very first event for a tenant.

describe.skip('ledger-ctrl: CDC chain → BALANCE_UPDATED', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ORDER_FILLED → BALANCE_UPDATED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `fill-cdc-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);

  it('DEPOSIT_DETECTED → BALANCE_UPDATED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-cdc-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);

  it('WITHDRAWAL_COMPLETED → BALANCE_UPDATED', async () => {
    // INITIAL_ACCOUNT_STATE.cashBalanceCents = 10_000_000 — plenty for
    // a 100_000-cent withdrawal even on the first event for this tenant.
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `wd-cdc-${Date.now()}`,
        amountCents: 100_000,
        completedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);

  it('ORDER_PARTIALLY_FILLED → BALANCE_UPDATED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      detail: {
        orderId: `partial-cdc-${Date.now()}`,
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 3,
        fillPrice: 420.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);
});

// ── CDC chain: ORDER_REJECTED → LEDGER_ENTRY_RECORDED ─────────────────
// ORDER_REJECTED is a no-op in the reducer (no balance/portfolio change),
// but LedgerEntryEvent is always written when the snapshot updates →
// Egress emits LEDGER_ENTRY_RECORDED.
// SKIPPED — same Reducer sk-prefix mismatch as above.

describe.skip('ledger-ctrl: CDC chain → LEDGER_ENTRY_RECORDED', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({ bus: 'ledger', detailType: 'LEDGER_ENTRY_RECORDED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ORDER_REJECTED → LEDGER_ENTRY_RECORDED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `reject-cdc-${Date.now()}`,
        symbol: 'TSLA',
        side: 'BUY',
        quantity: 5,
        reason: 'Insufficient margin',
        rejectedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('LEDGER_ENTRY_RECORDED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);
});
