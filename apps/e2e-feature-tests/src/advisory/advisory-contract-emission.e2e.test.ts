/**
 * Validation-gate e2e — advisory-domain producer contracts vs REAL deployed emission.
 *
 * The CDC publisher emits the whole DDB row as the event subject. A row that parses
 * against its producer contract proves the emitted subject satisfies the contract.
 * This is the advisory-domain twin of ledger-contract-emission.e2e.test.ts and
 * investor-contract-emission.e2e.test.ts, and the #1-risk mechanism of the
 * typed-subject-contracts-advisory slice.
 *
 * ─── Coverage ─────────────────────────────────────────────────────────────────
 * Block A — REAL decision cycle (onboarded() → withProfileSnapshot() → withLiveDecision()):
 *   compliance-ctrl   ComplianceCheck     pk=ComplianceCheck#${tenantId}#${ccId}  sk=ComplianceCheck
 *   decision-workflow-ctrl:
 *     DecisionPacket  pk=DecisionPacket#${tenantId}#${decisionId}  sk=DecisionPacket
 *     MandateSnapshot pk=MandateSnapshot#${tenantId}#${userId}      sk=MandateSnapshot
 *   portfolio-engine-ctrl
 *     AgentCompletion pk=AgentCompletion#${decisionId}  sk=AgentCompletion#portfolio-engine
 *     → expectContractMatch(PortfolioAgentOutputSchema, row.agentOutput, …)
 *   advisory-narrative-ctrl
 *     AgentCompletion pk=AgentCompletion#${decisionId}  sk=AgentCompletion#advisory-narrative
 *     → expectContractMatch(NarrativeAgentOutputSchema, row.agentOutput, …)
 *   advisory-bff      DecisionReadModel   pk=Decision#${tenantId}#${decisionId}  sk=DecisionReadModel
 *   investor-profile-ctrl
 *     InvestorProfileSnapshot  pk=InvestorProfileSnapshot#${tenantId}#${userId}  sk=InvestorProfileSnapshot
 *   market-intelligence-ctrl
 *     MarketSnapshot           pk=MarketSnapshot#${region}  sk=MarketSnapshot
 *     (region is 'us-east-1'; NOT on the subject — it travels in RegionContext)
 *
 * Block B — Feed-fetch block (FETCH_<SOURCE>_REQUESTED → real external APIs):
 *   sec-edgar-adpt    SecFiling      pk=SecFiling#${cik}  (tries all 3 CIKs; which filed recently is date-dependent)
 *   fred-adpt         FredIndicator  pk=Fred#SYSTEM       sk=Indicator#${seriesId}
 *   marketwatch-adpt  MarketWatchArticle  pk=MarketWatch#SYSTEM  sk=Feed#topstories
 *   yahoo-finance-adpt  YahooFinanceArticle  pk=YahooFinance#SYSTEM  sk=Ticker#VTI
 *   alpha-vantage-adpt:
 *     AlphaVantageArticle   pk=AlphaVantage#SYSTEM  sk=Article#…
 *     EconomicIndicator     pk=AlphaVantage#SYSTEM  sk=Indicator#…
 *
 * ─── Documented boundaries (NOT driven here) ──────────────────────────────────
 *   RECOMMENDATION_PROPOSED  — SF-direct putEvents (no persisted row, no __typename).
 *                               Covered by Task-8 decision-workflow-ctrl unit tests.
 *   DECISION_CYCLE_STARTED   — SF-direct fire-and-forget (no row). Unit-tested.
 *   DECISION_CYCLE_FAILED    — SF-direct Catch path (no row). Unit-tested.
 *   UserConfirmation / UserRejection — written by JS resolver intent, not a CDC row
 *                               in the traditional sense; covered by advisory-bff
 *                               integration test (confirmDecision / rejectDecision resolver).
 *
 * ─── Key table-key facts (confirmed from source) ──────────────────────────────
 *   compliance-ctrl:
 *     ComplianceCheck  pk=ComplianceCheck#${tenantId}#${ccId}  sk='ComplianceCheck'
 *     ccId = ctx.eventId of the RECOMMENDATION_PROPOSED event → not directly observable
 *     at e2e level. Use GSI (tenantId-index: PK=tenantId, SK=__typename, ALL) to locate
 *     the row without knowing ccId.
 *   decision-workflow-ctrl:
 *     DecisionPacket    pk=DecisionPacket#${tenantId}#${decisionId}  sk='DecisionPacket'
 *     MandateSnapshot   pk=MandateSnapshot#${tenantId}#${userId}      sk='MandateSnapshot'
 *   portfolio-engine-ctrl:
 *     AgentCompletion   pk=AgentCompletion#${decisionId}  sk=AgentCompletion#portfolio-engine
 *   advisory-narrative-ctrl:
 *     AgentCompletion   pk=AgentCompletion#${decisionId}  sk=AgentCompletion#advisory-narrative
 *   advisory-bff:
 *     DecisionReadModel pk=Decision#${tenantId}#${decisionId}  sk='DecisionReadModel'
 *   investor-profile-ctrl:
 *     InvestorProfileSnapshot pk=InvestorProfileSnapshot#${tenantId}#${userId} sk='InvestorProfileSnapshot'
 *   market-intelligence-ctrl:
 *     MarketSnapshot    pk=MarketSnapshot#us-east-1  sk='MarketSnapshot'  (global, no tenantId)
 *
 * ─── Run discipline ───────────────────────────────────────────────────────────
 *   DO NOT run this test directly outside the closing phase of the
 *   typed-subject-contracts-advisory workstream. Block A drives a REAL Bedrock
 *   agent wave (30–110s). Block B hits REAL external feed APIs (SEC EDGAR, FRED,
 *   MarketWatch, Yahoo Finance, Alpha Vantage). This file exists to prove
 *   typechecking and linting pass; execution is gated by the workstream's closing
 *   task (deploy + scoped run against deployed dev).
 *
 * Per the typed-subject-contracts lesson (MEMORY.md event-subject-contracts):
 *   validate contracts vs REAL producer (e2e), NOT fixtures — schema+fixture
 *   co-wrong passed integration, e2e caught it. The stale compliance schema is the
 *   standing proof fixtures hide drift.
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
  withProfileSnapshot,
  withLiveDecision,
  poll,
  type FreshTenant,
} from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ComplianceCheckSchema } from '@nestfolio/compliance-ctrl/contracts';
import { DecisionPacketSchema, MandateSnapshotSchema } from '@nestfolio/decision-workflow-ctrl/contracts';
import { PortfolioAgentOutputSchema } from '@nestfolio/portfolio-engine-ctrl/contracts';
import { NarrativeAgentOutputSchema } from '@nestfolio/advisory-narrative-ctrl/contracts';
import { DecisionReadModelSchema } from '@nestfolio/advisory-bff/contracts';
import { InvestorProfileSnapshotSchema } from '@nestfolio/investor-profile-ctrl/contracts';
import { MarketSnapshotSchema } from '@nestfolio/market-intelligence-ctrl/contracts';
import { SecFilingSchema } from '@nestfolio/sec-edgar-adpt/contracts';
import { FredIndicatorSchema } from '@nestfolio/fred-adpt/contracts';
import { MarketWatchArticleSchema } from '@nestfolio/marketwatch-adpt/contracts';
import { YahooFinanceArticleSchema } from '@nestfolio/yahoo-finance-adpt/contracts';
import { AlphaVantageArticleSchema, EconomicIndicatorSchema } from '@nestfolio/alpha-vantage-adpt/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

// ---------------------------------------------------------------------------
// Shared GSI helper — tenantId-index (PK=tenantId, SK=__typename, projection=ALL)
// returns full rows by (tenantId, __typename) — same shape as the ledger gate.
// ---------------------------------------------------------------------------
function makeByTypename(
  ddbDoc: DynamoDBDocumentClient,
  table: string,
  tenantId: string,
): (typename: string) => Promise<Record<string, unknown>[]> {
  return async (typename: string) => {
    const r = await ddbDoc.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :t AND #tn = :tn',
        ExpressionAttributeNames: { '#tn': '__typename' },
        ExpressionAttributeValues: { ':t': tenantId, ':tn': typename },
      }),
    );
    return (r.Items ?? []) as Record<string, unknown>[];
  };
}

// ---------------------------------------------------------------------------
// Labeled poll — poll()'s signature is (fn, deadlineMs, intervalMs?); it has no
// label arg and throws a generic 'poll timed out'. In a multi-minute
// closing-phase run, an unlabeled timeout doesn't say WHICH row/service never
// materialised. Wrap each readback so the thrown error names the row.
// ---------------------------------------------------------------------------
async function pollFor<T>(
  label: string,
  fn: () => Promise<T | undefined>,
  deadlineMs: number,
): Promise<T> {
  try {
    return await poll(fn, deadlineMs);
  } catch {
    throw new Error(`pollFor(${label}): row never materialised within ${deadlineMs}ms`);
  }
}

// ===========================================================================
// Block A — REAL decision cycle
//
// Strategy: reuse withLiveDecision() — the SAME fixture used by
// `advisory/first-decision.e2e.test.ts` (scenario 11). This is the canonical
// trigger path: MANDATE_ISSUED → mandate-projector → MANDATE_SNAPSHOT_CREATED
// → SF → 4-agent pipeline → DECISION_PACKET_CREATED → advisory-bff. Wait logic
// (180s poll on advisory-bff getDecisionHistory) is load-bearing for the full
// Bedrock wave. Do NOT replace with a synthetic/short-circuit path.
//
// ONE SHARED TENANT (beforeAll): the cycle involves real Bedrock agents (30–110s)
// and the expensive withProfileSnapshot() wait (~360s). Running it once is both
// cheaper and more reliable. The two `it` blocks read different tables for the
// SAME logical fixture state.
//
// Note: withProfileSnapshot() is composed after onboarded() here (unlike the
// first-decision scenario which arms an AgentTraceTrap before applyFixtures).
// The profile snapshot must exist BEFORE withLiveDecision() so the SF's
// ParallelProjections/LookupInvestorProfileSnapshot succeeds on first try.
// ===========================================================================

describe('advisory-domain producer contracts — REAL decision cycle', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // onboarded()         — materialises InvestorProfile + MandateSnapshot in investor-bff;
    //                       advisory domain mandate-projector writes DWC MandateSnapshot row.
    // withProfileSnapshot() — waits for IP-ctrl's Bedrock agent to materialise
    //                         InvestorProfileSnapshot in investor-profile-ctrl's table +
    //                         DWC's SnapshotProjectorIngress mirror (up to 360s; covers
    //                         SQS redrive on maxVms quota). Must precede withLiveDecision()
    //                         so the SF's LookupInvestorProfileSnapshot GetItem succeeds.
    // withLiveDecision()  — MANDATE_ISSUED → mandate-projector → MANDATE_SNAPSHOT_CREATED
    //                       → SF → PE wave → AN wave → DECISION_PACKET_CREATED → advisory-bff.
    //                       Polls advisory-bff GraphQL until a decision surfaces (180s).
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withProfileSnapshot(),
      withLiveDecision(),
    ]);
    decisionId = result['decisionId'] as string;
    if (!decisionId) throw new Error('beforeAll: decisionId missing from withLiveDecision result');
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 900_000); // 15 min: onboarded (60s) + withProfileSnapshot (360s) + withLiveDecision (180s) + DDB warm

  afterAll(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  // -------------------------------------------------------------------------
  // it 1 — compliance-ctrl, decision-workflow-ctrl, advisory-bff
  // -------------------------------------------------------------------------
  it(
    'compliance-ctrl + decision-workflow-ctrl + advisory-bff subjects parse',
    async () => {
      // ── compliance-ctrl: ComplianceCheck ─────────────────────────────────
      // ccId = ctx.eventId of RECOMMENDATION_PROPOSED (an SF-internal putEvents
      // event, not observable at e2e level). Query by __typename via GSI instead.
      const ccTable = await ctx.ssm.tableName('compliance-ctrl');
      const ccByTypename = makeByTypename(ddbDoc, ccTable, tenant.tenantId);

      const checks = await pollFor('ComplianceCheck', async () => {
        const items = await ccByTypename('ComplianceCheck');
        return items.length ? items : undefined;
      }, 180_000);
      expect(checks.length).toBeGreaterThan(0);
      checks.forEach((row, i) =>
        expectContractMatch(ComplianceCheckSchema, row, `ComplianceCheck[${i}]`),
      );

      // ── decision-workflow-ctrl: DecisionPacket ────────────────────────────
      // pk=DecisionPacket#${tenantId}#${decisionId}  sk='DecisionPacket'
      const dwcTable = await ctx.ssm.tableName('decision-workflow-ctrl');

      const dpRow = await pollFor('DecisionPacket', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: dwcTable,
          Key: {
            pk: `DecisionPacket#${tenant.tenantId}#${decisionId}`,
            sk: 'DecisionPacket',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      expectContractMatch(DecisionPacketSchema, dpRow, 'DecisionPacket');

      // ── decision-workflow-ctrl: MandateSnapshot ────────────────────────────
      // pk=MandateSnapshot#${tenantId}#${userId}  sk='MandateSnapshot'
      // Written by mandate-projector on MANDATE_ISSUED (co-fired by onboarded()).
      // By the time the SF has completed, this row is already present; generous
      // deadline is a cold-path safety margin.
      const mandateRow = await pollFor('MandateSnapshot', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: dwcTable,
          Key: {
            pk: `MandateSnapshot#${tenant.tenantId}#${tenant.userId}`,
            sk: 'MandateSnapshot',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      expectContractMatch(MandateSnapshotSchema, mandateRow, 'MandateSnapshot');

      // ── advisory-bff: DecisionReadModel ───────────────────────────────────
      // pk=Decision#${tenantId}#${decisionId}  sk='DecisionReadModel'
      // Written by decision-snapshot.ts (projectVersioned) on DECISION_PACKET_CREATED.
      // withLiveDecision() already polled getDecisionHistory, so the row is present;
      // the poll here is a defensive freshness check with a short deadline.
      const bffTable = await ctx.ssm.tableName('advisory-bff');

      const decisionRmRow = await pollFor('DecisionReadModel', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: bffTable,
          Key: {
            pk: `Decision#${tenant.tenantId}#${decisionId}`,
            sk: 'DecisionReadModel',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      expectContractMatch(DecisionReadModelSchema, decisionRmRow, 'DecisionReadModel');
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 2 — agent completion rows + precomputed snapshots
  // -------------------------------------------------------------------------
  it(
    'portfolio-engine-ctrl + advisory-narrative-ctrl AgentCompletion + InvestorProfileSnapshot + MarketSnapshot subjects parse',
    async () => {
      // ── portfolio-engine-ctrl: AgentCompletion ─────────────────────────────
      // pk=AgentCompletion#${decisionId}  sk=AgentCompletion#portfolio-engine
      // agentOutput field contains the PortfolioAgentOutput payload.
      const peTable = await ctx.ssm.tableName('portfolio-engine-ctrl');

      const peRow = await pollFor('PE AgentCompletion', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: peTable,
          Key: {
            pk: `AgentCompletion#${decisionId}`,
            sk: 'AgentCompletion#portfolio-engine',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      // agentOutput is the contract field; parse it specifically (not the whole row,
      // which carries identity/row keys). The schema is a DRY subject — it validates
      // the agentOutput value, not the row envelope.
      const peOutput = (peRow as Record<string, unknown>)['agentOutput'];
      expectContractMatch(PortfolioAgentOutputSchema, peOutput as Record<string, unknown>, 'PortfolioAgentOutput');

      // ── advisory-narrative-ctrl: AgentCompletion ───────────────────────────
      // pk=AgentCompletion#${decisionId}  sk=AgentCompletion#advisory-narrative
      const anTable = await ctx.ssm.tableName('advisory-narrative-ctrl');

      const anRow = await pollFor('AN AgentCompletion', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: anTable,
          Key: {
            pk: `AgentCompletion#${decisionId}`,
            sk: 'AgentCompletion#advisory-narrative',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 120_000);
      const anOutput = (anRow as Record<string, unknown>)['agentOutput'];
      expectContractMatch(NarrativeAgentOutputSchema, anOutput as Record<string, unknown>, 'NarrativeAgentOutput');

      // ── investor-profile-ctrl: InvestorProfileSnapshot ────────────────────
      // pk=InvestorProfileSnapshot#${tenantId}#${userId}  sk='InvestorProfileSnapshot'
      // Written by IP-ctrl's Bedrock agent and materialized by withProfileSnapshot().
      // The row is already present (withProfileSnapshot() blocked on it in beforeAll);
      // the poll here is a defensive freshness check.
      const ipTable = await ctx.ssm.tableName('investor-profile-ctrl');

      const ipRow = await pollFor('InvestorProfileSnapshot', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: ipTable,
          Key: {
            pk: `InvestorProfileSnapshot#${tenant.tenantId}#${tenant.userId}`,
            sk: 'InvestorProfileSnapshot',
          },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      // InvestorProfileSnapshotSchema validates the subject fields (agentOutput, sourceEventId?,
      // __version?). The whole row passes because the schema uses zod.object (strips extra keys
      // like pk/sk/__typename).
      expectContractMatch(InvestorProfileSnapshotSchema, ipRow, 'InvestorProfileSnapshot');

      // ── market-intelligence-ctrl: MarketSnapshot ───────────────────────────
      // pk=MarketSnapshot#us-east-1  sk='MarketSnapshot'
      // Global (no tenantId) — one row per region, continuously updated by the 15-min
      // scheduler tick. The row is materialized by market-intelligence-ctrl's MI agent
      // and mirrored to DWC by SnapshotProjectorIngress. We read from MI-ctrl's own
      // table (the producer's row, not the DWC mirror).
      // `region` travels in RegionContext (NOT on the subject); the row physically
      // carries `region` on the DDB item but MarketSnapshotSchema does NOT require it
      // (DRY subject — identity/context stays out of subject). The zod parse strips
      // the extra `region` key on the row so the contract still passes.
      const miTable = await ctx.ssm.tableName('market-intelligence-ctrl');
      const region = 'us-east-1';

      // 60_000: this region row pre-exists from the last MI scheduler tick (the MI
      // agent runs out-of-cycle on a 15-min cadence), so it should be present
      // immediately. A short deadline keeps it-2's poll-deadline sum
      // (120 + 120 + 60 + 60 = 360_000) safely under the 420_000 it timeout (≥60_000 margin).
      const miRow = await pollFor('MarketSnapshot', async () => {
        const r = await ddbDoc.send(new GetCommand({
          TableName: miTable,
          Key: { pk: `MarketSnapshot#${region}`, sk: 'MarketSnapshot' },
        }));
        return r.Item as Record<string, unknown> | undefined;
      }, 60_000);
      expectContractMatch(MarketSnapshotSchema, miRow, 'MarketSnapshot');
    },
    420_000,
  );
});

// ===========================================================================
// Block B — Feed-fetch block (REAL external feed APIs)
//
// Each adapter is driven DIRECTLY via FETCH_<SOURCE>_REQUESTED → real external
// API → DDB row persisted → expectContractMatch. These are global rows
// (no tenantId) so no GSI query is needed — exact pk+sk GetItem or prefix Query.
//
// Feed rows are project()-shaped: pk/sk/__typename are injected by the
// event-processor project() helper and are NOT part of the subject schema.
// The schemas are fields-only (the CDC publisher uses project() so the subject
// is stripped of envelope keys). zod's .object() strips unknown keys, so the
// whole DDB row passes — extra pk/sk/__typename attributes are simply dropped.
//
// Generous timeouts (300s per it): real external APIs may be slow.
// BeforeAll is shared — no per-tenant state needed for global feed rows.
// ===========================================================================

describe('advisory-domain producer contracts — feed-fetch (REAL external APIs)', () => {
  let ctx: TestContext;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeAll(async () => {
    ctx = await createTestContext();
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 60_000);

  afterAll(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  // -------------------------------------------------------------------------
  // it 1 — sec-edgar-adpt: SecFiling (REAL SEC EDGAR API)
  // -------------------------------------------------------------------------
  it(
    'sec-edgar-adpt: SecFiling subject parses (REAL SEC EDGAR API)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('sec-edgar-adpt');

      // Trigger: FETCH_SEC_EDGAR_REQUESTED → adapter fetches the configured CIKs
      // (TRACKED_CIKS env defaults to '0000102909,0000088053,0000914208').
      // The adapter writes SecFiling rows keyed pk=SecFiling#${cik} sk=Filing#${accessionNumber}.
      //
      // ROBUST QUERY — query each of the 3 tracked CIKs and validate the first with rows.
      // Rationale: which CIK has RECENT filings is date-dependent (e.g., in the last run,
      // Vanguard (0000102909) and Deutsche (0000088053) had 0 new filings, while
      // Invesco (0000914208) had 1). The typename-timestamp-index GSI is KEYS_ONLY and
      // SecFiling rows carry no `timestamp` attribute, so the GSI returns 0 items for this
      // type — it cannot be used to find SecFiling rows. Query by pk prefix (one per CIK)
      // instead; the adapter writes whichever CIK(s) filed recently.
      const TRACKED_CIKS = ['0000102909', '0000088053', '0000914208'];

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'sec-edgar-adpt',
        detailType: 'FETCH_SEC_EDGAR_REQUESTED',
        detail: {},
      });

      // SEC EDGAR is real — allow generous deadline.
      const rows = await pollFor('SecFiling', async () => {
        for (const cik of TRACKED_CIKS) {
          const r = await ddbDoc.send(new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues: {
              ':pk': `SecFiling#${cik}`,
              ':sk': 'Filing#',
            },
          }));
          const items = (r.Items ?? []) as Record<string, unknown>[];
          if (items.length) return items;
        }
        return undefined;
      }, 240_000);

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row, i) => expectContractMatch(SecFilingSchema, row, `SecFiling[${i}]`));
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // it 2 — fred-adpt: FredIndicator (REAL FRED API)
  // -------------------------------------------------------------------------
  it(
    'fred-adpt: FredIndicator subject parses (REAL FRED API)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('fred-adpt');

      // Trigger: FETCH_FRED_REQUESTED → adapter fetches configured series IDs.
      // Writes FredIndicator rows keyed pk='Fred#SYSTEM' sk=Indicator#${seriesId}.
      // Query all rows under pk='Fred#SYSTEM'; any satisfied FredIndicatorSchema.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'fred-adpt',
        detailType: 'FETCH_FRED_REQUESTED',
        detail: {},
      });

      const rows = await pollFor('FredIndicator', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'Fred#SYSTEM',
            ':sk': 'Indicator#',
          },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 180_000);

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row, i) => expectContractMatch(FredIndicatorSchema, row, `FredIndicator[${i}]`));
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // it 3 — marketwatch-adpt: MarketWatchArticle (REAL MarketWatch RSS)
  // -------------------------------------------------------------------------
  it(
    'marketwatch-adpt: MarketWatchArticle subject parses (REAL MarketWatch RSS)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('marketwatch-adpt');

      // Trigger: FETCH_MARKETWATCH_REQUESTED → adapter fetches RSS feeds.
      // Writes MarketWatchArticle rows keyed pk='MarketWatch#SYSTEM' sk=Feed#${feedPath}.
      // The adapter fetches 'topstories' + 'marketpulse' feeds by default; query all under pk.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'marketwatch-adpt',
        detailType: 'FETCH_MARKETWATCH_REQUESTED',
        detail: {},
      });

      const rows = await pollFor('MarketWatchArticle', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'MarketWatch#SYSTEM',
            ':sk': 'Feed#',
          },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 180_000);

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row, i) =>
        expectContractMatch(MarketWatchArticleSchema, row, `MarketWatchArticle[${i}]`),
      );
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // it 4 — yahoo-finance-adpt: YahooFinanceArticle (REAL Yahoo Finance RSS)
  // -------------------------------------------------------------------------
  it(
    'yahoo-finance-adpt: YahooFinanceArticle subject parses (REAL Yahoo Finance RSS)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('yahoo-finance-adpt');

      // Trigger: FETCH_YAHOO_FINANCE_REQUESTED → adapter fetches RSS per ticker.
      // TICKERS env defaults to 'VTI,BND,QQQ,VTIP,SPY'. Writes YahooFinanceArticle
      // rows keyed pk='YahooFinance#SYSTEM' sk=Ticker#${ticker}. Query all under pk.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'yahoo-finance-adpt',
        detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
        detail: {},
      });

      const rows = await pollFor('YahooFinanceArticle', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'YahooFinance#SYSTEM',
            ':sk': 'Ticker#',
          },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 180_000);

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row, i) =>
        expectContractMatch(YahooFinanceArticleSchema, row, `YahooFinanceArticle[${i}]`),
      );
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // it 5 — alpha-vantage-adpt: AlphaVantageArticle + EconomicIndicator (REAL Alpha Vantage API)
  // -------------------------------------------------------------------------
  it(
    'alpha-vantage-adpt: AlphaVantageArticle + EconomicIndicator subjects parse (REAL Alpha Vantage API)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('alpha-vantage-adpt');

      // Trigger: FETCH_ALPHA_VANTAGE_REQUESTED → adapter fetches NEWS_SENTIMENT
      // (→ AlphaVantageArticle rows sk=Article#${ticker}#${date}#${i}) and economic
      // indicators (→ EconomicIndicator rows sk=Indicator#${fn}).
      // All rows share pk='AlphaVantage#SYSTEM'. Query all rows under that pk and
      // partition by sk prefix to validate each schema separately.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'alpha-vantage-adpt',
        detailType: 'FETCH_ALPHA_VANTAGE_REQUESTED',
        detail: {},
      });

      // Wait for at least one row of each type to appear. The adapter writes BOTH
      // AlphaVantageArticle and EconomicIndicator rows in ONE handler invocation,
      // but these are two SEQUENTIAL polls (240_000 + 120_000 = 360_000), so the
      // it timeout below MUST exceed their sum with margin — hence 420_000.
      const articleRows = await pollFor('AlphaVantageArticle', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'AlphaVantage#SYSTEM',
            ':sk': 'Article#',
          },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 240_000);

      expect(articleRows.length).toBeGreaterThan(0);
      articleRows.forEach((row, i) =>
        expectContractMatch(AlphaVantageArticleSchema, row, `AlphaVantageArticle[${i}]`),
      );

      // EconomicIndicator rows: sk=Indicator#${fn}. Written in the SAME invocation as
      // the articles above, so by now they exist — but keep a real deadline for cold paths.
      const indicatorRows = await pollFor('EconomicIndicator', async () => {
        const r = await ddbDoc.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'AlphaVantage#SYSTEM',
            ':sk': 'Indicator#',
          },
        }));
        const items = (r.Items ?? []) as Record<string, unknown>[];
        return items.length ? items : undefined;
      }, 120_000);

      expect(indicatorRows.length).toBeGreaterThan(0);
      indicatorRows.forEach((row, i) =>
        expectContractMatch(EconomicIndicatorSchema, row, `EconomicIndicator[${i}]`),
      );
    },
    420_000,
  );
});
