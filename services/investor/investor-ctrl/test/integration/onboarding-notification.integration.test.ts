import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
} from '@nestfolio/integration-testing';

/**
 * investor-ctrl integration tests — post-resplit topology (2026-05-08).
 *
 * Handler: event-listener.ts
 *   - 12 tenant events    → record('Notification') (PutItem). GOAL_UPDATED and
 *     OPERATING_MODE_CHANGED are now first-class atomic events emitted by
 *     investor-bff CDC onFieldChange (NOT synthesised here anymore — the
 *     INVESTOR_PROFILE_UPDATED diff-detect handler was removed in the resplit).
 *   - ORDER_FILLED → [Notification, MonthlyReport] (two PutItems)
 *   - 3 system events (BROKER_CIRCUIT_OPEN/CLOSED/HEAL_ESCALATED) →
 *     Notification with tenantId='SYSTEM'.
 *
 * DDB entities:
 *   Notification:   pk = Notification#{tenantId}#{notificationId}   sk = Notification
 *   MonthlyReport:  pk = MonthlyReport#{tenantId}#{reportId}        sk = MonthlyReport
 *     where notificationId = ctx.eventId (or `${ctx.eventId}-${synthType}` for
 *     synthesised diff notifications), reportId = ctx.eventId + "-report"
 *
 * CDC egress:
 *   Notification  → NOTIFICATION_CREATED  (INSERT)
 *   MonthlyReport → MONTHLY_REPORT_CREATED (INSERT)
 *
 * Strategy: publish event → trap CDC → assert detail-type.
 */

describe('investor-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let notificationTrap: EventBusTrap;
  let reportTrap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
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
  }, 150_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Notification creation for the 10 simple-template events ────────────

  describe('notification creation (CDC verification)', () => {
    // Each event type makes investor-ctrl write a Notification, re-emitted as NOTIFICATION_CREATED
    // via CDC. No assertion reads the INJECTED subject, so each injected subject only needs to be
    // minimally valid under its producer schema — enforced offline by the typed putEvent runtime
    // backstop (EventSubjects[K].parse) before any send. Unrolled from an it.each so every putEvent
    // carries a literal detailType (the typed subject:/context: overload binds only for literal K).
    const expectNotificationCdc = async (emit: () => Promise<void>) => {
      await emit();
      // event → SQS → Lambda → DDB PutItem (Notification) → DDB Stream INSERT → CDC → NOTIFICATION_CREATED
      const cdcEvent = await notificationTrap.waitForEvent({
        detailType: 'NOTIFICATION_CREATED',
        timeoutMs: 90_000,
      });
      expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
      expect(cdcEvent.detail).toBeDefined();
    };

    it('creates Notification on ONBOARDING_COMPLETED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ONBOARDING_COMPLETED',
        subject: { goal: { objective: 'RETIREMENT' }, horizonYears: 10, accountMode: 'simulation', capitalAmount: 100_000, currency: 'USD', riskTolerance: 2, riskExperience: 1, operatingMode: 'BALANCED', mandateAccepted: true },
      })), 120_000);

    it('creates Notification on MANDATE_ISSUED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'MANDATE_ISSUED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on MANDATE_REVOKED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'MANDATE_REVOKED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'REVOKED', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString(), revokedAt: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on DEPOSIT_INITIATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DEPOSIT_INITIATED',
        subject: { depositId: 'integ-dep', amountCents: 100_000, currency: 'USD', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on DECISION_APPROVED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DECISION_APPROVED',
        subject: { ccId: 'integ-cc', decisionPacketId: 'integ-dp', decisionId: 'integ-decision', taskToken: 'integ-token', mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() }, status: 'COMPLETED', result: 'APPROVED', violations: [], authorityLevel: 'L1', sourceEventId: 'integ-src-evt' },
      })), 120_000);

    // ORDER_FILLED / ORDER_REJECTED — typed against the producer-owned NormalizedOrderEventSchema
    // (broker-ctrl/contracts → @nestfolio/test-contracts; brokerCtrlEventSubjects now registers the
    // ORDER_* family). DRY subject — identity is in context; symbol/side/quantity/fillPrice are NOT in
    // the producer contract and the notification path does not read them.
    it('creates Notification on ORDER_FILLED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ORDER_FILLED',
        subject: { orderId: 'integ-order', executionMode: 'simulation', filledQty: 10, averageFillPrice: 150, timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on BALANCE_UPDATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BALANCE_UPDATED',
        subject: { cashBalanceCents: 500_000, snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence: 1 } },
      })), 120_000);

    it('creates Notification on ORDER_REJECTED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ORDER_REJECTED',
        subject: { orderId: 'integ-reject', executionMode: 'simulation', failureReason: 'Margin', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on DECISION_BLOCKED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DECISION_BLOCKED',
        subject: { ccId: 'integ-cc', decisionPacketId: 'integ-dp', decisionId: 'integ-blocked', taskToken: 'integ-token', mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() }, status: 'BLOCKED', result: 'BLOCKED', violations: [], authorityLevel: 'L1', sourceEventId: 'integ-src-evt' },
      })), 120_000);

    it('creates Notification on WITHDRAWAL_SETTLED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'WITHDRAWAL_SETTLED',
        subject: { sk: 'WITHDRAWAL_SETTLED', direction: 'WITHDRAWAL', status: 'settled', transferId: 'integ-wd', amountCents: 50_000, currency: 'USD', executionMode: 'simulation', initiatedAt: new Date().toISOString(), timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on GOAL_UPDATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'GOAL_UPDATED',
        subject: { operatingMode: 'BALANCED', goal: { objective: 'INCOME' }, riskProfile: { score: 5 } },
      })), 120_000);

    it('creates Notification on OPERATING_MODE_CHANGED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'OPERATING_MODE_CHANGED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'AGGRESSIVE', effectiveDate: new Date().toISOString() },
      })), 120_000);
  });

  // ── ORDER_FILLED also creates MonthlyReport ─────────────────────────

  describe('ORDER_FILLED MonthlyReport creation', () => {
    it('should create MonthlyReport on ORDER_FILLED and emit MONTHLY_REPORT_CREATED via CDC', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ORDER_FILLED',
        subject: { orderId: 'integ-order-report', executionMode: 'simulation', filledQty: 5, averageFillPrice: 300, timestamp: new Date().toISOString() },
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

    // Unrolled from an it.each so every putEvent carries a literal detailType. The asserted
    // `subject` is the OUTGOING Notification envelope (re-emitted via CDC), unaffected by the
    // injected BrokerCircuitEvent subject ({ adapter, timestamp }).
    const expectSystemNotificationCdc = async (eventType: string, emit: () => Promise<void>) => {
      await emit();
      const cdcEvent = await systemTrap.waitForEvent({
        detailType: 'NOTIFICATION_CREATED',
        timeoutMs: 90_000,
      });
      expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
      expect(cdcEvent.detail).toBeDefined();
      expect(cdcEvent.detail.subject.tenantId).toBe('SYSTEM');
      expect(cdcEvent.detail.subject.type).toBe(eventType);
    };

    it('creates SYSTEM Notification on BROKER_CIRCUIT_OPEN and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_CIRCUIT_OPEN', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_CIRCUIT_OPEN',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates SYSTEM Notification on BROKER_CIRCUIT_CLOSED and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_CIRCUIT_CLOSED', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_CIRCUIT_CLOSED',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates SYSTEM Notification on BROKER_HEAL_ESCALATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_HEAL_ESCALATED', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_HEAL_ESCALATED',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);
  });
});
