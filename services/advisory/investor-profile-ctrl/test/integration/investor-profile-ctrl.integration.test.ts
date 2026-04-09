import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-profile-ctrl: ANALYZE_INVESTOR_PROFILE → AgentInvocation DDB write + CDC', () => {
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

  it('should write AgentInvocation record to DDB on ANALYZE_INVESTOR_PROFILE', async () => {
    const decisionId = `integ-profile-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-profile-ctrl',
      detailType: 'ANALYZE_INVESTOR_PROFILE',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: 'integ-task-token',
        investorProfile: {
          age: 40,
          income: 120000,
          liquidAssets: 80000,
          investmentExperience: 'MODERATE',
        },
        portfolioState: {
          totalValue: 200000,
          holdings: [],
        },
      },
    });

    // agent-service writes IN_PROGRESS record before agent runs:
    // pk: DECISION#<decisionId>, sk: INV#<uuid>, __typename: AgentInvocation
    const item = await table.waitForItem({
      table: 'investor-profile-ctrl',
      pk: `DECISION#${decisionId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['decisionId']).toBe(decisionId);
    expect(item['status']).toMatch(/^(IN_PROGRESS|COMPLETED)$/);

    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
  }, 120_000);
});
