import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * advisory-ctrl integration test — event-listener path only (no agent invocations).
 *
 * Event path tested:
 *   advisoryBus DECISION_BLOCKED
 *   → advisory-ctrl Ingress (SQS → Lambda)
 *   → processComplianceCallback()
 *   → update('DecisionPacket', { status: 'BLOCKED', ... })   [UpdateCommand upsert]
 *   → DynamoDB table
 *
 * pk: DecisionPacket#<tenantId>#<dpId>
 * sk: 'DecisionPacket'
 * Fields set: status, complianceResult, blockReason, updatedAt, timestamp
 *
 * Note: update() uses UpdateCommand (not PutCommand) so __typename is NOT written.
 *       Assertions target status and complianceResult fields instead.
 */
describe('advisory-ctrl: DECISION_BLOCKED → DecisionPacket DDB update', () => {
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

  it('should upsert a DecisionPacket with status BLOCKED on DECISION_BLOCKED', async () => {
    const dpId = `integ-dp-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-ctrl',
      detailType: 'DECISION_BLOCKED',
      detail: {
        decisionId: dpId,
        tenantId: ctx.tenantId,
        reason: 'Integration test block',
        authorityLevel: 'L1',
      },
    });

    // pk: DecisionPacket#<tenantId>#<dpId>
    // sk: 'DecisionPacket'  (explicit override in processComplianceCallback)
    const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
    const item = await table.waitForItem({
      table: 'advisory-ctrl',
      pk,
      sk: 'DecisionPacket',
      timeoutMs: 60_000,
    });

    expect(item['status']).toBe('BLOCKED');
    expect(item['complianceResult']).toBe('BLOCKED');
    expect(item['blockReason']).toBe('Integration test block');
  }, 120_000);
});
