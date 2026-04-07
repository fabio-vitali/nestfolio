import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * decision-workflow-ctrl integration tests — trigger paths + CDC chain.
 *
 * Handler groups tested:
 * 1. TriggerIngress: MANDATE_CREATED, GOAL_CREATED, PORTFOLIO_DRIFT_DETECTED,
 *    DEPOSIT_DETECTED → WorkflowTrigger DDB write
 * 2. CDC chain: WorkflowTrigger DDB insert → WORKFLOW_TRIGGER_CREATED on advisory bus
 *
 * NOT tested here:
 *   CallbackIngress (sfn-callback.ts) — the resumeStateMachine pipeline requires a valid
 *   taskToken from a running Step Functions execution. Testing the callback path requires:
 *   (1) send trigger event, (2) wait for SF to start and emit agent dispatch events with
 *   task tokens, (3) send callback events with those tokens. This full lifecycle test
 *   would take 120-180s per run and depends on the SF definition plus AgentCore Memory
 *   being wired. Deferred to a dedicated SF lifecycle test plan.
 *
 * DDB entity: WorkflowTrigger (via record())
 *   pk: T#<tenantId>
 *   sk: WorkflowTrigger#<uuid>  (auto-generated eventId)
 *
 * CDC eventTypes config (from Egress):
 *   WorkflowTrigger → WORKFLOW_TRIGGER  (auto-expands to WORKFLOW_TRIGGER_CREATED on INSERT)
 *   DecisionPacket → DECISION_PACKET
 *   AgentOutput → AGENT_OUTPUT
 */

/**
 * Poll DDB until a WorkflowTrigger record with a specific trigger type and
 * context value appears. Needed because multiple trigger events share the same
 * pk (T#<tenantId>) and sk is a random UUID, so waitForItem cannot target a
 * specific record — we must query + filter with retry.
 */
async function waitForTriggerRecord(
  table: TableAssertions,
  params: {
    table: string;
    pk: string;
    triggerType: string;
    contextMatch: string;
    timeoutMs?: number;
  },
): Promise<Record<string, unknown>> {
  const timeout = params.timeoutMs ?? 60_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const items = await table.queryItems({
      table: params.table,
      pk: params.pk,
      skPrefix: 'WorkflowTrigger#',
    });

    const match = items.find(
      (i) =>
        i['trigger'] === params.triggerType &&
        JSON.stringify(i['context']).includes(params.contextMatch),
    );
    if (match) return match;

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout: WorkflowTrigger with trigger=${params.triggerType} containing "${params.contextMatch}" not found after ${timeout}ms`,
  );
}

describe('decision-workflow-ctrl', () => {
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

    // Trap CDC events emitted by decision-workflow-ctrl Egress
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'WORKFLOW_TRIGGER_CREATED',
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_UPDATED',
        'AGENT_OUTPUT_CREATED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    // Clean up all WorkflowTrigger records created during tests
    // (queryItems-based polling doesn't auto-track items for cleanup)
    try {
      await table.cleanup({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
      });
    } catch {
      // best-effort cleanup
    }
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── TriggerIngress: MANDATE_CREATED ────────────────────────────────

  it('should write WorkflowTrigger on MANDATE_CREATED and emit CDC event', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        targetReturn: 0.08,
        createdAt: new Date().toISOString(),
      },
    });

    // Verify: WorkflowTrigger written to DDB
    // record() default keys: pk = T#<tenantId>, sk = WorkflowTrigger#<eventId>
    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'MANDATE_CREATED',
      contextMatch: mandateId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('MANDATE_CREATED');

    // Verify: CDC emits WORKFLOW_TRIGGER_CREATED on advisory bus
    const cdcEvent = await trap.waitForEvent({
      detailType: 'WORKFLOW_TRIGGER_CREATED',
      timeoutMs: 60_000,
    });
    expect(cdcEvent.detail.subject.trigger).toBe('MANDATE_CREATED');
    expect(cdcEvent.detail.subject.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  // ── TriggerIngress: GOAL_CREATED ───────────────────────────────────

  it('should write WorkflowTrigger on GOAL_CREATED', async () => {
    const goalId = `integ-goal-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'GOAL_CREATED',
      detail: {
        goalId,
        tenantId: ctx.tenantId,
        goalType: 'RETIREMENT',
        targetAmount: 1_000_000,
        targetDate: '2050-01-01',
        createdAt: new Date().toISOString(),
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'GOAL_CREATED',
      contextMatch: goalId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('GOAL_CREATED');
  }, 120_000);

  // ── TriggerIngress: PORTFOLIO_DRIFT_DETECTED ───────────────────────

  it('should write WorkflowTrigger on PORTFOLIO_DRIFT_DETECTED', async () => {
    const portfolioId = `integ-drift-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        portfolioId,
        tenantId: ctx.tenantId,
        driftPercentage: 0.15,
        driftDirection: 'OVERWEIGHT_EQUITY',
        detectedAt: new Date().toISOString(),
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'PORTFOLIO_DRIFT_DETECTED',
      contextMatch: portfolioId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('PORTFOLIO_DRIFT_DETECTED');
  }, 120_000);

  // ── TriggerIngress: DEPOSIT_DETECTED ───────────────────────────────

  it('should write WorkflowTrigger on DEPOSIT_DETECTED', async () => {
    const depositId = `integ-deposit-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId,
        tenantId: ctx.tenantId,
        amount: 5000,
        currency: 'USD',
        detectedAt: new Date().toISOString(),
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'DEPOSIT_DETECTED',
      contextMatch: depositId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('DEPOSIT_DETECTED');
  }, 120_000);
});
