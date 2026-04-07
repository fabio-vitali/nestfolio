import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-sim-adpt', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'execution',
      detailType: [
        'SIM_ORDER_FILLED',
        'SIM_ORDER_REJECTED',
        'SIM_DEPOSIT_COMPLETED',
        'SIM_WITHDRAWAL_COMPLETED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Order Flow ──────────────────────────────────────────────────────

  it('should fill order and emit SIM_ORDER_FILLED', async () => {
    const orderId = `test-order-fill-${Date.now()}`;
    const pk = `VirtualLedger#${ctx.tenantId}#${ctx.userId}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_ORDER_REQUESTED',
      detail: {
        orderId,
        userId: ctx.userId,
        symbol: 'VTI',
        side: 'BUY',
        quantity: 1,
      },
    });

    // Verify DDB write (proves: EB → SQS → Lambda → DDB VirtualTrade write)
    const item = await table.waitForItem({
      table: 'broker-sim-adpt',
      pk,
      sk: `Trade#${orderId}`,
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('VirtualTrade');
    expect(item['symbol']).toBe('VTI');

    // Verify CDC event (proves: DDB write → CDC → SIM_ORDER_FILLED on ExecutionBus)
    const event = await trap.waitForEvent({ detailType: 'SIM_ORDER_FILLED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SIM_ORDER_FILLED');
  }, 120_000);

  // ── Deposit Flow ────────────────────────────────────────────────────

  it('should process deposit and emit SIM_DEPOSIT_COMPLETED', async () => {
    const depositId = `test-deposit-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_DEPOSIT_INITIATED',
      detail: {
        depositId,
        userId: ctx.userId,
        amountCents: 100_000,
        currency: 'USD',
      },
    });

    // Verify CDC event — proves full pipeline: EB → SQS → Lambda → DDB DepositDetected write → CDC → SIM_DEPOSIT_COMPLETED
    // DDB pk uses eventId (not depositId), so we verify via CDC event instead of waitForItem
    const event = await trap.waitForEvent({ detailType: 'SIM_DEPOSIT_COMPLETED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('SIM_DEPOSIT_COMPLETED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  // ── Withdrawal Flow ─────────────────────────────────────────────────

  it('should process withdrawal and emit SIM_WITHDRAWAL_COMPLETED', async () => {
    const withdrawalId = `test-withdrawal-${Date.now()}`;

    // Ensure account exists with sufficient balance by sending a deposit first
    const setupDepositId = `test-setup-deposit-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_DEPOSIT_INITIATED',
      detail: {
        depositId: setupDepositId,
        userId: ctx.userId,
        amountCents: 500_000,
        currency: 'USD',
      },
    });

    // Wait for setup deposit to complete before requesting withdrawal
    await trap.waitForEvent({ detailType: 'SIM_DEPOSIT_COMPLETED', timeoutMs: 60_000 });

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_WITHDRAWAL_REQUESTED',
      detail: {
        withdrawalId,
        userId: ctx.userId,
        amount: 500,
      },
    });

    // Verify CDC event — proves full pipeline: EB → SQS → Lambda → DDB WithdrawalCompleted write → CDC → SIM_WITHDRAWAL_COMPLETED
    // DDB pk uses eventId (not withdrawalId), so we verify via CDC event instead of waitForItem
    const event = await trap.waitForEvent({ detailType: 'SIM_WITHDRAWAL_COMPLETED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('SIM_WITHDRAWAL_COMPLETED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
