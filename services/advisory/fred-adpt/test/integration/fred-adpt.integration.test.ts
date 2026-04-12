import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

/**
 * fred-adpt integration test (mocked)
 *
 * Strategy:
 *   - Deploy a mock FRED Lambda behind a Function URL
 *   - Override the SSM base URL parameter to point at the mock
 *   - Trigger FETCH_FRED_REQUESTED on advisoryBus
 *   - Verify DDB writes and CDC events emitted via EventBridge
 *
 * PK/SK pattern:
 *   FredIndicator -> pk: Fred#SYSTEM, sk: Indicator#{seriesId}
 */
describe('fred-adpt (mocked)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();

    // Deploy mock FRED Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-fred.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-fred',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-fred-adpt/fred/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'FRED_INDICATORS_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch FRED indicators and write FredIndicator to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'fred-adpt',
      detailType: 'FETCH_FRED_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'fred-adpt',
      pk: 'Fred#SYSTEM',
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('FredIndicator');

    const event = await trap.waitForEvent<BusEventPayload>({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('FRED_INDICATORS_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should handle multiple series in a single invocation', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'fred-adpt',
      detailType: 'FETCH_FRED_REQUESTED',
      detail: {},
    });

    const items = await table.queryItems({
      table: 'fred-adpt',
      pk: 'Fred#SYSTEM',
    });

    // Handler fetches 11 series; mock returns values for all 11
    expect(items.length).toBeGreaterThanOrEqual(5);
    const seriesIds = items.map(i => (i['sk'] as string).replace('Indicator#', ''));
    expect(seriesIds).toContain('FEDFUNDS');
    expect(seriesIds).toContain('DGS10');
  }, 120_000);
});
