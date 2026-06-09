/**
 * Validation-gate e2e — ledger-domain producer contracts vs REAL deployed emission.
 *
 * The CDC publisher emits the whole DDB row as the event subject. A row that
 * parses against its contract proves the emitted subject satisfies the contract.
 *
 * Two `it` blocks:
 *   1. ledger-ctrl — AccountSnapshot + BalanceEvent/PortfolioEvent/LedgerEntryEvent rows
 *      written by the reducer + snapshotToEvents pipeline.
 *   2. reconciliation-ctrl — ReconciliationResult + DriftRecord rows written by
 *      the reconcile() path after an ALPACA_ACCOUNT_SNAPSHOT triggers comparison.
 *
 * Key table-key facts (confirmed from code):
 *   ledger-ctrl:
 *     - AccountSnapshot  pk=Account#${tenantId}#actual  sk=Snapshot#latest
 *     - BalanceEvent     pk=Account#${tenantId}#actual  sk=BalanceEvent#${ts}#${seq}
 *     - PortfolioEvent   pk=Account#${tenantId}#actual  sk=PortfolioEvent#${ts}#${seq}
 *     - LedgerEntryEvent pk=Account#${tenantId}#actual  sk=LedgerEntryEvent#${ts}#${seq}
 *
 *   reconciliation-ctrl:
 *     - ReconciliationResult pk=Reconciliation#${tenantId}#${reconciliationId}  sk=Reconciliation
 *     - DriftRecord          pk=Reconciliation#${tenantId}#${reconciliationId}  sk=DriftRecord#${instrument}
 *     tenantId-index GSI: PK=tenantId, SK=__typename, ProjectionType=ALL
 *     → query by (tenantId, __typename) to retrieve full rows without knowing reconciliationId.
 *
 * DO NOT run this test directly against dev — it is wired for a later closing phase.
 * This file exists to prove typechecking passes; execution is gated by the closing task.
 */

