import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

/**
 * yahoo-finance-adpt integration test
 *
 * Strategy:
 *   - Trigger FETCH_YAHOO_FINANCE_REQUESTED on advisoryBus
 *   - Handler fetches public Yahoo Finance RSS feeds for configured tickers
 *     (default: VTI,BND,QQQ,VTIP,SPY — no API key required) and writes
 *     YahooFinanceArticle records to DDB.
 *   - We verify DDB write directly using TableAssertions.
 *
 * PK/SK pattern:
 *   YahooFinanceArticle → pk: YahooFinance#SYSTEM, sk: Ticker#{ticker}
 *
 * Note: yahoo-finance-adpt uses a SYSTEM-level PK (not tenant-scoped).
 */
describe('yahoo-finance-adpt: FETCH_YAHOO_FINANCE_REQUESTED → YahooFinanceArticle DDB write', () => {
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

  it('should fetch Yahoo Finance RSS and write YahooFinanceArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    // Verify DDB write — proves: EB → SQS → Lambda → DDB write (YahooFinanceArticle)
    // pk: YahooFinance#SYSTEM is SYSTEM-scoped (not tenant-scoped)
    // sk: Ticker#VTI — VTI is first ticker in default TICKERS env var
    const item = await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#VTI',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('YahooFinanceArticle');
    expect(item['source']).toBe('yahoo-finance');
    expect(item['ticker']).toBe('VTI');
  }, 120_000);
});
