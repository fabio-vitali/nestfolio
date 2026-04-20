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
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';

/**
 * decision-workflow-ctrl integration tests — trigger paths + CDC chain.
 *
 * Handler groups tested:
 * 1. TriggerIngress (all 11): MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED,
 *    RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED,
 *    PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED,
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

/**
 * Poll Step Functions ListExecutions until an execution started after `since`
 * appears on the given state machine ARN. Returns the execution metadata.
 */
async function waitForSfExecution(
  sfn: SFNClient,
  params: {
    stateMachineArn: string;
    since: Date;
    timeoutMs?: number;
  },
): Promise<{ executionArn: string; startDate: Date; name: string }> {
  const timeout = params.timeoutMs ?? 60_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const resp = await sfn.send(new ListExecutionsCommand({
      stateMachineArn: params.stateMachineArn,
      maxResults: 20,
    }));
    const fresh = (resp.executions ?? []).find(
      (e) => e.startDate && new Date(e.startDate) >= params.since,
    );
    if (fresh?.executionArn && fresh.startDate && fresh.name) {
      return {
        executionArn: fresh.executionArn,
        startDate: new Date(fresh.startDate),
        name: fresh.name,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout: no SF execution on ${params.stateMachineArn} started after ${params.since.toISOString()} within ${timeout}ms`,
  );
}

describe('decision-workflow-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let sfn: SFNClient;
  let stateMachineArn: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    sfn = new SFNClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const prefix = process.env.NESTFOLIO_INTEG_PREFIX ?? 'integ';
    // ctx.accountId is not exposed by @nestfolio/test-support; resolve via STS.
    const sts = new (await import('@aws-sdk/client-sts')).STSClient({});
    const ident = await sts.send(new (await import('@aws-sdk/client-sts')).GetCallerIdentityCommand({}));
    stateMachineArn = `arn:aws:states:${process.env.AWS_REGION ?? 'us-east-1'}:${ident.Account}:stateMachine:${prefix}-decision-workflow-ctrl-decisionstatemachine`;

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

  it('should write WorkflowTrigger on MANDATE_CREATED, emit CDC, and start SF', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;
    const testStart = new Date();

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
    const cdcEvent = await trap.waitForEvent<BusEventPayload>({
      detailType: 'WORKFLOW_TRIGGER_CREATED',
      timeoutMs: 60_000,
    });
    expect(cdcEvent.detail.subject.trigger).toBe('MANDATE_CREATED');
    expect(cdcEvent.detail.subject.tenantId).toBe(ctx.tenantId);

    // Verify: the canonical event starts an SF execution
    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

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

  // ── TriggerIngress: GOAL_UPDATED ──────────────────────────────────

  it('should write WorkflowTrigger on GOAL_UPDATED', async () => {
    const goalId = `integ-goal-upd-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'GOAL_UPDATED',
      detail: {
        goalId,
        tenantId: ctx.tenantId,
        objective: 'INCOME',
        targetAmountCents: 1_000_000,
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'GOAL_UPDATED',
      contextMatch: goalId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('GOAL_UPDATED');
  }, 120_000);

  // ── TriggerIngress: RISK_PROFILE_CREATED ──────────────────────────

  it('should write WorkflowTrigger on RISK_PROFILE_CREATED', async () => {
    const riskProfileId = `integ-riskp-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'RISK_PROFILE_CREATED',
      detail: {
        riskProfileId,
        tenantId: ctx.tenantId,
        score: 7,
        band: 'MODERATE',
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'RISK_PROFILE_CREATED',
      contextMatch: riskProfileId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('RISK_PROFILE_CREATED');
  }, 120_000);

  // ── TriggerIngress: RISK_PROFILE_UPDATED ──────────────────────────

  it('should write WorkflowTrigger on RISK_PROFILE_UPDATED', async () => {
    const riskProfileId = `integ-riskp-upd-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'RISK_PROFILE_UPDATED',
      detail: {
        riskProfileId,
        tenantId: ctx.tenantId,
        score: 9,
        band: 'AGGRESSIVE',
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'RISK_PROFILE_UPDATED',
      contextMatch: riskProfileId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('RISK_PROFILE_UPDATED');
  }, 120_000);

  // ── TriggerIngress: OPERATING_MODE_CHANGED ────────────────────────

  it('should write WorkflowTrigger on OPERATING_MODE_CHANGED', async () => {
    const modeChangeId = `integ-mode-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'OPERATING_MODE_CHANGED',
      detail: {
        modeChangeId,
        tenantId: ctx.tenantId,
        mode: 'CONSERVATIVE',
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'OPERATING_MODE_CHANGED',
      contextMatch: modeChangeId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('OPERATING_MODE_CHANGED');
  }, 120_000);

  // ── TriggerIngress: ORDER_FILLED ──────────────────────────────────

  it('should write WorkflowTrigger on ORDER_FILLED', async () => {
    const orderId = `integ-fill-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150,
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'ORDER_FILLED',
      contextMatch: orderId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('ORDER_FILLED');
  }, 120_000);

  // ── TriggerIngress: ORDER_REJECTED ────────────────────────────────

  it('should write WorkflowTrigger on ORDER_REJECTED', async () => {
    const orderId = `integ-rej-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'TSLA',
        reason: 'Margin',
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'ORDER_REJECTED',
      contextMatch: orderId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('ORDER_REJECTED');
  }, 120_000);

  // ── TriggerIngress: ORDER_CANCELLED ───────────────────────────────

  it('should write WorkflowTrigger on ORDER_CANCELLED', async () => {
    const orderId = `integ-cancel-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_CANCELLED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'GOOG',
      },
    });

    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'ORDER_CANCELLED',
      contextMatch: orderId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('ORDER_CANCELLED');
  }, 120_000);
});
