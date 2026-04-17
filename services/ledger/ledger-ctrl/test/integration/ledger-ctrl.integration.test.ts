import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
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
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();
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

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_FILLED');

    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['eventType']).toBe('ORDER_FILLED');
  }, 120_000);
});

// ── DDB write coverage: each event type creates a LedgerEntry ─────────

describe('ledger-ctrl: event-listener DDB writes', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();
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

describe('ledger-ctrl: CDC chain → BALANCE_UPDATED', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
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

// ── Simulation: DECISION_PACKET_CREATED → simulated LedgerEntry DDB writes ──

describe('ledger-ctrl: DECISION_PACKET_CREATED → simulated LedgerEntry writes', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write simulated LedgerEntry per proposed trade', async () => {
    const dpId = `dp-sim-${Date.now()}`;

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionPacketId: dpId,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10 },
          { symbol: 'MSFT', side: 'SELL', quantity: 5 },
        ],
      },
    });

    // Both trades should produce LedgerEntry items under the simulated partition
    const pk = `Account#${ctx.tenantId}#simulated`;
    const deadline = Date.now() + 60_000;
    let items: Record<string, unknown>[] = [];

    while (Date.now() < deadline) {
      items = await table.queryItems({
        table: 'ledger-ctrl',
        pk,
        skPrefix: 'Event#',
      });
      const matching = items.filter(
        (i) => i['__typename'] === 'LedgerEntry' && i['decisionId'] === dpId,
      );
      if (matching.length >= 2) {
        items = matching;
        break;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }

    expect(items).toHaveLength(2);

    const symbols = items.map((i) => (i['payload'] as Record<string, unknown>)['symbol']).sort();
    expect(symbols).toEqual(['AAPL', 'MSFT']);

    for (const item of items) {
      expect(item['__typename']).toBe('LedgerEntry');
      expect(item['streamType']).toBe('simulated');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['eventType']).toBe('ORDER_FILLED');
      expect(typeof item['sequenceNo']).toBe('number');
    }
  }, 120_000);

  it('should skip when proposedTrades is empty', async () => {
    const dpId = `dp-empty-${Date.now()}`;

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionPacketId: dpId,
        proposedTrades: [],
      },
    });

    // No LedgerEntry should be written — wait then verify nothing appeared
    await new Promise((r) => setTimeout(r, 15_000));
    const items = await table.queryItems({
      table: 'ledger-ctrl',
      pk: `Account#${ctx.tenantId}#simulated`,
      skPrefix: 'Event#',
    });
    const matching = items.filter((i) => i['decisionId'] === dpId);
    expect(matching).toHaveLength(0);
  }, 60_000);
});

// ── Simulation CDC chain: DECISION_PACKET_CREATED → BALANCE_UPDATED ─────
// Flow: EB → SQS → event-listener (simulated LedgerEntry DDB write) →
//       DDB Stream → Reducer (snapshot + derived events on simulated partition) →
//       DDB Stream → Egress → EB (BALANCE_UPDATED)

describe('ledger-ctrl: simulation CDC chain → BALANCE_UPDATED', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('DECISION_PACKET_CREATED → BALANCE_UPDATED (simulated)', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionPacketId: `dp-cdc-${Date.now()}`,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10 },
        ],
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
describe('ledger-ctrl: CDC chain → LEDGER_ENTRY_RECORDED', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
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

    // 4-hop chain: Ingress→ReducerFn(5s batch)→snapshot-publisher(5s batch)→CDC
    const event = await trap.waitForEvent({ timeoutMs: 120_000 });
    expect(event.detailType).toBe('LEDGER_ENTRY_RECORDED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 150_000);
});
