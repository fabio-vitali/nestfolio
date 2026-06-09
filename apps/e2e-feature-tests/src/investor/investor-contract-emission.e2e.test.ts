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
 * a live execution-mode switch; covered by the investor-bff producer unit test against the
 * setExecutionMode write literal.
 *
 * ONE SHARED TENANT (beforeAll), not a fresh tenant per `it`: the two assertions read
 * different tables (investor-bff vs investor-ctrl) for the SAME logical fixture state, and
 * onboarding (real LLM agent) is the expensive/flake-prone step — running it once is both
 * cheaper and more reliable. Ordering matters and is load-bearing: investor-ctrl's
 * Notification is UPSTREAM of investor-bff's Notification read-model (investor-bff projects
 * investor-ctrl's NOTIFICATION_CREATED). The investor-bff block runs first and waits for that
 * downstream read-model row; by the time it passes, the investor-ctrl rows are already
 * present, so the investor-ctrl block resolves promptly.
 *
 * Key table-key facts (confirmed from code + deployed-table describe):
 *   investor-bff:
 *     - InvestorProfile pk=InvestorProfile#${tenantId}#${userId} sk=InvestorProfile
 *     - Mandate         pk=InvestorProfile#${tenantId}#${userId} sk=Mandate
 *     - Notification    pk=InvestorProfile#${tenantId}#${userId} sk=Notification#${notificationId}
 *   investor-ctrl (notificationId/reportId are ctx.eventId-derived → query by GSI):
 *     - Notification    pk=Notification#${tenantId}#${notificationId}    sk=Notification
 *     - MonthlyReport   pk=MonthlyReport#${tenantId}#${reportId}         sk=MonthlyReport
 *     tenantId-index GSI: PK=tenantId, SK=__typename, ProjectionType=ALL (verified on dev).
 *
 * DO NOT run this directly against dev outside the closing phase — it provisions a tenant
 * and drives the real onboarding agent. Execution is gated by the workstream's closing task.
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

  beforeAll(async () => {
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

  afterAll(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it(
    'investor-bff: InvestorProfile + Mandate + Notification read-model subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('investor-bff');
      const pk = `InvestorProfile#${tenant.tenantId}#${tenant.userId}`;

      // InvestorProfile + Mandate are written transactionally by the ONBOARDING_COMPLETED
      // transform — one async hop from the onboarding agent. 180s covers a cold ingress.
      const profile = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'InvestorProfile' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 180_000);
      expectContractMatch(InvestorProfileUpdatedSchema, profile, 'InvestorProfileUpdated');

      const mandate = await poll(async () => {
        const r = await ddbDoc.send(new GetCommand({ TableName: table, Key: { pk, sk: 'Mandate' } }));
        return r.Item as Record<string, unknown> | undefined;
      }, 180_000);
      expectContractMatch(MandateSchema, mandate, 'Mandate');

      // Notification read-model: two-hop chain (investor-ctrl NOTIFICATION_CREATED →
      // investor-bff projection), so allow the longest window in this block.
      const notifs = await poll(async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Notification#' },
        }));
        return (r.Items ?? []).length ? (r.Items as Record<string, unknown>[]) : undefined;
      }, 240_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationReadSchema, row, `NotificationRead[${i}]`));
    },
    600_000,
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

      // investor-ctrl's Notification is UPSTREAM of the investor-bff read-model the previous
      // block already waited for, so it is present by now; the generous deadline is a cold-path
      // safety margin, not an expectation.
      const notifs = await poll(async () => {
        const items = await byTypename('Notification');
        return items.length ? items : undefined;
      }, 240_000);
      expect(notifs.length).toBeGreaterThan(0);
      notifs.forEach((row, i) => expectContractMatch(NotificationCreatedSchema, row, `NotificationCreated[${i}]`));

      // MonthlyReport is written by the ORDER_FILLED branch (withHoldings fixture).
      const reports = await poll(async () => {
        const items = await byTypename('MonthlyReport');
        return items.length ? items : undefined;
      }, 240_000);
      expect(reports.length).toBeGreaterThan(0);
      reports.forEach((row, i) => expectContractMatch(MonthlyReportSchema, row, `MonthlyReport[${i}]`));
    },
    600_000,
  );
});
