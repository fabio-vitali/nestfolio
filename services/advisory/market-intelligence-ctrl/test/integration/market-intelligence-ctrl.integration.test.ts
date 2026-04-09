import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('market-intelligence-ctrl: ANALYZE_MARKET → AgentInvocation DDB write + CDC', () => {
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
      detailType: ['MARKET_SIGNAL_DETECTED'],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write AgentInvocation record to DDB after ANALYZE_MARKET', async () => {
    const decisionId = `integ-decision-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'ANALYZE_MARKET',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: 'integ-task-token',
      },
    });

    // agent-service writes directly with pk: DECISION#<decisionId>, sk: INV#<uuid>, status IN_PROGRESS
    // before calling the agent pipeline, so this write is observable even with a fake task token
    const item = await table.waitForItem({
      table: 'market-intelligence-ctrl',
      pk: `DECISION#${decisionId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['agentName']).toBe('market-research');
    expect(item['decisionId']).toBe(decisionId);

    // CDC verification — stack emits MARKET_SIGNAL_DETECTED from AgentInvocation inserts
    const cdcEvent = await trap.waitForEvent({
      detailType: 'MARKET_SIGNAL_DETECTED',
    });
    expect(cdcEvent.detailType).toBe('MARKET_SIGNAL_DETECTED');
  }, 120_000);
});
