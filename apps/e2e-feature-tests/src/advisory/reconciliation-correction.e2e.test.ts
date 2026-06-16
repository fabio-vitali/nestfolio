import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withHoldings,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import { AlpacaAdptEventTypes } from '@nestfolio/broker-alpaca-adpt/events';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { DecisionHistoryResponse } from '../helpers/graphql-types';
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario 13 — reconciliation discrepancy surfaces corrective decision', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;
  let tableName: string;
  let advisoryNarrativeTrap: AgentTraceTrap<'advisoryNarrative'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Arm before any fixture — drift detection fires asynchronously from
    // ALPACA_ACCOUNT_SNAPSHOT, and the resulting PORTFOLIO_DRIFT_DETECTED
    // starts decision-workflow-ctrl's decision Step Function (which drives
    // the agent pipeline) before the scenario's assertions run.
    advisoryNarrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 20, fillPrice: 80 },
      ]),
    ]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
    tableName = await ctx.ssm.tableName('reconciliation-ctrl');
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ALPACA_ACCOUNT_SNAPSHOT with different quantities triggers drift → advisory decision', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // Poll for Intent cache — seeded by PORTFOLIO_UPDATED CDC chain
    // (withHoldings → ledger-ctrl CDC → PORTFOLIO_UPDATED → reconciliation-ctrl)
    const intentDeadline = Date.now() + 90_000;
    let intentSeeded = false;
    while (Date.now() < intentDeadline) {
      const result = await ddbDoc.send(new GetCommand({
        TableName: tableName,
        Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Intent' },
      }));
      if (result.Item) { intentSeeded = true; break; }
      await new Promise(r => setTimeout(r, 2_000));
    }
    expect(intentSeeded).toBe(true);

    // TRIGGER: publish broker snapshot with DIFFERENT quantities (settlement side)
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

    // Poll for Settlement cache — confirms event reached Lambda and was processed
    const settlementDeadline = Date.now() + 60_000;
    let settlementWritten = false;
    while (Date.now() < settlementDeadline) {
      const result = await ddbDoc.send(new GetCommand({
        TableName: tableName,
        Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Settlement' },
      }));
      if (result.Item) { settlementWritten = true; break; }
      await new Promise(r => setTimeout(r, 2_000));
    }
    expect(settlementWritten).toBe(true);

    // ASSERT: drift detection → PORTFOLIO_DRIFT_DETECTED → decision-workflow-ctrl →
    // decision surfaces in getDecisionHistory
    const history = await waitForGraphQL<DecisionHistoryResponse>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.some((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED'),
      { timeoutMs: 180_000, intervalMs: 5_000 },
    );

    const decision = history.getDecisionHistory.items.find((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED');
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));

    // decision-lifecycle agent contract — PORTFOLIO_DRIFT_DETECTED triggers
    // decision-workflow-ctrl's decision Step Function (direct EB→SF), which
    // drives the agent pipeline. decisionId = triggerEvent.id matches the
    // envelope's correlationId. Reconciliation may produce multiple traces
    // across correction cycles; assert on the LAST.
    const narrativeTraces = await advisoryNarrativeTrap.waitFor({
      correlationId: decision!.decisionId,
      timeoutMs: 240_000,
    });
    const envelope = narrativeTraces[narrativeTraces.length - 1].envelope;

    expect(envelope.status).toBe('success');
    const llmErrors = envelope.errors.filter((e) => e.kind === 'llm_error');
    expect(llmErrors).toHaveLength(0);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(
      advisoryNarrativeTrap.getLatencyBudget(),
    );
  }, 420_000);
});