import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withHoldings,
  poll,
  type FreshTenant,
} from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AlpacaAdptEventTypes } from '@nestfolio/broker-alpaca-adpt/events';
import {
  BalanceUpdatedSchema,
  PortfolioUpdatedSchema,
  LedgerEntryRecordedSchema,
  AccountSnapshotSchema,
} from '@nestfolio/ledger-ctrl/contracts';
import {
  ReconciliationResultSchema,
  DriftRecordSchema,
} from '@nestfolio/reconciliation-ctrl/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ledger-domain producer contracts match REAL deployed emission', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // NOTE: funded() is intentionally omitted. It only seeds the investor-bff
    // CashBalance read model (which this gate never asserts on) and is currently
    // broken (emits a BALANCE_UPDATED without the contract-required `snapshot`,
    // rejected by investor-bff — see backlog funded-fixture-balance-updated-missing-snapshot).
    // Our ledger-ctrl + reconciliation-ctrl rows come from withHoldings()'s real
    // ORDER_FILLED → ledger-ctrl CDC, so funded() is not needed here.
    await applyFixtures(ctx, tenant, [
      onboarded(),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 20, fillPrice: 80 },
      ]),
    ]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  // -------------------------------------------------------------------------
  // it 1 — ledger-ctrl: AccountSnapshot + per-event rows
  // -------------------------------------------------------------------------

  it(
    'ledger-ctrl: AccountSnapshot + BalanceEvent / PortfolioEvent / LedgerEntryEvent subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('ledger-ctrl');

      // streamType for actual-money ledger is 'actual' (per LedgerRepository + snapshotToEvents).
      const pk = `Account#${tenant.tenantId}#actual`;

      // 1. AccountSnapshot — reducer materialises Snapshot#latest once per fill/deposit.
      //    AccountSnapshotSchema is the persisted row aggregate; DRY subject so pk/sk/__typename
      //    travel outside the subject but zod.safeParse on the whole row still passes (extra keys
      //    are stripped). Schema requires: streamType, positions, cashBalanceCents, totalValueCents,
      //    lastEventSequence, version, snapshotAt, timestamp.
      const snapshot = await poll(async () => {
        const r = await ddbDoc.send(
          new GetCommand({ TableName: table, Key: { pk, sk: 'Snapshot#latest' } }),
        );
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      expectContractMatch(AccountSnapshotSchema, snapshot, 'AccountSnapshot');

      // Helper to query rows by sk prefix under the account pk.
      const rowsFor = async (skPrefix: string): Promise<Record<string, unknown>[]> => {
        const r = await ddbDoc.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          }),
        );
        return (r.Items ?? []) as Record<string, unknown>[];
      };

      // 2. BalanceEvent — snapshotToEvents emits when cashBalanceCents changes.
      //    Balance-affecting events come from BOTH the deposit (funded fixture →
      //    cash credit) and the fills (withHoldings fixture → cash debit per buy),
      //    so multiple BalanceEvent rows accumulate across the snapshot sequence.
      //    sk format: BalanceEvent#${timestamp}#${lastEventSequence}
      const balances = await poll(async () => {
        const items = await rowsFor('BalanceEvent#');
        return items.length ? items : undefined;
      }, 120_000);
      expect(balances.length).toBeGreaterThan(0);
      balances.forEach((row, i) =>
        expectContractMatch(BalanceUpdatedSchema, row, `BalanceUpdated[${i}]`),
      );

      // 3. PortfolioEvent — snapshotToEvents emits when positions change.
      //    sk format: PortfolioEvent#${timestamp}#${lastEventSequence}
      const portfolios = await poll(async () => {
        const items = await rowsFor('PortfolioEvent#');
        return items.length ? items : undefined;
      }, 120_000);
      expect(portfolios.length).toBeGreaterThan(0);
      portfolios.forEach((row, i) =>
        expectContractMatch(PortfolioUpdatedSchema, row, `PortfolioUpdated[${i}]`),
      );

      // 4. LedgerEntryEvent — snapshotToEvents always emits one per snapshot update.
      //    sk format: LedgerEntryEvent#${timestamp}#${lastEventSequence}
      const ledgerEntries = await poll(async () => {
        const items = await rowsFor('LedgerEntryEvent#');
        return items.length ? items : undefined;
      }, 120_000);
      expect(ledgerEntries.length).toBeGreaterThan(0);
      ledgerEntries.forEach((row, i) =>
        expectContractMatch(LedgerEntryRecordedSchema, row, `LedgerEntryRecorded[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 2 — reconciliation-ctrl: ReconciliationResult + DriftRecord subjects
  // -------------------------------------------------------------------------

  it(
    'reconciliation-ctrl: ReconciliationResult + DriftRecord subjects parse',
    async () => {
      const table = await ctx.ssm.tableName('reconciliation-ctrl');
      const eb = new EventBridgeClient(ctx);

      // Wait for Intent cache — seeded when PORTFOLIO_UPDATED reaches reconciliation-ctrl
      // (the withHoldings fixture drives PORTFOLIO_UPDATED → reconciliation-ctrl Ingress).
      await poll(async () => {
        const r = await ddbDoc.send(
          new GetCommand({
            TableName: table,
            Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Intent' },
          }),
        );
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);

      // Trigger: ALPACA_ACCOUNT_SNAPSHOT with DIFFERENT quantities → drift detected.
      // (VTI 45 vs 50; BND 25 vs 20 — both sides diverge from intent.)
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          portfolioId: tenant.tenantId,
          positions: [
            { symbol: 'VTI', qty: 45, marketValue: 9000 },
            { symbol: 'BND', qty: 25, marketValue: 2000 },
          ],
        },
      });

      // GSI query helper — tenantId-index: PK=tenantId, SK=__typename, projection=ALL.
      // Returns full rows including all non-key attributes (no BatchGet needed).
      const byTypename = async (typename: string): Promise<Record<string, unknown>[]> => {
        const r = await ddbDoc.send(
          new QueryCommand({
            TableName: table,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :t AND #tn = :tn',
            ExpressionAttributeNames: { '#tn': '__typename' },
            ExpressionAttributeValues: { ':t': tenant.tenantId, ':tn': typename },
          }),
        );
        return (r.Items ?? []) as Record<string, unknown>[];
      };

      // 1. ReconciliationResult — __typename='ReconciliationResult', sk='Reconciliation'.
      //    Schema requires: reconciliationId, status, driftCount.
      const results = await poll(async () => {
        const items = await byTypename('ReconciliationResult');
        return items.length ? items : undefined;
      }, 180_000);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((row, i) =>
        expectContractMatch(ReconciliationResultSchema, row, `ReconciliationResult[${i}]`),
      );

      // 2. DriftRecord — __typename='DriftRecord', sk=DriftRecord#${instrument}.
      //    Schema requires: reconciliationId, instrument, intentQty, settlementQty, drift.
      const drifts = await poll(async () => {
        const items = await byTypename('DriftRecord');
        return items.length ? items : undefined;
      }, 60_000);
      // Both positions intentionally drift (VTI 45≠50, BND 25≠20), so this also
      // asserts the fixture exercised both legs of the comparison.
      expect(drifts.length).toBeGreaterThanOrEqual(2);
      drifts.forEach((row, i) =>
        expectContractMatch(DriftRecordSchema, row, `DriftRecord[${i}]`),
      );
    },
    420_000,
  );
});
