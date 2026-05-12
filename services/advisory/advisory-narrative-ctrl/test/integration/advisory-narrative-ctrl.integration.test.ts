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

describe('advisory-narrative-ctrl: GENERATE_NARRATIVE → AgentInvocation DDB write + CDC', () => {
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
      paramName: `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });

    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['EXPLANATION_GENERATED'],
    });
  }, 120_000);

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
        operatingMode: 'BALANCED',
      },
    });

    // 60 s is architecturally required, NOT a cold-start hedge. The handler
    // runs 5 parallel AgentCore Memory reads + a 4-iteration retry loop on the
    // upstream portfolio-engine record (3+5+8+12 = 28 s of forced sleep when
    // the record is missing, which it always is in integration where SF is
    // bypassed) BEFORE agentService.runPipeline writes the IN_PROGRESS row at
    // services/advisory/advisory-narrative-ctrl/src/agent-service.ts:38-47.
    // Typical observed wall-clock: 30-40 s. See
    // docs/backlog/advisory-narrative-ctrl-tightening-cold-start-flake.md for
    // the full investigation and follow-up fix paths.
    // pk: DECISION#<decisionId>, sk: INV#<eventId>, agentName: 'explainability'
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
