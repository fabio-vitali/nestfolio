import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('compliance-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Trap CDC output events — ComplianceCheck insert dispatches DECISION_APPROVED or DECISION_BLOCKED
    await trap.deploy({
      bus: 'advisory',
      detailType: ['DECISION_APPROVED', 'DECISION_BLOCKED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Decision Packet Created ────────────────────────────────────────

  it('should emit DECISION_APPROVED or DECISION_BLOCKED on DECISION_PACKET_CREATED', async () => {
    const decisionId = `integ-decision-created-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionId,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150.0 },
        ],
        portfolioValue: 50000,
        riskScore: 5,
        currentPositions: [
          { symbol: 'AAPL', quantity: 5, value: 750.0 },
        ],
      },
    });

    // Assert: CDC event emitted (proves: event → SQS → Lambda → DDB write → CDC)
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
  }, 120_000);

  // ── Decision Packet Updated (re-evaluation) ───────────────────────

  it('should re-evaluate and emit DECISION_APPROVED or DECISION_BLOCKED on DECISION_PACKET_UPDATED', async () => {
    const decisionId = `integ-decision-updated-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'DECISION_PACKET_UPDATED',
      detail: {
        decisionId,
        proposedTrades: [
          { symbol: 'MSFT', side: 'SELL', quantity: 20, price: 300.0 },
        ],
        portfolioValue: 100000,
        riskScore: 3,
        currentPositions: [
          { symbol: 'MSFT', quantity: 50, value: 15000.0 },
        ],
      },
    });

    // Assert: CDC event emitted — same path as CREATED, proves UPDATED is wired
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
  }, 120_000);

  // ── Mandate Created (compliance rules projection) ─────────────────

  it('should write MandateSnapshot to DDB on MANDATE_CREATED', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 25,
        maxSingleTradePercent: 10,
        effectiveDate: '2026-01-15T00:00:00.000Z',
        revokedAt: null,
      },
    });

    // Assert: MandateSnapshot projected into DDB
    // pk = GuardrailPolicy#{tenantId}#{userId}, sk = MandateSnapshot
    // userId falls back to tenantId when not provided in subject
    const item = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
    });

    expect(item['mandateId']).toBe(mandateId);
    expect(item['level']).toBe('DISCRETIONARY');
    expect(item['monthlyTurnoverCapPercent']).toBe(25);
    expect(item['maxSingleTradePercent']).toBe(10);
  }, 120_000);
});
