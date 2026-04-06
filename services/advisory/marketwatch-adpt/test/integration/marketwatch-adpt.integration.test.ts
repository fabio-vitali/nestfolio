import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * marketwatch-adpt integration test
 *
 * Strategy:
 *   - Trigger FETCH_MARKETWATCH_REQUESTED on advisoryBus
 *   - Handler fetches two public RSS feeds (no API key required) and writes
 *     MarketWatchArticle records to DDB.
 *   - We verify DDB write directly using TableAssertions.
 *
 * PK/SK pattern:
 *   MarketWatchArticle → pk: MarketWatch#SYSTEM, sk: Feed#topstories | Feed#marketpulse
 *
 * Note: marketwatch-adpt uses a SYSTEM-level PK (not tenant-scoped), so we query
 * without a tenant prefix.
 */
describe('marketwatch-adpt: FETCH_MARKETWATCH_REQUESTED → MarketWatchArticle DDB write', () => {
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

  it('should fetch MarketWatch RSS and write MarketWatchArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    // Verify DDB write — proves: EB → SQS → Lambda → DDB write (MarketWatchArticle)
    // pk: MarketWatch#SYSTEM is SYSTEM-scoped (not tenant-scoped)
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
});
