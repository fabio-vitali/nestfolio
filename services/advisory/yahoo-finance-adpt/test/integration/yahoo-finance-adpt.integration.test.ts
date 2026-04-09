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

describe('yahoo-finance-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-yahoo-finance.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-yahoo-finance',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-yahoo-finance-adpt/yahoo/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'YAHOO_FINANCE_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch Yahoo Finance RSS and write YahooFinanceArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

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

  it('should write articles for multiple tickers', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#VTI',
      timeoutMs: 60_000,
    });

    const bnd = await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#BND',
      timeoutMs: 10_000,
    });
    expect(bnd['ticker']).toBe('BND');
  }, 120_000);

  it('should emit YAHOO_FINANCE_UPDATED CDC event', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    const event = await trap.waitForEvent<BusEventPayload>({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('YAHOO_FINANCE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
