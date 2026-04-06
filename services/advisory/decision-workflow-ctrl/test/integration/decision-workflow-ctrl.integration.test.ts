import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('decision-workflow-ctrl: MANDATE_CREATED → WorkflowTrigger DDB write', () => {
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

  it('should write a WorkflowTrigger record on MANDATE_CREATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId: 'test-mandate-integ-001',
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        targetReturn: 0.08,
        createdAt: new Date().toISOString(),
      },
    });

    // Verify: WorkflowTrigger written to DDB (proves MANDATE_CREATED → SQS → TriggerIngress Lambda → DDB path)
    // pk = T#<tenantId> (record() default), sk = WorkflowTrigger#<eventId> (record() default)
    const item = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('MANDATE_CREATED');
  }, 120_000);
});
