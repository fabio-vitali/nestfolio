import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * advisory-ctrl integration tests — compliance callback + user response paths.
 *
 * Handler groups tested:
 * 1. Compliance callback: DECISION_BLOCKED, DECISION_APPROVED (L1 → APPROVED, L2 → AWAITING_CONFIRMATION)
 * 2. User response: USER_CONFIRMED, USER_REJECTED (use DECISION_APPROVED L2 as event-driven fixture)
 *
 * NOT tested here:
 *   Agent trigger path (MANDATE_CREATED, GOAL_CREATED, etc.) — these invoke the
 *   DecisionLifecycleService which calls Bedrock AgentCore via the agent-orchestrator
 *   library (createOrchestrator/invokeOrchestrator). This is NOT an HTTP endpoint and
 *   cannot be redirected via SsmOverrideFixture + MockApiFixture. Testing the agent
 *   trigger path requires either a deployed AgentRuntime or a different mocking strategy
 *   at the agent-orchestrator library level.
 *
 * DDB entity: DecisionPacket
 *   pk: DecisionPacket#<tenantId>#<dpId>
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
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'DECISION_PACKET',
        'AGENT_INVOCATION',
        'WORKFLOW_STATE',
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
});
