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
  type BusEventPayload,
} from '@nestfolio/integration-testing';

/**
 * marketwatch-adpt integration test (mocked)
 *
 * Strategy:
 *   - Deploy a mock MarketWatch Lambda behind a Function URL
 *   - Override the SSM base URL parameter to point at the mock
 *   - Trigger FETCH_MARKETWATCH_REQUESTED on advisoryBus
 *   - Verify DDB writes and CDC events emitted via EventBridge
 *
 * PK/SK pattern:
 *   MarketWatchArticle -> pk: MarketWatch#SYSTEM, sk: Feed#{feedName}
 */
describe('marketwatch-adpt (mocked)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();

    // Deploy mock MarketWatch Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-marketwatch.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-marketwatch',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-marketwatch-adpt/marketwatch/baseUrl`,
      testValue: mockUrl,
      restoreTo: 'https://feeds.marketwatch.com/marketwatch',
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'MARKETWATCH_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch RSS and write MarketWatchArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#topstories',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('MarketWatchArticle');
    expect(item['source']).toBe('marketwatch');
    expect(item['feed']).toBe('topstories');
  }, 120_000);

  it('should emit MARKETWATCH_UPDATED CDC event', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    const event = await trap.waitForEvent<BusEventPayload>({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('MARKETWATCH_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should write both topstories and marketpulse feeds', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#topstories',
      timeoutMs: 60_000,
    });

    const marketpulse = await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#marketpulse',
      timeoutMs: 10_000,
    });

    expect(marketpulse['__typename']).toBe('MarketWatchArticle');
    expect(marketpulse['feed']).toBe('marketpulse');
  }, 120_000);
});
