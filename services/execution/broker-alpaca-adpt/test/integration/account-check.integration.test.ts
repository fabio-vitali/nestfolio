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

describe('broker-alpaca-adpt: account check', () => {
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
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should create account snapshot and emit ALPACA_ACCOUNT_SNAPSHOT', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ACCOUNT_CHECK',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `AccountSnapshot#${ctx.tenantId}`,
    });
    expect(item['equity']).toBe('125000.00');
    expect(item['positions']).toHaveLength(1);

    const event = await trap.waitForEvent({ detailType: 'ALPACA_ACCOUNT_SNAPSHOT' });
    expect(event.detail.subject.equity).toBe('125000.00');
  }, 60_000);
});
