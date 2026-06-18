/**
 * Validation-gate e2e — execution-domain producer contracts vs REAL deployed emission.
 *
 * Under WS-2 the CDC publisher emits `schema.parse(row)` (the DRY subject); a row
 * that parses here proves the emitted DRY subject is well-formed (the live DRY-wire
 * assertion is added by Task 9's capture).
 * This is the execution-domain twin of ledger-contract-emission.e2e.test.ts.
 *
 * ─── Strategy: drive each producer's ADAPTER DIRECTLY ────────────────────────
 *   Earlier drafts drove broker-ctrl's OrderStateMachine (via ORDER_SUBMITTED →
 *   broker-ctrl) to reach the VirtualTrade / NormalizedOrderEvent legs. That SF
 *   reads top-level `$.detail` routing fields (tenantId/orderId/symbol/side/
 *   quantity), but the EventBridgeClient harness nests the payload under
 *   `.subject` and injects `.context` — so a putEvent-emitted ORDER_SUBMITTED
 *   never carries those fields where the SF expects them, and the canonical
 *   ORDER_SUBMITTED → OrderStateMachine path is a latent/unexercised integration
 *   gap (out of scope for this contracts slice; see boundary note + backlog id
 *   `broker-ctrl-order-sf-input-contract-gap`).
 *
 *   The clean fix for THIS gate: validate each producer by driving its adapter
 *   directly. The execution adapters (broker-sim-adpt, broker-alpaca-adpt) are
 *   SQS→Lambda event-processor handlers that read `payload.subject` (the standard
 *   envelope) — exactly what EventBridgeClient.putEvent produces. So a direct
 *   putEvent to the adapter's own inbound event drives the real deployed
 *   producer, and we read back the row it materialises. No SF, no mode router,
 *   no market-hours gate in the path.
 *
 *   Two blocks:
 *
 *   Block A — SIM path (deterministic, no real money). beforeEach onboarded() +
 *     funded({ cashBalanceCents: 2_000_000 }):
 *       1. execution-ctrl Order      (DECISION_APPROVED → event-listener → Order row)
 *       2. broker-sim VirtualTrade   (SIM_DEPOSIT_INITIATED to fund the virtual
 *          ledger, then SIM_ORDER_REQUESTED → simulation engine → VirtualTrade row)
 *       3. broker-sim DepositDetected + WithdrawalCompleted
 *          (SIM_DEPOSIT_INITIATED / SIM_WITHDRAWAL_REQUESTED → virtual ledger)
 *       StagedOrder is a documented boundary (only written when the market is
 *       closed; covered by execution-ctrl unit tests). Asserted opportunistically.
 *
 *   Block B — REAL Alpaca paper path (gated, high-fidelity, real external API).
 *     NO mode switch needed — broker-alpaca-adpt always talks to the real Alpaca
 *     paper API, so we drive its inbound events directly (bypassing broker-ctrl's
 *     mode router):
 *       - broker-alpaca AlpacaOrderResult     (ALPACA_ORDER_REQUESTED → real paper order)
 *       - broker-alpaca AlpacaTransferResult   (ALPACA_TRANSFER_REQUESTED → real paper ACH)
 *       - broker-alpaca AlpacaAccountSnapshot   (ALPACA_ACCOUNT_CHECK → real account GET)
 *     Safety mitigations:
 *       - alpacaPaperReset() in beforeAll + afterAll (refuses any non-paper baseUrl).
 *       - Orphaned poll-SF cleanup in afterAll: stops any RUNNING broker-alpaca
 *         Order/Transfer polling Step Function executions for this tenant so they
 *         stop hitting the real paper account after the test ends.
 *
 * ─── Documented boundaries (NOT driven here) ─────────────────────────────────
 *   - broker-ctrl NormalizedOrderEvent (ORDER_FILLED etc.) — emitted ONLY by
 *     broker-ctrl's OrderStateMachine, which has a latent input-shape gap (the SF
 *     reads top-level $.detail routing fields; the canonical ORDER_SUBMITTED → SF
 *     path is unexercised — the harness nests payload under .subject/.context).
 *     Unit-test-validated; e2e deferred. Backlog: broker-ctrl-order-sf-input-contract-gap.
 *   - broker-ctrl BrokerOrder / ExecutionMode — internal rows, NOT CDC-emitted.
 *     Unit-validated.
 *   - broker-alpaca BrokerCircuitEvent / CircuitBreaker — covered by unit tests +
 *     circuit-breaker-lifecycle.e2e.test.ts.
 *   - broker-sim internal Virtual* rows (VirtualCashBalance / VirtualPosition /
 *     VirtualSnapshot) — NOT CDC-emitted. Unit-validated.
 *   - execution-ctrl StagedOrder — only written when the market is closed.
 *     Unit-validated; asserted opportunistically in it 1 if the run lands outside
 *     market hours.
 *
 * ─── Run discipline ──────────────────────────────────────────────────────────
 *   This file is typecheck/lint-clean and wired for a closing phase to run +
 *   harden against deployed dev. DO NOT run it outside that closing phase (Block B
 *   hits the real Alpaca paper account). Per the typed-subject-contracts lesson,
 *   the controller validates the mechanics against the REAL deployed system, not
 *   fixtures.
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
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  SFNClient,
  ListStateMachinesCommand,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import { randomUUID } from 'crypto';
import { OrderSchema, StagedOrderSchema } from '@nestfolio/execution-ctrl/contracts';
import {
  VirtualTradeSchema,
  SimDepositCompletedSchema,
  SimWithdrawalCompletedSchema,
} from '@nestfolio/broker-sim-adpt/contracts';
import {
  AlpacaOrderResultSchema,
  AlpacaAccountSnapshotSchema,
} from '@nestfolio/broker-alpaca-adpt/contracts';
// AlpacaTransferResultSchema moved to execution-adpt/domain in Task 2 (broker-ctrl
// also consumes it — mutual producer/consumer pair, so it lives in the shared adapter domain).
import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';
import { expectContractMatch } from '../helpers/contract-assert';
import { armEventSubjectTrap } from '../helpers/event-subject-trap';
import { ExecutionCtrlEventTypes } from '@nestfolio/execution-ctrl/events';
import type { ComplianceCheck } from '@nestfolio/compliance-ctrl/contracts';

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

// A valid ComplianceCheck subject for DECISION_APPROVED. execution-ctrl's
// event-listener parses the subject via ComplianceCheckSchema (WS-3 consumer
// typing — services/execution/execution-ctrl/src/handlers/event-listener.ts
// fromDecisionApproved), so the trigger MUST satisfy that contract or the parse
// throws and no Order row is ever written. fromDecisionApproved reads ONLY
// decisionPacketId — proposedTrades ride RECOMMENDATION_PROPOSED, not this event,
// so the resulting Order carries proposedTrades:[] (faithful to production; see
// the event-listener doc-comment + backlog broker-ctrl-order-sf-input-contract-gap).
function approvedComplianceCheck(decisionPacketId: string): ComplianceCheck {
  return {
    ccId: `e2e-cc-${randomUUID()}`,
    decisionPacketId,
    decisionId: `e2e-dec-${randomUUID()}`,
    taskToken: `e2e-tasktoken-${randomUUID()}`,
    mandateSnapshot: {
      level: 'DISCRETIONARY',
      status: 'ACTIVE',
      operatingMode: 'BALANCED',
      effectiveDate: '2026-01-01T00:00:00.000Z',
    },
    status: 'COMPLETED',
    result: 'APPROVED',
    violations: [],
    authorityLevel: 'L1',
    sourceEventId: `e2e-src-${randomUUID()}`,
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
    // onboarded() defaults the tenant to SIMULATION mode. funded() seeds the
    // investor-bff CashBalance read model (NOT the broker-sim virtual ledger);
    // each broker-sim leg that needs virtual cash funds it explicitly via a
    // SIM_DEPOSIT_INITIATED below.
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
        subject: approvedComplianceCheck(decisionPacketId),
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
  // it 2 — broker-sim VirtualTrade (DIRECT, not via broker-ctrl SF)
  // -------------------------------------------------------------------------
  it(
    'broker-sim: VirtualTrade subject parses (direct SIM_ORDER_REQUESTED)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('broker-sim-adpt');
      const byTypename = makeByTypename(ddbDoc, table, tenant.tenantId);

      // funded() seeds investor-bff, NOT the broker-sim VIRTUAL ledger. The sim
      // BUY order would otherwise reject on insufficient virtual cash, so fund the
      // virtual ledger first with a SIM_DEPOSIT_INITIATED and wait for the
      // DepositDetected row (proves the guarded credit landed). Subject fields are
      // those read by broker-sim's event-listener SIM_DEPOSIT_INITIATED handler:
      // {depositId, amountCents, currency, userId}.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-sim-adpt',
        detailType: 'SIM_DEPOSIT_INITIATED',
        detail: {
          depositId: `e2e-simdep-${randomUUID()}`,
          amountCents: 1_000_000,
          currency: 'USD',
          userId: tenant.userId,
        },
      });
      await poll(async () => {
        const items = await byTypename('DepositDetected');
        return items.length ? items : undefined;
      }, 180_000);

      // Drive the sim engine DIRECTLY via SIM_ORDER_REQUESTED. broker-sim's
      // event-listener reads the subject as {orderId, userId, symbol, side,
      // quantity} (services/execution/broker-sim-adpt/src/handlers/event-listener.ts
      // SIM_ORDER_REQUESTED handler, lines 24-28). The engine fills the order and
      // writes a VirtualTrade row (sk=`Trade#${tradeId}`, __typename='VirtualTrade')
      // → CDC SIM_ORDER_FILLED. The emitted subject is validated by VirtualTradeSchema.
      const orderId = `e2e-simord-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-sim-adpt',
        detailType: 'SIM_ORDER_REQUESTED',
        detail: {
          orderId,
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          symbol: 'VTI',
          side: 'BUY',
          quantity: 5,
        },
      });

      const trades = await poll(async () => {
        const items = await byTypename('VirtualTrade');
        return items.length ? items : undefined;
      }, 240_000);
      expect(trades.length).toBeGreaterThan(0);
      trades.forEach((row, i) =>
        expectContractMatch(VirtualTradeSchema, row, `VirtualTrade[${i}]`),
      );
    },
    420_000,
  );

  // -------------------------------------------------------------------------
  // it 3 — broker-sim funding: DepositDetected + WithdrawalCompleted
  // -------------------------------------------------------------------------
  it(
    'broker-sim: DepositDetected + WithdrawalCompleted subjects parse (SIM funding)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const table = await ctx.ssm.tableName('broker-sim-adpt');
      const byTypename = makeByTypename(ddbDoc, table, tenant.tenantId);

      // Emit SIM_DEPOSIT_INITIATED directly to broker-sim-adpt. Subject fields are
      // those read by broker-sim's event-listener SIM_DEPOSIT_INITIATED handler:
      // {depositId, amountCents, currency, userId}. It writes a `DepositDetected`
      // row (pk=`DepositDetected#${tenantId}#${eventId}`, sk='DepositDetected',
      // __typename='DepositDetected') → CDC SIM_DEPOSIT_COMPLETED. The emitted
      // subject is validated by SimDepositCompletedSchema. This deposit also funds
      // the virtual ledger so the withdrawal below can draw from it.
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

      // Emit SIM_WITHDRAWAL_REQUESTED directly to broker-sim-adpt. Subject fields
      // read by the handler (lines 76-78): {withdrawalId, amount, userId}. NOTE the
      // deposit/withdrawal asymmetry — withdrawal carries `amount` in DOLLARS, not
      // amountCents. The deposit above credited $5,000 of virtual cash; withdraw
      // $2,500 (< balance) so the guarded debit succeeds and a `WithdrawalCompleted`
      // row is written (__typename='WithdrawalCompleted') → CDC SIM_WITHDRAWAL_COMPLETED.
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
//
// Drives broker-alpaca-adpt's inbound events DIRECTLY. The adapter always talks
// to the real Alpaca paper API — there is no mode router to satisfy here.
// The live mode switch (EXECUTION_MODE_CHANGED + broker-ctrl ExecutionMode-row
// poll-confirm) is exercised by `src/account/go-live-switch.e2e.test.ts`.
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
    // 2. Orphaned poll-SF cleanup (safety, real-paper-leak): stop any RUNNING
    //    broker-alpaca Order/Transfer polling executions for this tenant so they
    //    don't keep polling the real paper account after the suite ends.
    await stopOrphanedPollExecutions(ctx, tenant?.tenantId);
  }, 180_000);

  // -------------------------------------------------------------------------
  // it 1 — broker-alpaca AlpacaOrderResult (REAL paper order, DIRECT)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaOrderResult subject parses (REAL paper order)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // Drive a REAL paper order DIRECTLY via ALPACA_ORDER_REQUESTED. broker-alpaca's
      // processOrderRequested reads the subject as {orderId, symbol, side, quantity}
      // (services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts
      // processOrderRequested, lines 122-124). It submits to the real paper API and
      // writes an AlpacaOrderResult row (pk=`OrderMapping#${tenantId}#${orderId}`,
      // sk='OrderMapping', __typename='AlpacaOrderResult') → CDC ALPACA_ORDER_*. The
      // emitted subject is validated by AlpacaOrderResultSchema (REJECTED is a valid
      // status, so the contract still holds even if the paper API rejects the order).
      const orderId = `e2e-live-order-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        detail: {
          orderId,
          symbol: 'VTI',
          side: 'BUY',
          quantity: 1,
        },
      });

      // Generous deadline — real Alpaca API.
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
  // it 2 — broker-alpaca AlpacaTransferResult (REAL paper transfer, DIRECT)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaTransferResult subject parses (REAL paper transfer)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // Drive a REAL paper transfer DIRECTLY via ALPACA_TRANSFER_REQUESTED.
      // broker-alpaca's processTransferRequested reads the subject as {transferId,
      // direction, amount, relationshipId} (event-listener.ts processTransferRequested,
      // lines 209-215). It initiates a real paper ACH transfer and writes an
      // AlpacaTransferResult row (pk=`TransferMapping#${tenantId}#${transferId}`,
      // sk='TransferMapping', __typename='AlpacaTransferResult') → CDC ALPACA_TRANSFER_*.
      // NOTE: a real ACH transfer may need a funded relationship; with relationshipId=''
      // the paper API rejects it and the handler writes the row with status='FAILED'
      // (failureReason set). FAILED is a valid status, so AlpacaTransferResultSchema
      // still validates — this leg proves the contract regardless of transfer outcome.
      const transferId = `e2e-live-transfer-${randomUUID()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_TRANSFER_REQUESTED',
        detail: {
          transferId,
          direction: 'INCOMING',
          amount: 100,
          relationshipId: '',
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
  // it 3 — broker-alpaca AlpacaAccountSnapshot (REAL account check, DIRECT)
  // -------------------------------------------------------------------------
  it(
    'broker-alpaca: AlpacaAccountSnapshot subject parses (REAL account check)',
    async () => {
      const eb = new EventBridgeClient(ctx);
      const alpacaTable = await ctx.ssm.tableName('broker-alpaca-adpt');
      const alpacaByTypename = makeByTypename(ddbDoc, alpacaTable, tenant.tenantId);

      // ALPACA_ACCOUNT_CHECK is handled directly by broker-alpaca's processAccountCheck
      // (event-listener.ts, lines 259-275) — it reads NO subject fields, GETs the
      // account + positions, and writes an AlpacaAccountSnapshot row
      // (pk=`AccountSnapshot#${tenantId}`, sk=`Snapshot#${ts}`,
      // __typename='AlpacaAccountSnapshot') → CDC ALPACA_ACCOUNT_SNAPSHOT. The subject
      // needs no fields. NOTE the contract: equity/buyingPower are STRING|null (raw
      // Alpaca API strings), status?/failureReason? optional — intentional/real (see
      // contract doc-comments + backlog broker-alpaca-account-snapshot-equity-string-drift).
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ACCOUNT_CHECK',
        subject: {},
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
// after the test ends. The polling SFs still start even when we drive the adapter
// directly: ALPACA_ORDER_PLACED triggers OrderPollingStateMachine and
// ALPACA_TRANSFER_INITIATED triggers TransferPollingStateMachine (CDC-emitted from
// the rows the direct calls write). SF names follow the Orchestration construct's
// convention `${prefix}-${service}-${id.toLowerCase()}`:
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
      !!name &&
      name.startsWith(namePrefix) &&
      (name.toLowerCase().includes('orderpollingstatemachine') ||
        name.toLowerCase().includes('transferpollingstatemachine'));

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

// ===========================================================================
// DRY-wire emission capture — execution domain (Task 9)
//
// Proves the REAL emitted EventBridge event carries a DRY subject
// (no envelope/identity keys) for the execution-ctrl Order row.
//
// The Order INSERT field-dispatches on `status` (service.stack.ts Egress
// eventTypes map): SUBMITTED→ORDER_SUBMITTED, STAGED→ORDER_STAGED,
// REJECTED→ORDER_REJECTED. The default ORDER_CREATED is unreachable — the
// event-listener only ever writes those three statuses (processApprovedDecision:
// REJECTED on safety fail, SUBMITTED when market open, STAGED when closed).
// Which one fires is non-deterministic across a deployed run (market hours +
// safety outcome), so arm the trap on all three and capture whichever the CDC
// publisher emits — the DRY subject is the same OrderSchema.parse(row) either way.
//
// Arm BEFORE the DECISION_APPROVED putEvent so the trap's EB rule is active
// when the CDC publisher fires. subject = OrderSchema.parse(row) —
// no pk/sk/__typename/tenantId on the emitted subject.
// ===========================================================================

describe('execution-domain DRY-wire emission — Order subject (Task 9)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded(), funded({ cashBalanceCents: 2_000_000 })]);
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it(
    'emits a DRY Order subject (no envelope keys)',
    async () => {
      // Arm BEFORE the putEvent that triggers Order row INSERT. The INSERT emits
      // exactly one of these three (status-dispatched); capture whichever fires.
      const trap = await armEventSubjectTrap(ctx, {
        bus: 'execution',
        detailType: [
          ExecutionCtrlEventTypes.ORDER_SUBMITTED,
          ExecutionCtrlEventTypes.ORDER_STAGED,
          ExecutionCtrlEventTypes.ORDER_REJECTED,
        ],
      });

      // DECISION_APPROVED → execution-ctrl event-listener writes Order row (INSERT)
      // → CDC ORDER_SUBMITTED | ORDER_STAGED | ORDER_REJECTED.
      // subject = OrderSchema.parse(row) — DRY.
      const eb = new EventBridgeClient(ctx);
      await eb.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        subject: approvedComplianceCheck(`e2e-dp-dry-${randomUUID()}`),
      });

      // Wait for the live CDC emission. 300s window (matching the ledger + investor
      // DRY-wire siblings, not the 180s this was first authored with): the full
      // putEvent → ingress → Order INSERT → DDB stream → CDC publish → EB chain can
      // exceed 180s when the execution-ctrl ingress/egress Lambdas are cold or the
      // ingress queue is contended (observed empirically — warm runs land in ~78s).
      const subject = await trap.waitForSubject(300_000);

      // 1. Subject must parse as a well-formed Order contract.
      expectContractMatch(OrderSchema, subject, 'ORDER.subject');

      // 2. Identity keys must NOT be on the subject — they travel in detail.context.
      expect(subject['pk']).toBeUndefined();
      expect(subject['sk']).toBeUndefined();
      expect(subject['__typename']).toBeUndefined();
      expect(subject['tenantId']).toBeUndefined();
    },
    600_000,
  );
});
