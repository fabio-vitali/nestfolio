import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * portfolio-engine-ctrl integration test — event-listener path only (agent NOT invoked).
 *
 * Event path tested:
 *   advisoryBus CONSTRUCT_PORTFOLIO
 *   → portfolio-engine-ctrl Ingress (SQS → Lambda via resumeStateMachine pipeline)
 *   → CONSTRUCT_PORTFOLIO handler
 *   → agent-service.runPipeline() → DDB PutCommand (IN_PROGRESS)
 *   → DynamoDB table
 *
 * EventBridgeClient wraps params.detail as payload.subject, so detail fields
 * { tenantId, decisionId, taskToken } arrive directly as payload.subject.
 * resumeStateMachine reads payload.subject.taskToken.
 * agent-service writes:
 *   pk: DECISION#<decisionId>
 *   sk: INV#<uuid>
 *   __typename: 'AgentInvocation'
 *   status: 'IN_PROGRESS' (or 'COMPLETED' if agent finishes quickly)
 *   tenantId: <tenantId>
 *   decisionId: <decisionId>
 *
 * Note: agentName is NOT written by agent-service (unlike advisory-narrative-ctrl).
 *       The record() intent in the handler adds agentName via CDC, not tested here.
 *       With taskToken 'integ-task-token' the SFN SendTaskSuccess call will fail (no real
 *       SF execution), but the DDB write completes before that, so the assertion holds.
 */
describe('portfolio-engine-ctrl: CONSTRUCT_PORTFOLIO → AgentInvocation DDB write + CDC', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['AGENT_INVOCATION_CREATED'],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write AgentInvocation record to DDB on CONSTRUCT_PORTFOLIO', async () => {
    const decisionId = `integ-portfolio-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'CONSTRUCT_PORTFOLIO',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: 'integ-task-token',
        context: {},
      },
    });

    // agent-service writes IN_PROGRESS record before invoking the agent pipeline:
    // pk: DECISION#<decisionId>, sk: INV#<uuid>
    const item = await table.waitForItem({
      table: 'portfolio-engine-ctrl',
      pk: `DECISION#${decisionId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['decisionId']).toBe(decisionId);
    // status may be IN_PROGRESS or COMPLETED depending on agent execution speed —
    // either is valid; the presence of an AgentInvocation record is what matters.
    expect(['IN_PROGRESS', 'COMPLETED']).toContain(item['status']);

    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
  }, 120_000);
});
