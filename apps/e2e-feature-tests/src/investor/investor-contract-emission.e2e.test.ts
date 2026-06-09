/**
 * Validation-gate e2e — investor-domain producer contracts vs REAL deployed emission.
 *
 * The CDC publisher emits the whole DDB row as the event subject. A row that parses
 * against its contract proves the emitted subject satisfies the contract.
 *
 * Coverage (naturally produced by onboarded() + withHoldings()):
 *   investor-bff:  InvestorProfile (sk='InvestorProfile'), Mandate (sk='Mandate'),
 *                  Notification read-model (sk='Notification#…' → NotificationRead)
 *   investor-ctrl: Notification (__typename='Notification'), MonthlyReport (__typename='MonthlyReport')
 *
 * NOT covered here (documented boundary): ExecutionModeChanged — no e2e fixture triggers
 * a live execution-mode switch; covered by investor-bff producer unit test against the
 * setExecutionMode write literal.
 *
 * Key table-key facts (confirmed from code):
 *   investor-bff:
 *     - InvestorProfile pk=InvestorProfile#${tenantId}#${userId} sk=InvestorProfile
 *     - Mandate         pk=InvestorProfile#${tenantId}#${userId} sk=Mandate
 *     - Notification    pk=InvestorProfile#${tenantId}#${userId} sk=Notification#${notificationId}
 *   investor-ctrl (notificationId/reportId are ctx.eventId-derived → query by GSI):
 *     - Notification    pk=Notification#${tenantId}#${notificationId}    sk=Notification
 *     - MonthlyReport   pk=MonthlyReport#${tenantId}#${reportId}         sk=MonthlyReport
 *     tenantId-index GSI: PK=tenantId, SK=__typename, ProjectionType=ALL.
 *
 * DO NOT run this directly against dev outside the closing phase. This file exists to
 * prove typechecking passes; execution is gated by the closing task.
 */

import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, withHoldings, poll, type FreshTenant } from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorProfileUpdatedSchema, NotificationReadSchema } from '@nestfolio/investor-bff/contracts';
import { MandateSchema } from '@nestfolio/investor-adpt/domain';
import { NotificationCreatedSchema, MonthlyReportSchema } from '@nestfolio/investor-ctrl/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

describe('investor-domain producer contracts match REAL deployed emission', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // onboarded() → ONBOARDING_COMPLETED: investor-bff writes InvestorProfile + Mandate;
    //   investor-ctrl writes a Notification; investor-bff projects NOTIFICATION_CREATED
    //   into its Notification read-model row.
    // withHoldings() → ORDER_FILLED: investor-ctrl writes a MonthlyReport (+ Notification).
    await applyFixtures(ctx, tenant, [
      onboarded(),
      withHoldings([{ symbol: 'VTI', quantity: 50, fillPrice: 200 }]),
    ]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it(
    'investor-bff: InvestorProfile + Mandate + Notification read-model subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('investor-bff');
      const pk = `InvestorProfile#${tenant.tenantId}#${tenant.userId}`;

      const profile = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'InvestorProfile' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      expectContractMatch(InvestorProfileUpdatedSchema, profile, 'InvestorProfileUpdated');

      const mandate = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'Mandate' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      expectContractMatch(MandateSchema, mandate, 'Mandate');

      const notifs = await poll(async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Notification#' },
        }));
        return (r.Items ?? []).length ? (r.Items as Record<string, unknown>[]) : undefined;
      }, 120_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationReadSchema, row, `NotificationRead[${i}]`));
    },
    420_000,
  );

  it(
    'investor-ctrl: Notification + MonthlyReport subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('investor-ctrl');
      const byTypename = async (typename: string): Promise<Record<string, unknown>[]> => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          IndexName: 'tenantId-index',
          KeyConditionExpression: 'tenantId = :t AND #tn = :tn',
          ExpressionAttributeNames: { '#tn': '__typename' },
          ExpressionAttributeValues: { ':t': tenant.tenantId, ':tn': typename },
        }));
        return (r.Items ?? []) as Record<string, unknown>[];
      };

      const notifs = await poll(async () => {
        const items = await byTypename('Notification');
        return items.length ? items : undefined;
      }, 180_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationCreatedSchema, row, `NotificationCreated[${i}]`));

      const reports = await poll(async () => {
        const items = await byTypename('MonthlyReport');
        return items.length ? items : undefined;
      }, 180_000);
      expect(reports.length).toBeGreaterThan(0);
      reports.forEach((row, i) => expectContractMatch(MonthlyReportSchema, row, `MonthlyReport[${i}]`));
    },
    420_000,
  );
});
