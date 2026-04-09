import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * advisory-ctrl integration tests — all 15 ingress events.
 *
 * Handler groups tested:
 * 1. Compliance callback: DECISION_BLOCKED, DECISION_APPROVED (L1 → APPROVED, L2 → AWAITING_CONFIRMATION)
 * 2. User response: USER_CONFIRMED, USER_REJECTED (use DECISION_APPROVED L2 as event-driven fixture)
 * 3. Agent trigger: 11 events (MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED,
 *    RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED,
 *    PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED,
 *    DEPOSIT_DETECTED) — invoke DecisionLifecycleService → Bedrock AgentCore.
 *    Verified via CDC trap (DECISION_PACKET event emitted from DDB Stream).
 *    The DDB pk includes the EventBridge event ID (not predictable from test),
 *    so we use the EventBusTrap rather than direct DDB queries.
 *
 * DDB entity: DecisionPacket
 *   pk: DecisionPacket#<tenantId>#<dpId>  (dpId = EventBridge event ID for trigger path)
 *   sk: DecisionPacket
 *
 * Note: compliance/user-response handlers use UpdateCommand (not PutCommand) so
 * __typename is NOT written by those paths. Assertions target status fields instead.
 */

/**
 * Poll DDB until a field reaches an expected value.
 * Used when waiting for a state transition (e.g. AWAITING_CONFIRMATION → CONFIRMED).
 */
