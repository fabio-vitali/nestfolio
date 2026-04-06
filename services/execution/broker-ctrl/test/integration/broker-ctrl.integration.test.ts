import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-ctrl: EXECUTION_MODE_CHANGED → ExecutionMode DDB write', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write an ExecutionMode record on EXECUTION_MODE_CHANGED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: {
        mode: 'live',
      },
    });

    // Verify: ExecutionMode record written to DDB
    // pk: ExecutionMode#<tenantId>, sk: ExecutionMode
    const item = await table.waitForItem({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('ExecutionMode');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['mode']).toBe('live');
  }, 120_000);
});
