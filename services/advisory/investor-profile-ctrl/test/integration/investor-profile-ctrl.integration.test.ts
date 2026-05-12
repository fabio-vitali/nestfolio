import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';

describe('investor-profile-ctrl: ANALYZE_INVESTOR_PROFILE → AgentInvocation DDB write + CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });

    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['GOAL_INTERPRETATION_PRODUCED'],
    });
  }, 120_000);

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
          operatingMode: 'BALANCED',
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
      timeoutMs: 20_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['decisionId']).toBe(decisionId);
    expect(item['status']).toMatch(/^(IN_PROGRESS|COMPLETED)$/);

    // CDC verification — stack emits GOAL_INTERPRETATION_PRODUCED from AgentInvocation inserts
    const cdcEvent = await trap.waitForEvent({
      detailType: 'GOAL_INTERPRETATION_PRODUCED',
    });
    expect(cdcEvent.detailType).toBe('GOAL_INTERPRETATION_PRODUCED');
  }, 120_000);
});
