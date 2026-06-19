import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
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
    ctx = await createIntegrationTestContext();
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
      // Typed against NormalizedOrderEventSchema (broker-ctrl/contracts → @nestfolio/test-contracts).
      // symbol/side/quantity/fillPrice are NOT in the ORDER_* producer contract — broker-ctrl drops
      // them, so the ledger-ctrl reducer/tax-lot reads of those resolve to undefined in prod: a filed
      // latent bug (docs/backlog/ledger-ctrl-live-tax-lot-missing-order-fields.md). executionMode
      // 'simulation' keeps the live-only tax-lot path out of scope here.
      subject: {
        orderId: 'test-order-integ-001',
        executionMode: 'simulation',
        filledQty: 10,
        averageFillPrice: 150.0,
        timestamp: new Date().toISOString(),
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
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should record a LedgerEntry on DEPOSIT_SETTLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_SETTLED',
      subject: {
        sk: 'DEPOSIT_SETTLED',
        direction: 'DEPOSIT',
        status: 'settled',
        transferId: `dep-ddb-${Date.now()}`,
        amountCents: 500_000,
        currency: 'USD',
        executionMode: 'simulation',
        initiatedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'DEPOSIT_SETTLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on WITHDRAWAL_SETTLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_SETTLED',
      subject: {
        sk: 'WITHDRAWAL_SETTLED',
        direction: 'WITHDRAWAL',
        status: 'settled',
        transferId: `wd-ddb-${Date.now()}`,
        amountCents: 100_000,
        currency: 'USD',
        executionMode: 'simulation',
        initiatedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'WITHDRAWAL_SETTLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_PARTIALLY_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      subject: {
        orderId: `partial-ddb-${Date.now()}`,
        executionMode: 'simulation',
        filledQty: 3,
        averageFillPrice: 420.0,
        timestamp: new Date().toISOString(),
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
      subject: {
        orderId: `reject-ddb-${Date.now()}`,
        executionMode: 'simulation',
        failureReason: 'Insufficient margin',
        timestamp: new Date().toISOString(),
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
      subject: {
        orderId: `cancel-ddb-${Date.now()}`,
        executionMode: 'simulation',
        timestamp: new Date().toISOString(),
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
    ctx = await createIntegrationTestContext();
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
      subject: {
        orderId: `fill-cdc-${Date.now()}`,
        executionMode: 'simulation',
        filledQty: 10,
        averageFillPrice: 150.0,
        timestamp: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);

  it('DEPOSIT_SETTLED → BALANCE_UPDATED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_SETTLED',
      subject: {
        sk: 'DEPOSIT_SETTLED',
        direction: 'DEPOSIT',
        status: 'settled',
        transferId: `dep-cdc-${Date.now()}`,
        amountCents: 500_000,
        currency: 'USD',
        executionMode: 'simulation',
        initiatedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 120_000);

  it('WITHDRAWAL_SETTLED → BALANCE_UPDATED', async () => {
    // INITIAL_ACCOUNT_STATE.cashBalanceCents = 10_000_000 — plenty for
    // a 100_000-cent withdrawal even on the first event for this tenant.
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_SETTLED',
      subject: {
        sk: 'WITHDRAWAL_SETTLED',
        direction: 'WITHDRAWAL',
        status: 'settled',
        transferId: `wd-cdc-${Date.now()}`,
        amountCents: 100_000,
        currency: 'USD',
        executionMode: 'simulation',
        initiatedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
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
      subject: {
        orderId: `partial-cdc-${Date.now()}`,
        executionMode: 'simulation',
        filledQty: 3,
        averageFillPrice: 420.0,
        timestamp: new Date().toISOString(),
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
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write simulated LedgerEntry per proposed trade', async () => {
    const dpId = `dp-sim-${Date.now()}`;
    const now = new Date().toISOString();

    // typed putEvent: DecisionPacketSchema shape (DRY — tenantId in context).
    // NOTE (b): this fixture historically sent { decisionPacketId, proposedTrades } — a thin shape
    // that never matched DecisionPacketSchema. The handler reads proposedTrades and derives
    // decisionId from ctx.eventId (see event-listener.ts processSimulationEvent comment).
    // Migrated fields are (a) fixture-only additions to satisfy the schema.
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      subject: {
        decisionId: dpId,
        trigger: 'REBALANCE',
        triggerEventId: 'integ-trigger-evt',
        executionArn: null,
        explanation: 'Integration test simulation',
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 150_000 },
          { symbol: 'MSFT', side: 'SELL', quantityOrAmountCents: 50_000 },
        ],
        confirmationRequired: false,
        status: 'CONFIRMED',
        __version: 1,
        complianceResult: null,
        authorityLevel: null,
        userDecision: null,
        blockReason: null,
        rejectionReason: null,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
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
    const now = new Date().toISOString();

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      subject: {
        decisionId: dpId,
        trigger: 'REBALANCE',
        triggerEventId: 'integ-trigger-evt',
        executionArn: null,
        explanation: 'Integration test simulation (empty trades)',
        proposedTrades: [],
        confirmationRequired: false,
        status: 'CONFIRMED',
        __version: 1,
        complianceResult: null,
        authorityLevel: null,
        userDecision: null,
        blockReason: null,
        rejectionReason: null,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
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
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('DECISION_PACKET_CREATED → BALANCE_UPDATED (simulated)', async () => {
    const now = new Date().toISOString();
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      subject: {
        decisionId: `dp-cdc-${Date.now()}`,
        trigger: 'REBALANCE',
        triggerEventId: 'integ-trigger-evt',
        executionArn: null,
        explanation: 'Integration test CDC chain',
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 150_000 },
        ],
        confirmationRequired: false,
        status: 'CONFIRMED',
        __version: 1,
        complianceResult: null,
        authorityLevel: null,
        userDecision: null,
        blockReason: null,
        rejectionReason: null,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
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
    ctx = await createIntegrationTestContext();
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
      subject: {
        orderId: `reject-cdc-${Date.now()}`,
        executionMode: 'simulation',
        failureReason: 'Insufficient margin',
        timestamp: new Date().toISOString(),
      },
    });

    // 4-hop chain: Ingress→ReducerFn(5s batch)→snapshot-publisher(5s batch)→CDC
    const event = await trap.waitForEvent({ timeoutMs: 120_000 });
    expect(event.detailType).toBe('LEDGER_ENTRY_RECORDED');
    expect((event.detail as { subject?: Record<string, unknown> }).subject?.['lastEventSequence']).toEqual(expect.any(Number));
    expect((event.detail as Record<string, unknown>).context).toEqual(
      expect.objectContaining({ tenantId: ctx.tenantId }),
    );
  }, 150_000);
});
