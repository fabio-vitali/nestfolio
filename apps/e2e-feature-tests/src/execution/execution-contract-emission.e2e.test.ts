/**
 * Validation-gate e2e — execution-domain producer contracts vs REAL deployed emission.
 *
 * The CDC publisher emits the whole DDB row as the event subject. A row that
 * parses against its producer contract proves the emitted subject satisfies the
 * contract (declared fields present + correctly typed; zod strips identity/keys).
 * This is the execution-domain twin of ledger-contract-emission.e2e.test.ts.
 *
 * Two paths:
 *
 *   Block A — SIM path (deterministic, no real money). Synthetic EventBridge
 *     triggers drive the REAL deployed producers and we read back the rows they
 *     materialise:
 *       1. execution-ctrl Order      (DECISION_APPROVED → event-listener → Order row)
 *       2. broker-ctrl NormalizedEvent + broker-sim VirtualTrade
 *          (ORDER_SUBMITTED → OrderStateMachine → SIM_ORDER_REQUESTED → sim engine)
 *       3. broker-sim DepositDetected + WithdrawalCompleted
 *          (SIM_DEPOSIT_INITIATED / SIM_WITHDRAWAL_REQUESTED → virtual ledger)
 *       StagedOrder is a documented boundary (only written when the market is
 *       closed; covered by execution-ctrl unit tests). Asserted opportunistically.
 *
 *   Block B — REAL Alpaca paper path (gated, high-fidelity, real external API).
 *     Switches the tenant to LIVE mode, then drives a real paper order, a real
 *     paper transfer, and an account check, reading back the producer rows:
 *       - broker-alpaca AlpacaOrderResult     (real paper order)
 *       - broker-alpaca AlpacaTransferResult   (real paper ACH transfer)
 *       - broker-alpaca AlpacaAccountSnapshot   (real account GET)
 *     Safety mitigations:
 *       - alpacaPaperReset() in beforeAll + afterAll (refuses any non-paper baseUrl).
 *       - Orphaned poll-SF cleanup in afterAll: stops any RUNNING broker-alpaca
 *         Order/Transfer polling Step Function executions for this tenant so they
 *         stop hitting the real paper account after the test ends.
 *     Documented boundaries: BrokerCircuitEvent / CircuitBreaker are NOT driven
 *     here (covered by unit tests + circuit-breaker-lifecycle.e2e.test.ts).
 *
 * ─── CONTRACT vs REAL-PRODUCER caveats (read before running) ─────────────────
 *   This file is structurally complete and typecheck/lint-clean. It is wired for
 *   a LATER closing phase to run + harden against deployed dev. DO NOT run it
 *   outside that closing phase. The following mechanics are best-effort and are
 *   flagged for the controller to validate against the REAL deployed system
 *   (per the typed-subject-contracts lesson: validate vs the real producer, not
 *   fixtures):
 *
 *   (a) ORDER_SUBMITTED → OrderStateMachine input shape. The Orchestration
 *       construct triggers the SF with `RuleTargetInput.fromEventPath('$.detail')`
 *       and the OrderStateMachine reads `$.tenantId` / `$.orderId` / `$.symbol` /
 *       `$.side` / `$.quantity` at the TOP of `$.detail` (see
 *       broker-ctrl/src/state-machine/order-state-machine.ts + route-order.ts
 *       RouteOrderEvent). The EventBridgeClient test harness wraps `detail` as the
 *       envelope `subject` and injects `context`, so a putEvent-emitted
 *       ORDER_SUBMITTED carries those fields under `.subject` / `.context`, NOT at
 *       the top level. The real production ORDER_SUBMITTED is CDC-emitted from
 *       execution-ctrl's Order row, whose subject carries `proposedTrades` (NOT
 *       symbol/side/quantity) — so the real SF input shape is itself an open
 *       question this gate surfaces. The controller must confirm the canonical
 *       ORDER_SUBMITTED shape and, if needed, emit a raw EB event with the routing
 *       fields at the top of `detail` (bypassing the harness wrapper). The
 *       VirtualTrade leg is therefore the load-bearing assertion in step 2; the
 *       NormalizedEvent leg depends on the SF completing a full task-token round
 *       trip (RouteOrder → SIM_ORDER_REQUESTED → sim fill → SIM_ORDER_FILLED →
 *       callback-resolver) and may need the controller to also inject the
 *       SIM_ORDER_FILLED callback if the sim adapter's fill does not auto-resolve.
 *
 *   (b) Live-mode SSM cache. EXECUTION_MODE_CHANGED materialises the broker-ctrl
 *       ExecutionMode row (pk=`ExecutionMode#${tenantId}`, sk='ExecutionMode'),
 *       which the SF's ReadExecutionMode GetItem reads to route to alpaca. We poll
 *       that row to mode='live' BEFORE submitting. The AlpacaClient additionally
 *       caches its baseUrl from the Parameters-and-Secrets extension (~300s); that
 *       cache is orthogonal to mode routing but the controller should be aware of
 *       it when interpreting a first-call miss.
 *
 *   (c) Poll-SF cleanup. Implemented precisely against the deployed SF naming
 *       (`${prefix}-broker-alpaca-adpt-orderpollingstatemachine` /
 *       `...-transferpollingstatemachine`, from the Orchestration construct's
 *       `${naming.prefix}-${naming.service}-${id.toLowerCase()}`). Wrapped in
 *       try/catch + logging so a discovery miss never fails the suite; the
 *       controller hardens it during the closing run.
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
  funded,
  poll,
  alpacaPaperReset,
  type FreshTenant,
} from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  SFNClient,
  ListStateMachinesCommand,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import { randomUUID } from 'crypto';
import { OrderSchema, StagedOrderSchema } from '@nestfolio/execution-ctrl/contracts';
import { NormalizedOrderEventSchema } from '@nestfolio/broker-ctrl/contracts';
import {
  VirtualTradeSchema,
  SimDepositCompletedSchema,
  SimWithdrawalCompletedSchema,
} from '@nestfolio/broker-sim-adpt/contracts';
import {
  AlpacaOrderResultSchema,
  AlpacaTransferResultSchema,
  AlpacaAccountSnapshotSchema,
} from '@nestfolio/broker-alpaca-adpt/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

// ---------------------------------------------------------------------------
// Shared GSI helper: tenantId-index (PK=tenantId, SK=__typename, projection=ALL)
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

// ===========================================================================
// Block A — SIM path (deterministic)
// ===========================================================================

describe('execution-domain producer contracts — SIM path', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // onboarded() defaults the tenant to SIMULATION mode → broker-ctrl routes
    // orders to broker-sim. funded() seeds the virtual cash balance so sim BUY
    // orders fill instead of rejecting on insufficient funds.
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
    ]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  // -------------------------------------------------------------------------
  // it 1 — execution-ctrl: Order (+ opportunistic StagedOrder)
  // -------------------------------------------------------------------------
  it(
    'execution-ctrl: Order subject parses (SUBMITTED/STAGED/REJECTED all satisfy OrderSchema)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('execution-ctrl');
      const byTypename = makeByTypename(ddbDoc, table, tenant.tenantId);

      // DECISION_APPROVED → execution-ctrl event-listener writes an Order row.
      // The row is written regardless of market state (SUBMITTED when open,
      // STAGED when closed, REJECTED if safety checks fail) — all three statuses
      // satisfy OrderSchema. orderId on the row = the triggering event's id
      // (ctx.eventId), so we query by __typename rather than reconstructing the pk.
      const decisionPacketId = `e2e-dp-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionPacketId,
          proposedTrades: [
            {
              symbol: 'VTI',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 500_000,
              targetWeightPercent: 100,
              rationale: 'e2e',
            },
          ],
        },
      });

      const orders = await poll(async () => {
        const items = await byTypename('Order');
        return items.length ? items : undefined;
      }, 180_000);
      expect(orders.length).toBeGreaterThan(0);
      orders.forEach((row, i) => expectContractMatch(OrderSchema, row, `Order[${i}]`));

      // StagedOrder — documented boundary: only written when the market is closed
      // (execution-ctrl stages instead of submitting). Covered deterministically by
      // execution-ctrl unit tests. Assert opportunistically: if the e2e run happens
      // to land outside market hours, the row exists and must satisfy the contract;
      // otherwise skip silently.
      const staged = await byTypename('StagedOrder');
      staged.forEach((row, i) =>
        expectContractMatch(StagedOrderSchema, row, `StagedOrder[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 2 — broker-ctrl NormalizedOrderEvent + broker-sim VirtualTrade
  // -------------------------------------------------------------------------
  it(
    'broker-ctrl NormalizedEvent + broker-sim VirtualTrade subjects parse (SIM order route)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const brokerCtrlTable = await ctx.ssm.tableName('broker-ctrl');
      const brokerSimTable = await ctx.ssm.tableName('broker-sim-adpt');
      const brokerCtrlByTypename = makeByTypename(ddbDoc, brokerCtrlTable, tenant.tenantId);
      const brokerSimByTypename = makeByTypename(ddbDoc, brokerSimTable, tenant.tenantId);

      // Seed the SIMULATION ExecutionMode cache so the OrderStateMachine's
      // ReadExecutionMode GetItem resolves to 'simulation' and RouteOrder routes
      // to broker-sim. onboarded() sets accountMode=simulation upstream, but the
      // broker-ctrl ExecutionMode row is materialised from EXECUTION_MODE_CHANGED,
      // so seed it explicitly to make the route deterministic.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: { mode: 'simulation' },
      });
      await poll(async () => {
        const r = await ddbDoc.send(
          new GetCommand({
            TableName: brokerCtrlTable,
            Key: { pk: `ExecutionMode#${tenant.tenantId}`, sk: 'ExecutionMode' },
          }),
        );
        const item = r.Item as { mode?: string } | undefined;
        return item?.mode === 'simulation' ? item : undefined;
      }, 60_000);

      // Drive the order through broker-ctrl's OrderStateMachine WITHOUT
      // execution-ctrl's market-hours gate by emitting ORDER_SUBMITTED directly to
      // broker-ctrl. Subject fields mirror RouteOrderEvent.order
      // (broker-ctrl/src/handlers/route-order.ts) + the SIM_ORDER_REQUESTED subject
      // consumed by broker-sim's event-listener ({orderId, userId, symbol, side,
      // quantity}). See caveat (a): the SF reads several of these at the TOP of
      // `$.detail`, but the harness nests them under `.subject`; the controller
      // confirms/repairs the canonical shape during the closing run.
      const orderId = `e2e-order-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'ORDER_SUBMITTED',
        detail: {
          orderId,
          userId: tenant.userId,
          symbol: 'VTI',
          side: 'BUY',
          quantity: 5,
          instrumentId: 'VTI',
        },
      });

      // broker-sim VirtualTrade — written by the simulation engine on
      // SIM_ORDER_REQUESTED (sk=`Trade#${tradeId}`, __typename='VirtualTrade').
      // This is the load-bearing assertion for the SIM order route (see caveat a).
      const trades = await poll(async () => {
        const items = await brokerSimByTypename('VirtualTrade');
        return items.length ? items : undefined;
      }, 240_000);
      expect(trades.length).toBeGreaterThan(0);
      trades.forEach((row, i) =>
        expectContractMatch(VirtualTradeSchema, row, `VirtualTrade[${i}]`),
      );

      // broker-ctrl NormalizedEvent — written by the OrderStateMachine when the
      // adapter callback resolves (ORDER_FILLED / ORDER_REJECTED, sk=`ORDER_*#${ts}`,
      // __typename='NormalizedEvent'). Depends on a full task-token round trip; see
      // caveat (a). Polled with a generous deadline.
      const normalized = await poll(async () => {
        const items = await brokerCtrlByTypename('NormalizedEvent');
        return items.length ? items : undefined;
      }, 240_000);
      expect(normalized.length).toBeGreaterThan(0);
      normalized.forEach((row, i) =>
        expectContractMatch(NormalizedOrderEventSchema, row, `NormalizedOrderEvent[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 3 — broker-sim funding: DepositDetected + WithdrawalCompleted
  // -------------------------------------------------------------------------
  it(
    'broker-sim DepositDetected + WithdrawalCompleted subjects parse (SIM funding)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('broker-sim-adpt');
      const byTypename = makeByTypename(ddbDoc, table, tenant.tenantId);

      // Emit SIM_DEPOSIT_INITIATED directly to broker-sim-adpt. Subject fields are
      // those read by broker-sim's event-listener SIM_DEPOSIT_INITIATED handler:
      // {depositId, amountCents, currency, userId}. It writes a `DepositDetected`
      // row (pk=`DepositDetected#${tenantId}#${eventId}`, sk='DepositDetected',
      // __typename='DepositDetected') → CDC SIM_DEPOSIT_COMPLETED. The emitted
      // subject is validated by SimDepositCompletedSchema.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-sim-adpt',
        detailType: 'SIM_DEPOSIT_INITIATED',
        detail: {
          depositId: `e2e-deposit-${randomUUID()}`,
          amountCents: 500_000,
          currency: 'USD',
          userId: tenant.userId,
        },
      });

      const deposits = await poll(async () => {
        const items = await byTypename('DepositDetected');
        return items.length ? items : undefined;
      }, 180_000);
      expect(deposits.length).toBeGreaterThan(0);
      deposits.forEach((row, i) =>
        expectContractMatch(SimDepositCompletedSchema, row, `SimDepositCompleted[${i}]`),
      );

      // Emit SIM_WITHDRAWAL_REQUESTED directly to broker-sim-adpt. Subject fields:
      // {withdrawalId, amount, userId}. NOTE the deposit/withdrawal asymmetry —
      // withdrawal carries `amount` (dollars), not amountCents. The funded() fixture
      // seeded 2_000_000 cents = $20_000 of virtual cash; withdraw $2_500 (< balance)
      // so the guarded debit succeeds and a `WithdrawalCompleted` row is written
      // (__typename='WithdrawalCompleted') → CDC SIM_WITHDRAWAL_COMPLETED.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-sim-adpt',
        detailType: 'SIM_WITHDRAWAL_REQUESTED',
        detail: {
          withdrawalId: `e2e-withdrawal-${randomUUID()}`,
          amount: 2_500,
          userId: tenant.userId,
        },
      });

      const withdrawals = await poll(async () => {
        const items = await byTypename('WithdrawalCompleted');
        return items.length ? items : undefined;
      }, 180_000);
      expect(withdrawals.length).toBeGreaterThan(0);
      withdrawals.forEach((row, i) =>
        expectContractMatch(SimWithdrawalCompletedSchema, row, `SimWithdrawalCompleted[${i}]`),
      );
    },
    420_000,
  );
});

// ===========================================================================
// Block B — REAL Alpaca paper path (gated, high-fidelity)
// ===========================================================================

describe('execution-domain producer contracts — REAL Alpaca paper path', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddbClient: DynamoDBClient;
  let ddbDoc: DynamoDBDocumentClient;

  beforeAll(async () => {
    // Wipe open orders + positions on the REAL paper account before we start.
    // alpacaPaperReset refuses any non-paper-allowlist baseUrl.
    ctx = await createTestContext();
    await alpacaPaperReset(ctx.prefix, { region: ctx.region });
  }, 120_000);

  beforeEach(async () => {
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded(), funded({ cashBalanceCents: 2_000_000 })]);
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);
  }, 600_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  afterAll(async () => {
    // 1. Reset the paper account again so no test orders/positions linger.
    await alpacaPaperReset(ctx.prefix, { region: ctx.region });
    // 2. Orphaned poll-SF cleanup (safety, 2026-04-10 real-paper-leak): stop any
    //    RUNNING broker-alpaca Order/Transfer polling executions for this tenant so
    //    they don't keep polling the real paper account after the suite ends.
    await stopOrphanedPollExecutions(ctx, tenant?.tenantId);
  }, 180_000);

  // -------------------------------------------------------------------------
  // it 1 — broker-alpaca AlpacaOrderResult (REAL paper order)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaOrderResult subject parses (REAL paper order)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const brokerCtrlTable = await ctx.ssm.tableName('broker-ctrl');
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // Switch the tenant to LIVE. EXECUTION_MODE_CHANGED materialises the
      // broker-ctrl ExecutionMode row that ReadExecutionMode reads to route to
      // alpaca. Poll the row to mode='live' BEFORE submitting (see caveat b).
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: { mode: 'live' },
      });
      await poll(async () => {
        const r = await ddbDoc.send(
          new GetCommand({
            TableName: brokerCtrlTable,
            Key: { pk: `ExecutionMode#${tenant.tenantId}`, sk: 'ExecutionMode' },
          }),
        );
        const item = r.Item as { mode?: string } | undefined;
        return item?.mode === 'live' ? item : undefined;
      }, 60_000);

      // Drive a REAL paper order. The order route (live) emits ALPACA_ORDER_REQUESTED
      // to broker-alpaca-adpt, which submits to the real paper API and writes an
      // AlpacaOrderResult row (pk=`OrderMapping#${tenantId}#${nestfolioOrderId}`,
      // sk='OrderMapping', __typename='AlpacaOrderResult'). Same ORDER_SUBMITTED
      // caveat (a) as the SIM route — the controller confirms/repairs the SF input
      // shape; the closing run hardens this leg.
      const orderId = `e2e-live-order-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'ORDER_SUBMITTED',
        detail: {
          orderId,
          userId: tenant.userId,
          symbol: 'VTI',
          side: 'BUY',
          quantity: 1,
          instrumentId: 'VTI',
        },
      });

      // Generous deadline — real Alpaca API + the order-polling SF.
      const results = await poll(async () => {
        const items = await alpacaByTypename('AlpacaOrderResult');
        return items.length ? items : undefined;
      }, 360_000);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((row, i) =>
        expectContractMatch(AlpacaOrderResultSchema, row, `AlpacaOrderResult[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 2 — broker-alpaca AlpacaTransferResult (REAL paper transfer)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaTransferResult subject parses (REAL paper transfer)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const brokerCtrlTable = await ctx.ssm.tableName('broker-ctrl');
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // Ensure LIVE mode (broker-ctrl deposit/withdrawal router routes transfers to
      // alpaca only in live mode).
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: { mode: 'live' },
      });
      await poll(async () => {
        const r = await ddbDoc.send(
          new GetCommand({
            TableName: brokerCtrlTable,
            Key: { pk: `ExecutionMode#${tenant.tenantId}`, sk: 'ExecutionMode' },
          }),
        );
        const item = r.Item as { mode?: string } | undefined;
        return item?.mode === 'live' ? item : undefined;
      }, 60_000);

      // Drive a REAL paper transfer. DEPOSIT_INITIATED (live) → broker-ctrl
      // deposit-withdrawal-router → ALPACA_TRANSFER_REQUESTED → broker-alpaca, which
      // initiates a real paper ACH transfer and writes an AlpacaTransferResult row
      // (sk='TransferMapping', __typename='AlpacaTransferResult').
      // NOTE: the broker-alpaca transfer handler reads {transferId, direction, amount,
      // relationshipId} off the routed ALPACA_TRANSFER_REQUESTED subject; the
      // broker-ctrl router builds that from DEPOSIT_INITIATED. The DEPOSIT_INITIATED
      // subject shape here ({depositId, amountCents, currency, userId}) mirrors the
      // investor-adpt DepositInitiatedSchema the router parses — the controller
      // confirms the exact router→adapter field mapping during the closing run.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'DEPOSIT_INITIATED',
        detail: {
          depositId: `e2e-live-deposit-${randomUUID()}`,
          amountCents: 100_00,
          currency: 'USD',
          userId: tenant.userId,
        },
      });

      const results = await poll(async () => {
        const items = await alpacaByTypename('AlpacaTransferResult');
        return items.length ? items : undefined;
      }, 360_000);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((row, i) =>
        expectContractMatch(AlpacaTransferResultSchema, row, `AlpacaTransferResult[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 3 — broker-alpaca AlpacaAccountSnapshot (REAL account check)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaAccountSnapshot subject parses (REAL account check)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // ALPACA_ACCOUNT_CHECK is handled directly by broker-alpaca's Ingress
      // (no SF, no live-mode gate — the handler GETs the account + positions and
      // writes an AlpacaAccountSnapshot row, pk=`AccountSnapshot#${tenantId}`,
      // sk=`Snapshot#${ts}`, __typename='AlpacaAccountSnapshot'). The subject needs
      // no fields. NOTE the contract: equity/buyingPower are STRING|null (raw Alpaca
      // API strings), status?/failureReason? optional — intentional/real (see
      // contract doc-comments + backlog broker-alpaca-account-snapshot-equity-string-drift).
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ACCOUNT_CHECK',
        detail: {},
      });

      const snapshots = await poll(async () => {
        const items = await alpacaByTypename('AlpacaAccountSnapshot');
        return items.length ? items : undefined;
      }, 240_000);
      expect(snapshots.length).toBeGreaterThan(0);
      snapshots.forEach((row, i) =>
        expectContractMatch(AlpacaAccountSnapshotSchema, row, `AlpacaAccountSnapshot[${i}]`),
      );
    },
    420_000,
  );
});

// ---------------------------------------------------------------------------
// Orphaned poll-SF cleanup (safety) — best-effort, never fails the suite.
//
// Stops any RUNNING broker-alpaca Order/Transfer polling Step Function executions
// whose input carries this tenantId, so they stop hitting the real paper account
// after the test ends. SF names follow the Orchestration construct's convention
// `${prefix}-${service}-${id.toLowerCase()}`:
//   ${prefix}-broker-alpaca-adpt-orderpollingstatemachine
//   ${prefix}-broker-alpaca-adpt-transferpollingstatemachine
// (the polling SFs use EB-trigger naming, not executionName, so the tenantId lives
// in the execution INPUT, not the execution name — hence the DescribeExecution
// input scan). Wrapped in try/catch + logging; the controller hardens it during
// the closing run.
// ---------------------------------------------------------------------------
async function stopOrphanedPollExecutions(
  ctx: TestContext,
  tenantId: string | undefined,
): Promise<void> {
  if (!tenantId) return;
  const sfn = new SFNClient({ region: ctx.region });
  try {
    const namePrefix = `${ctx.prefix}-broker-alpaca-adpt-`;
    const isPollingSm = (name: string | undefined): boolean =>
      !!name && name.startsWith(namePrefix) && name.toLowerCase().includes('pollingstatemachine');

    // 1. Discover the polling state machines by name prefix.
    const smArns: string[] = [];
    let smToken: string | undefined;
    do {
      const page = await sfn.send(new ListStateMachinesCommand({ maxResults: 100, nextToken: smToken }));
      for (const sm of page.stateMachines ?? []) {
        if (isPollingSm(sm.name) && sm.stateMachineArn) smArns.push(sm.stateMachineArn);
      }
      smToken = page.nextToken;
    } while (smToken);

    // 2. For each, stop RUNNING executions whose input carries this tenantId.
    for (const arn of smArns) {
      let exToken: string | undefined;
      do {
        const page = await sfn.send(
          new ListExecutionsCommand({
            stateMachineArn: arn,
            statusFilter: 'RUNNING',
            maxResults: 100,
            nextToken: exToken,
          }),
        );
        for (const ex of page.executions ?? []) {
          if (!ex.executionArn) continue;
          try {
            const desc = await sfn.send(
              new DescribeExecutionCommand({ executionArn: ex.executionArn }),
            );
            if ((desc.input ?? '').includes(tenantId)) {
              await sfn.send(
                new StopExecutionCommand({
                  executionArn: ex.executionArn,
                  cause: 'e2e execution-contract-emission cleanup',
                }),
              );
            }
          } catch (innerErr) {
            // eslint-disable-next-line no-console
            console.warn('poll-SF cleanup: failed to inspect/stop execution', {
              executionArn: ex.executionArn,
              error: (innerErr as Error).message,
            });
          }
        }
        exToken = page.nextToken;
      } while (exToken);
    }
  } catch (err) {
    // Best-effort — never fail the suite on cleanup. The controller hardens this.
    // eslint-disable-next-line no-console
    console.warn('poll-SF cleanup encountered an error (non-fatal)', {
      error: (err as Error).message,
    });
  } finally {
    sfn.destroy();
  }
}
