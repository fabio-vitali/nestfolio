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
} from '@nestfolio/integration-testing';

/**
 * sec-edgar-adpt integration test (mocked)
 *
 * Strategy:
 *   - Deploy a mock SEC EDGAR Lambda behind a Function URL
 *   - Override the SSM base URL parameter to point at the mock
 *   - Trigger FETCH_SEC_EDGAR_REQUESTED on advisoryBus
 *   - Verify DDB writes and CDC events emitted via EventBridge
 *
 * PK/SK pattern:
 *   SecFiling -> pk: SecFiling#{cik}, sk: Filing#{accessionNumber}
 *
 * CDC events depend on form type:
 *   8-K -> SEC_8K_FILED
 *   485BPOS, N-1A -> SEC_PROSPECTUS_UPDATED
 *   10-K, 10-Q -> SEC_10K_UPDATED
 */
describe('sec-edgar-adpt (mocked)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();

    // Deploy mock SEC EDGAR Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-sec-edgar.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-sec-edgar',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-sec-edgar-adpt/edgar/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: ['SEC_8K_FILED', 'SEC_PROSPECTUS_UPDATED', 'SEC_10K_UPDATED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should process 8-K filing and emit SEC_8K_FILED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000102909',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('8-K');
    expect(item['issuer']).toBe('Vanguard Group Inc');

    const event = await trap.waitForEvent({ detailType: 'SEC_8K_FILED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_8K_FILED');
  }, 120_000);

  it('should process 485BPOS filing and emit SEC_PROSPECTUS_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000088053',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('485BPOS');

    const event = await trap.waitForEvent({ detailType: 'SEC_PROSPECTUS_UPDATED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_PROSPECTUS_UPDATED');
  }, 120_000);

  it('should process 10-K filing and emit SEC_10K_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000914208',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('10-K');

    const event = await trap.waitForEvent({ detailType: 'SEC_10K_UPDATED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_10K_UPDATED');
  }, 120_000);
});
