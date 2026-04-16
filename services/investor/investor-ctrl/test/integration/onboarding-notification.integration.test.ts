import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
} from '@nestfolio/integration-testing';

/**
 * investor-ctrl integration tests — all 11 ingress events.
 *
 * Handler: event-listener.ts
 *   - Every event → Notification record (PutItem)
 *   - ORDER_FILLED → [Notification, MonthlyReport] (two PutItems)
 *
 * DDB entities:
 *   Notification:   pk = Notification#{tenantId}#{notificationId}   sk = Notification
 *   MonthlyReport:  pk = MonthlyReport#{tenantId}#{reportId}        sk = MonthlyReport
 *     where notificationId = ctx.eventId (EB event ID), reportId = ctx.eventId + "-report"
 *
 * CDC egress (auto-expand):
 *   Notification  → NOTIFICATION  → NOTIFICATION_CREATED  (INSERT)
 *   MonthlyReport → MONTHLY_REPORT → MONTHLY_REPORT_CREATED (INSERT)
 *
 * Strategy: publish event → trap CDC → assert detail-type.
 * The pk includes the EB event ID (random), so we rely on the EventBusTrap
 * (filtered by tenantId) rather than direct DDB queries.
 */

describe('investor-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let notificationTrap: EventBusTrap;
  let reportTrap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    notificationTrap = new EventBusTrap(ctx);
    reportTrap = new EventBusTrap(ctx);

    // Trap NOTIFICATION_CREATED and MONTHLY_REPORT_CREATED on InvestorBus
    await notificationTrap.deploy({
      bus: 'investor',
      detailType: 'NOTIFICATION_CREATED',
    });
    await reportTrap.deploy({
      bus: 'investor',
      detailType: 'MONTHLY_REPORT_CREATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Notification creation for all 11 events ─────────────────────────

  describe('notification creation (CDC verification)', () => {
    const notificationEvents = [
      {
        detailType: 'ONBOARDING_COMPLETED',
        detail: { goal: 'RETIREMENT', riskTolerance: 'MODERATE' },
      },
      {
        detailType: 'MANDATE_CREATED',
        detail: { mandateId: 'integ-mandate', level: 'DISCRETIONARY' },
      },
      {
        detailType: 'GOAL_UPDATED',
        detail: { goalId: 'integ-goal', objective: 'INCOME' },
      },
      {
        detailType: 'DEPOSIT_INITIATED',
        detail: { depositId: 'integ-dep', amountCents: 100_000 },
      },
      {
        detailType: 'OPERATING_MODE_CHANGED',
        detail: { mode: 'AGGRESSIVE', previousMode: 'BALANCED' },
      },
      {
        detailType: 'DECISION_APPROVED',
        detail: { decisionId: 'integ-decision' },
      },
      {
        detailType: 'ORDER_FILLED',
        detail: { orderId: 'integ-order', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150 },
      },
      {
        detailType: 'BALANCE_UPDATED',
        detail: { cashBalanceCents: 500_000, deltaCents: 50_000 },
      },
      {
        detailType: 'ORDER_REJECTED',
        detail: { orderId: 'integ-reject', reason: 'Margin' },
      },
      {
        detailType: 'DECISION_BLOCKED',
        detail: { decisionId: 'integ-blocked', reason: 'Compliance' },
      },
      {
        detailType: 'WITHDRAWAL_COMPLETED',
        detail: { withdrawalId: 'integ-wd', amountCents: 50_000 },
      },
    ];

    it.each(notificationEvents)(
      'should create Notification on $detailType and emit NOTIFICATION_CREATED via CDC',
      async ({ detailType, detail }) => {
        await eb.putEvent({
          bus: 'investor',
          targetService: 'investor-ctrl',
          detailType,
          detail,
        });

        // event → SQS → Lambda → DDB PutItem (Notification) → DDB Stream INSERT → CDC → NOTIFICATION_CREATED
        const cdcEvent = await notificationTrap.waitForEvent({
          detailType: 'NOTIFICATION_CREATED',
          timeoutMs: 90_000,
        });
        expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
        expect(cdcEvent.detail).toBeDefined();
      },
      120_000,
    );
  });

  // ── ORDER_FILLED also creates MonthlyReport ─────────────────────────

  describe('ORDER_FILLED MonthlyReport creation', () => {
    it('should create MonthlyReport on ORDER_FILLED and emit MONTHLY_REPORT_CREATED via CDC', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ORDER_FILLED',
        detail: { orderId: 'integ-order-report', symbol: 'MSFT', side: 'SELL', quantity: 5, fillPrice: 300 },
      });

      // ORDER_FILLED handler returns [Notification, MonthlyReport] — two PutItems.
      // The MonthlyReport INSERT triggers: DDB Stream → CDC → MONTHLY_REPORT_CREATED
      const cdcEvent = await reportTrap.waitForEvent({
        detailType: 'MONTHLY_REPORT_CREATED',
        timeoutMs: 90_000,
      });
      expect(cdcEvent.detailType).toBe('MONTHLY_REPORT_CREATED');
      expect(cdcEvent.detail).toBeDefined();

      // Also verify the Notification was created (drain from notification trap)
      const notifEvent = await notificationTrap.waitForEvent({
        detailType: 'NOTIFICATION_CREATED',
        timeoutMs: 90_000,
      });
      expect(notifEvent.detailType).toBe('NOTIFICATION_CREATED');
    }, 120_000);
  });

  // ── Circuit breaker notifications (SYSTEM tenant) ────────────────────

  describe('circuit breaker notifications', () => {
    /**
     * BROKER_CIRCUIT_OPEN / BROKER_CIRCUIT_CLOSED / BROKER_HEAL_ESCALATED all
     * create a Notification with tenantId='SYSTEM'.
     * Flow: event → SQS → Lambda → DDB PutItem → DDB Stream INSERT → CDC → NOTIFICATION_CREATED
     *
     * System notifications use tenantId='SYSTEM' (not the test tenant), so we need
     * a separate EventBusTrap whose EB rule filter matches tenantId='SYSTEM'.
     */
    let systemTrap: EventBusTrap;

    beforeAll(async () => {
      systemTrap = new EventBusTrap({ ...ctx, tenantId: 'SYSTEM' });
      await systemTrap.deploy({
        bus: 'investor',
        detailType: 'NOTIFICATION_CREATED',
      });
    }, 90_000);

    const circuitBreakerEvents = [
      { detailType: 'BROKER_CIRCUIT_OPEN' },
      { detailType: 'BROKER_CIRCUIT_CLOSED' },
      { detailType: 'BROKER_HEAL_ESCALATED' },
    ];

    it.each(circuitBreakerEvents)(
      'should create SYSTEM Notification on $detailType and emit NOTIFICATION_CREATED via CDC',
      async ({ detailType }) => {
        await eb.putEvent({
          bus: 'investor',
          targetService: 'investor-ctrl',
          detailType,
          detail: {},
        });

        const cdcEvent = await systemTrap.waitForEvent({
          detailType: 'NOTIFICATION_CREATED',
          timeoutMs: 90_000,
        });
        expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
        expect(cdcEvent.detail).toBeDefined();
        expect(cdcEvent.detail.subject.tenantId).toBe('SYSTEM');
        expect(cdcEvent.detail.subject.type).toBe(detailType);
      },
      120_000,
    );
  });
});
