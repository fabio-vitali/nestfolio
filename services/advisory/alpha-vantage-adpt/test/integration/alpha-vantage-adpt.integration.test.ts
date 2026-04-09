import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * alpha-vantage-adpt integration test (mocked)
 *
 * Strategy:
 *   - Deploy a mock Alpha Vantage Lambda behind a Function URL
 *   - Override the SSM base URL parameter to point at the mock
 *   - Trigger FETCH_ALPHA_VANTAGE_REQUESTED on advisoryBus
 *   - Verify DDB writes and CDC events emitted via EventBridge
 *
 * PK/SK pattern:
 *   AlphaVantageArticle → pk: AlphaVantage#SYSTEM, sk: Article#{ticker}#{date}#{i}
 *   EconomicIndicator   → pk: AlphaVantage#SYSTEM, sk: Indicator#{fn}
 */
describe('alpha-vantage-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    // Deploy mock Alpha Vantage Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-alpha-vantage.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpha-vantage',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-alpha-vantage-adpt/alpha-vantage/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'ALPHA_VANTAGE_NEWS_UPDATED',
        'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch news and emit ALPHA_VANTAGE_NEWS_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'alpha-vantage-adpt',
      detailType: 'FETCH_ALPHA_VANTAGE_REQUESTED',
      detail: {},
    });

    // Verify DDB write
    const item = await table.waitForItem({
      table: 'alpha-vantage-adpt',
      pk: 'AlphaVantage#SYSTEM',
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('AlphaVantageArticle');

    // Verify CDC event
    const event = await trap.waitForEvent<BusEventPayload>({ detailType: 'ALPHA_VANTAGE_NEWS_UPDATED' });
    expect(event.detailType).toBe('ALPHA_VANTAGE_NEWS_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should fetch economic indicators and emit ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'alpha-vantage-adpt',
      detailType: 'FETCH_ALPHA_VANTAGE_REQUESTED',
      detail: {},
    });

    const event = await trap.waitForEvent({
      detailType: 'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED',
      timeoutMs: 90_000,
    });
    expect(event.detailType).toBe('ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED');
  }, 120_000);
});
