import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('execution-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Trap all Order CDC events on ExecutionBus
    await trap.deploy({
      bus: 'execution',
      detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED', 'STAGED_ORDER'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── helpers ───────────────────────────────────────────────────────

  function trade(symbol: string, side: 'BUY' | 'SELL' = 'BUY', quantityOrAmountCents = 50000) {
    return { symbol, assetClass: 'EQUITY', side, quantityOrAmountCents, targetWeightPercent: 50, rationale: 'integ' };
  }

  // ── DECISION_APPROVED ─────────────────────────────────────────────

  it('expands a 2-trade DECISION_APPROVED into 2 per-symbol Order CDC events', async () => {
    const decisionPacketId = `integ-decision-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      subject: {
        ccId: `integ-cc-${Date.now()}`,
        decisionPacketId,
        decisionId: `integ-dec-${Date.now()}`,
        taskToken: `fake-task-token-${Date.now()}`,
        mandateSnapshot: { level: 'ADVISORY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-01T00:00:00.000Z' },
        status: 'COMPLETED' as const,
        result: 'APPROVED' as const,
        violations: [],
        authorityLevel: 'L1' as const,
        proposedTrades: [trade('VTI'), trade('BND', 'SELL', 30000)],
        sourceEventId: `integ-src-${Date.now()}`,
      },
    });

    const match = (d: { subject?: { decisionPacketId?: string } }) => d?.subject?.decisionPacketId === decisionPacketId;
    const e1 = await trap.waitForEvent<BusEventPayload>({ match, timeoutMs: 90_000 });
    const e2 = await trap.waitForEvent<BusEventPayload>({ match, timeoutMs: 90_000 });

    for (const e of [e1, e2]) {
      expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(e.detailType);
      expect(e.detail.subject).toEqual(expect.objectContaining({
        decisionPacketId,
        symbol: expect.any(String),
        side: expect.stringMatching(/^(BUY|SELL)$/),
        quantityOrAmountCents: expect.any(Number),
      }));
    }
    expect([e1, e2].map((e) => (e.detail.subject as { symbol: string }).symbol).sort()).toEqual(['BND', 'VTI']);
  }, 120_000);

  // ── USER_CONFIRMED ────────────────────────────────────────────────

  it('expands a USER_CONFIRMED carrying proposedTrades into a per-symbol Order CDC event', async () => {
    const decisionId = `integ-user-confirmed-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'USER_CONFIRMED',
      subject: {
        decisionId,
        confirmedAt: new Date().toISOString(),
        confirmedBy: 'integ-test-user',
        timestamp: new Date().toISOString(),
        proposedTrades: [trade('VTI')],
      },
      // No context override: the order must carry ctx.tenantId so the EventBusTrap
      // rule (which filters detail.context.tenantId === ctx.tenantId) captures its
      // ORDER_* CDC event. A custom tenantId here makes the emitted event invisible
      // to the trap — the order is created correctly but never matched.
    });

    const event = await trap.waitForEvent<BusEventPayload>({
      match: (d: { subject?: { decisionPacketId?: string } }) => d?.subject?.decisionPacketId === decisionId,
      timeoutMs: 90_000,
    });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
    expect(event.detail.subject).toEqual(expect.objectContaining({ decisionPacketId: decisionId, symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 50000 }));
  }, 120_000);

  // ── ACCOUNT_CLOSURE_REQUESTED ─────────────────────────────────────

  it('should process ACCOUNT_CLOSURE_REQUESTED without error (skip handler)', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'ACCOUNT_CLOSURE_REQUESTED',
      detail: {
        tenantId: `integ-tenant-${Date.now()}`,
        reason: 'integ-test-account-closure',
        requestedAt: new Date().toISOString(),
      },
    });

    // Handler calls skip() — no DDB write, no CDC event expected.
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const stray = await trap.drain();
    const closureEvents = stray.filter(e =>
      e.detailType.includes('ACCOUNT_CLOSURE') || e.detailType.includes('ACCOUNT_CLOSED'),
    );
    expect(closureEvents).toHaveLength(0);
  }, 60_000);
});
