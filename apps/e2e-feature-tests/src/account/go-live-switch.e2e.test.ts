/**
 * Go-live e2e — the FIRST scenario that triggers a live execution-mode switch.
 * Deterministic (no LLM in the switch itself): drives confirmGoLive as an
 * authenticated user, asserts executionMode='live' on the investor-bff profile,
 * the EXECUTION_MODE_CHANGED emission, and broker-ctrl's ExecutionMode row = 'live'.
 */
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, bffClient, poll, type FreshTenant } from '..';
import { armEventSubjectTrap } from '../helpers/event-subject-trap';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

jest.retryTimes(1);

describe('go-live — simulation→live switch', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddb: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
  }, 600_000);

  afterEach(async () => {
    ddb?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it('confirmGoLive flips executionMode to live end-to-end', async () => {
    const trap = await armEventSubjectTrap(ctx, {
      bus: 'investor',
      detailType: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
    });

    const bff = bffClient(ctx, tenant);
    const res = await bff.investor.mutate<{ confirmGoLive: { executionMode: string } }>(
      `mutation { confirmGoLive { executionMode } }`,
      {},
    );
    expect(res.confirmGoLive.executionMode).toBe('live');

    const subject = await trap.waitForSubject(180_000);
    expect(subject['toMode']).toBe('live');

    const ibTable = await ctx.ssm.tableName('investor-bff');
    const profile = await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: ibTable,
        Key: { pk: `InvestorProfile#${tenant.tenantId}#${tenant.userId}`, sk: 'InvestorProfile' },
      }));
      return r.Item?.['executionMode'] === 'live' ? r.Item : undefined;
    }, 60_000);
    expect(profile['executionMode']).toBe('live');

    const brokerTable = await ctx.ssm.tableName('broker-ctrl');
    const mode = await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: brokerTable,
        Key: { pk: `ExecutionMode#${tenant.tenantId}`, sk: 'ExecutionMode' },
      }));
      return r.Item?.['mode'] === 'live' ? r.Item : undefined;
    }, 180_000);
    expect(mode['mode']).toBe('live');
  }, 600_000);
});
