import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt: transfer flow', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: ['ALPACA_TRANSFER_INITIATED', 'ALPACA_TRANSFER_COMPLETED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should initiate transfer, trigger polling SF, and complete', async () => {
    const transferId = `integ-transfer-ok-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: {
        transferId,
        direction: 'INCOMING',
        amount: 10000,
        relationshipId: 'rel-integ',
      },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['status']).toBe('INITIATED');

    const initiatedEvent = await trap.waitForEvent({ detailType: 'ALPACA_TRANSFER_INITIATED' });
    expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);

    const completedEvent = await trap.waitForEvent({
      detailType: 'ALPACA_TRANSFER_COMPLETED',
      timeoutMs: 90_000,
    });
    expect(completedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
  }, 120_000);
});