async function waitForFieldValue(
  table: TableAssertions,
  params: { table: string; pk: string; sk: string; field: string; expected: string; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const timeout = params.timeoutMs ?? 60_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const item = await table.waitForItem({
        table: params.table,
        pk: params.pk,
        sk: params.sk,
        timeoutMs: 5_000,
      });
      if (item[params.field] === params.expected) return item;
    } catch {
      // item not found yet, keep polling
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout: ${params.field} did not reach "${params.expected}" for pk=${params.pk} sk=${params.sk} after ${timeout}ms`,
  );
}

describe('advisory-ctrl', () => {
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

    // Trap all DecisionPacket-related CDC events
    // CDC auto-expands: DECISION_PACKET → DECISION_PACKET_CREATED (INSERT) / DECISION_PACKET_UPDATED (MODIFY)
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_UPDATED',
        'AGENT_INVOCATION_CREATED',
        'AGENT_INVOCATION_UPDATED',
        'WORKFLOW_STATE_CREATED',
        'WORKFLOW_STATE_UPDATED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Compliance Callback Path ────────────────────────────────────────

  describe('compliance callback path', () => {
    it('should update DecisionPacket to BLOCKED on DECISION_BLOCKED', async () => {
      const dpId = `integ-dp-blocked-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_BLOCKED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          reason: 'Integration test block',
          authorityLevel: 'L1',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('BLOCKED');
      expect(item['complianceResult']).toBe('BLOCKED');
      expect(item['blockReason']).toBe('Integration test block');

      // CDC verification
      const cdcEvent = await trap.waitForEvent({ detailType: 'DECISION_PACKET_CREATED', timeoutMs: 30_000 });
      expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
    }, 120_000);

    it('should update DecisionPacket to APPROVED on DECISION_APPROVED (L1 autonomous)', async () => {
      const dpId = `integ-dp-approved-l1-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          authorityLevel: 'L1',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('APPROVED');
      expect(item['complianceResult']).toBe('APPROVED');
      expect(item['authorityLevel']).toBe('L1');
    }, 120_000);

    it('should update DecisionPacket to AWAITING_CONFIRMATION on DECISION_APPROVED (L2)', async () => {
      const dpId = `integ-dp-approved-l2-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          authorityLevel: 'L2',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('AWAITING_CONFIRMATION');
      expect(item['complianceResult']).toBe('APPROVED');
      expect(item['authorityLevel']).toBe('L2');
    }, 120_000);
  });

  // ── User Response Path ──────────────────────────────────────────────

  describe('user response path', () => {
    it('should update DecisionPacket to CONFIRMED on USER_CONFIRMED', async () => {
      const dpId = `integ-dp-confirmed-${Date.now()}`;

      // Event-driven fixture: DECISION_APPROVED(L2) creates DecisionPacket
      // with status AWAITING_CONFIRMATION (replaces seeder.seed)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          authorityLevel: 'L2',
        },
      });

      // Wait for DecisionPacket to reach AWAITING_CONFIRMATION
      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      await waitForFieldValue(table, {
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        field: 'status',
        expected: 'AWAITING_CONFIRMATION',
        timeoutMs: 60_000,
      });

      // Now publish USER_CONFIRMED
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'USER_CONFIRMED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
        },
      });

      // Poll until status changes to CONFIRMED
      const item = await waitForFieldValue(table, {
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        field: 'status',
        expected: 'CONFIRMED',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('CONFIRMED');
      expect(item['userDecision']).toBe('CONFIRMED');
    }, 180_000);

    it('should update DecisionPacket to REJECTED on USER_REJECTED', async () => {
      const dpId = `integ-dp-rejected-${Date.now()}`;

      // Event-driven fixture: DECISION_APPROVED(L2) creates AWAITING_CONFIRMATION state
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          authorityLevel: 'L2',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      await waitForFieldValue(table, {
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        field: 'status',
        expected: 'AWAITING_CONFIRMATION',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'USER_REJECTED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          reason: 'Integration test rejection',
        },
      });

      const item = await waitForFieldValue(table, {
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        field: 'status',
        expected: 'REJECTED',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('REJECTED');
      expect(item['userDecision']).toBe('REJECTED');
      expect(item['rejectionReason']).toBe('Integration test rejection');
    }, 180_000);
  });

  // ── Agent Trigger Path — DDB write + CDC verification ─────────────────
  // These events invoke DecisionLifecycleService → Bedrock AgentCore.
  // The service writes a DecisionPacket (status: DRAFT) via putIfNotExists
  // BEFORE invoking the agent pipeline. If the agent responds, additional
  // updates (AGENTS_COMPLETED) follow. If the agent is unavailable the
  // handler throws, but the initial DRAFT record is already persisted.
  //
  // We verify the handler processes the event by waiting for the
  // DECISION_PACKET_CREATED CDC event emitted from the DDB Stream. The DDB pk
  // includes the EventBridge event ID (not predictable), so we use the
  // trap rather than direct DDB queries.
  //
  // The Bedrock agent response is non-deterministic in integration tests.

  describe('agent trigger events (CDC verification)', () => {
    const triggerEvents = [
      {
        detailType: 'MANDATE_CREATED',
        detail: { mandateId: 'integ-mandate', level: 'DISCRETIONARY' },
      },
      {
        detailType: 'GOAL_CREATED',
        detail: { goalId: 'integ-goal', objective: 'GROWTH' },
      },
      {
        detailType: 'GOAL_UPDATED',
        detail: { goalId: 'integ-goal', objective: 'INCOME' },
      },
      {
        detailType: 'RISK_PROFILE_CREATED',
        detail: { score: 7, band: 'MODERATE' },
      },
      {
        detailType: 'RISK_PROFILE_UPDATED',
        detail: { score: 9, band: 'AGGRESSIVE' },
      },
      {
        detailType: 'OPERATING_MODE_CHANGED',
        detail: { mode: 'AGGRESSIVE', previousMode: 'BALANCED' },
      },
      {
        detailType: 'PORTFOLIO_DRIFT_DETECTED',
        detail: { driftPercent: 5.2, threshold: 3.0 },
      },
      {
        detailType: 'ORDER_FILLED',
        detail: { orderId: 'integ-order', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150 },
      },
      {
        detailType: 'ORDER_REJECTED',
        detail: { orderId: 'integ-reject', symbol: 'TSLA', reason: 'Margin' },
      },
      {
        detailType: 'ORDER_CANCELLED',
        detail: { orderId: 'integ-cancel', symbol: 'GOOG' },
      },
      {
        detailType: 'DEPOSIT_DETECTED',
        detail: { depositId: 'integ-dep', amountCents: 100_000 },
      },
    ];

    it.each(triggerEvents)(
      'should process $detailType and emit DECISION_PACKET_CREATED via CDC',
      async ({ detailType, detail }) => {
        await eb.putEvent({
          bus: 'advisory',
          targetService: 'advisory-ctrl',
          detailType,
          detail: {
            ...detail,
            tenantId: ctx.tenantId,
          },
        });

        // CDC verification
        const cdcEvent = await trap.waitForEvent({
          detailType: 'DECISION_PACKET_CREATED',
          timeoutMs: 30_000,
        });
        expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
        expect(cdcEvent.detail).toBeDefined();
      },
      60_000,
    );
  });
});
