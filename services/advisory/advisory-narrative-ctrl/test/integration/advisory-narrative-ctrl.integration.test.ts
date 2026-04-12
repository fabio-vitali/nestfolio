import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('advisory-narrative-ctrl: GENERATE_NARRATIVE → AgentInvocation DDB write + CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['EXPLANATION_GENERATED'],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write AgentInvocation record to DDB on GENERATE_NARRATIVE', async () => {
    const decisionId = `integ-narrative-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-narrative-ctrl',
      detailType: 'GENERATE_NARRATIVE',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: 'integ-task-token',
      },
    });

    // agent-service writes IN_PROGRESS record directly to DDB before calling the agent pipeline:
    // pk: DECISION#<decisionId>, sk: INV#<uuid>, agentName: 'explainability'
    const item = await table.waitForItem({
      table: 'advisory-narrative-ctrl',
      pk: `DECISION#${decisionId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['agentName']).toBe('explainability');
    expect(item['decisionId']).toBe(decisionId);

    // CDC verification — stack emits EXPLANATION_GENERATED from ReasoningOutput inserts
    const cdcEvent = await trap.waitForEvent({
      detailType: 'EXPLANATION_GENERATED',
    });
    expect(cdcEvent.detailType).toBe('EXPLANATION_GENERATED');
  }, 120_000);
});
