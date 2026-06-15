/**
 * Go-live e2e — the FIRST scenario that triggers a live execution-mode switch.
 * Deterministic (no LLM in the switch itself): drives confirmGoLive as an
 * authenticated user, asserts executionMode='live' on the investor-bff profile,
 * the EXECUTION_MODE_CHANGED emission, broker-ctrl's ExecutionMode row = 'live',
 * AND the mandate re-affirmation (MANDATE_REAFFIRMED emission + compliance-ctrl
 * MandateSnapshot bumped to __version 2 — onboarding seeds v1, go-live re-affirms to v2).
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
    const reaffirmTrap = await armEventSubjectTrap(ctx, {
      bus: 'investor',
      detailType: InvestorBffEventTypes.MANDATE_REAFFIRMED,
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

    // Mandate re-affirmation: confirmGoLive bumps the Mandate row's effectiveDate +
    // __version → MANDATE_REAFFIRMED (DRY Mandate subject, status still ACTIVE).
    const reaffirm = await reaffirmTrap.waitForSubject(180_000);
    expect(reaffirm['status']).toBe('ACTIVE');

    // …forwarded investor→advisory (advisory-adpt) and projected by compliance-ctrl
    // into the MandateSnapshot (pk=GuardrailPolicy#tenant#user). Onboarding seeded
    // __version 1 via MANDATE_ISSUED; the re-affirm advances it to 2.
    const complianceTable = await ctx.ssm.tableName('compliance-ctrl');
    const snapshot = await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: complianceTable,
        Key: { pk: `GuardrailPolicy#${tenant.tenantId}#${tenant.userId}`, sk: 'MandateSnapshot' },
      }));
      return typeof r.Item?.['__version'] === 'number' && r.Item['__version'] >= 2 ? r.Item : undefined;
    }, 180_000);
    expect(snapshot['__version']).toBeGreaterThanOrEqual(2);
    expect(snapshot['status']).toBe('ACTIVE');
  }, 600_000);
});
