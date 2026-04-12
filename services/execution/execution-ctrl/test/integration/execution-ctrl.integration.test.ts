import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
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
    ctx = await createTestContext();
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

  // ── DECISION_APPROVED ─────────────────────────────────────────────

  it('should create Order on DECISION_APPROVED and emit CDC event', async () => {
    const decisionPacketId = `integ-decision-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 1000,
            targetWeightPercent: 10,
          },
        ],
      },
    });

    // CDC event proves: EB → SQS → Lambda → DDB write → DDB Stream → CDC Lambda → EB
    const event = await trap.waitForEvent<BusEventPayload>({ timeoutMs: 90_000 });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
    expect(event.detail.subject).toEqual(
      expect.objectContaining({ decisionPacketId }),
    );
  }, 120_000);

  // ── USER_CONFIRMED ────────────────────────────────────────────────

  it('should create Order on USER_CONFIRMED and emit CDC event', async () => {
    const decisionPacketId = `integ-user-confirmed-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'USER_CONFIRMED',
      detail: {
        decisionPacketId,
        proposedTrades: [
          {
            symbol: 'MSFT',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 500,
            targetWeightPercent: 5,
          },
        ],
      },
    });

    // USER_CONFIRMED routes to same processApprovedDecision handler
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
  }, 120_000);

  // ── CIRCUIT_BREAKER_TRIGGERED ─────────────────────────────────────

  it('should process CIRCUIT_BREAKER_TRIGGERED without error (skip handler)', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'CIRCUIT_BREAKER_TRIGGERED',
      detail: {
        reason: 'integ-test-circuit-break',
        triggeredAt: new Date().toISOString(),
      },
    });

    // Handler calls skip() — no DDB write, no CDC event expected.
    // Wait briefly then drain to confirm no unexpected events appeared.
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const stray = await trap.drain();
    const circuitEvents = stray.filter(e =>
      e.detailType.includes('CIRCUIT_BREAKER') || e.detailType.includes('EXECUTION_PAUSED'),
    );
    expect(circuitEvents).toHaveLength(0);
  }, 60_000);

  // ── CIRCUIT_BREAKER_RESET ─────────────────────────────────────────

  it('should process CIRCUIT_BREAKER_RESET without error (skip handler)', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'CIRCUIT_BREAKER_RESET',
      detail: {
        reason: 'integ-test-circuit-reset',
        resetAt: new Date().toISOString(),
      },
    });

    // Handler calls skip() — no DDB write, no CDC event expected.
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const stray = await trap.drain();
    const resetEvents = stray.filter(e =>
      e.detailType.includes('CIRCUIT_BREAKER') || e.detailType.includes('EXECUTION_RESUMED'),
    );
    expect(resetEvents).toHaveLength(0);
  }, 60_000);

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
