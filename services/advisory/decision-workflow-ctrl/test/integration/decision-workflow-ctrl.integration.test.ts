import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';

/**
 * decision-workflow-ctrl integration tests — direct EB → SF trigger paths.
 *
 * Handler groups tested:
 * 1. Direct EB → SF triggers (7): MANDATE_SNAPSHOT_CREATED,
 *    INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED,
 *    ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED → SF execution started.
 * 2. MandateProjector ingress: MANDATE_ISSUED materialises a MandateSnapshot
 *    row in the local State table (subsequent CDC emits MANDATE_SNAPSHOT_CREATED).
 *
 * Post-2026-05-10 (operating-mode-lookup): INVESTOR_PROFILE_CREATED was
 * removed as an SF trigger, replaced by MANDATE_SNAPSHOT_CREATED (the CDC of
 * decision-workflow-ctrl's own MandateSnapshot:INSERT). The SF
 * unconditionally LookupMandateSnapshot via Direct DDB GetItem to resolve
 * operatingMode, eliminating the per-trigger payload-vs-projection branching.
 *
 * Cross-domain triggers (PORTFOLIO_DRIFT_DETECTED + ORDER_* + DEPOSIT_DETECTED)
 * are unchanged — kept here as regression coverage.
 *
 * NOT tested here:
 *   CallbackIngress (sfn-callback.ts) — the resumeStateMachine pipeline requires
 *   a valid taskToken from a running Step Functions execution. Testing the
 *   callback path requires: (1) send trigger event, (2) wait for SF to start
 *   and emit agent dispatch events with task tokens, (3) send callback events
 *   with those tokens. This full lifecycle test would take 120-180s per run
 *   and depends on the SF definition plus AgentCore Memory being wired.
 *   Deferred to a dedicated SF lifecycle test plan.
 */

/**
 * Poll Step Functions ListExecutions until an execution started after `since`
 * appears on the given state machine ARN. Returns the execution metadata.
 */
async function waitForSfExecution(
  sfn: SFNClient,
  params: {
    stateMachineArn: string;
    since: Date;
    timeoutMs?: number;
  },
): Promise<{ executionArn: string; startDate: Date; name: string }> {
  const timeout = params.timeoutMs ?? 60_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const resp = await sfn.send(new ListExecutionsCommand({
      stateMachineArn: params.stateMachineArn,
      maxResults: 20,
    }));
    const fresh = (resp.executions ?? []).find(
      (e) => e.startDate && new Date(e.startDate) >= params.since,
    );
    if (fresh?.executionArn && fresh.startDate && fresh.name) {
      return {
        executionArn: fresh.executionArn,
        startDate: new Date(fresh.startDate),
        name: fresh.name,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout: no SF execution on ${params.stateMachineArn} started after ${params.since.toISOString()} within ${timeout}ms`,
  );
}

describe('decision-workflow-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let sfn: SFNClient;
  let stateMachineArn: string;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    sfn = new SFNClient({ region: ctx.region });
    // ctx.accountId is not exposed by @nestfolio/test-support; resolve via STS.
    const sts = new (await import('@aws-sdk/client-sts')).STSClient({});
    const ident = await sts.send(new (await import('@aws-sdk/client-sts')).GetCallerIdentityCommand({}));
    stateMachineArn = `arn:aws:states:${ctx.region}:${ident.Account}:stateMachine:${ctx.prefix}-decision-workflow-ctrl-decisionstatemachine`;

    // Trap CDC events emitted by decision-workflow-ctrl Egress (DECISION_PACKET / AGENT_OUTPUT only;
    // WORKFLOW_TRIGGER_* was removed in Phase 2).
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_UPDATED',
        'AGENT_OUTPUT_CREATED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── MANDATE_ISSUED → MandateSnapshot projection → MANDATE_SNAPSHOT_CREATED → SF ──

  it('projects MandateSnapshot from MANDATE_ISSUED → emits MANDATE_SNAPSHOT_CREATED → starts SF', async () => {
    const userId = `integ-mandate-${Date.now()}`;
    const mandateId = `e2e-mandate-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'BALANCED',
        effectiveDate: new Date().toISOString(),
      },
    });

    // 1. The mandate-projector ingress materialises a MandateSnapshot row.
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MandateSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 30_000,
    });

    // 2. CDC on that row's INSERT emits MANDATE_SNAPSHOT_CREATED → SF starts.
    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── Non-PROFILE trigger after projection: SF can resolve operatingMode ──

  it('non-PROFILE trigger (DEPOSIT_DETECTED) starts SF after MandateSnapshot exists', async () => {
    const userId = `integ-deposit-mandate-${Date.now()}`;
    const mandateId = `e2e-mandate-${Date.now()}`;

    // Project MandateSnapshot first so the SF's LookupMandateSnapshot can resolve operatingMode.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'AGGRESSIVE',
        effectiveDate: new Date().toISOString(),
      },
    });
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MandateSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 30_000,
    });

    // Now the deposit trigger — the SF resolves operatingMode via Direct DDB GetItem.
    const testStart = new Date();
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `integ-deposit-${Date.now()}`,
        tenantId: ctx.tenantId,
        userId,
        amount: 5000,
        currency: 'USD',
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── INVESTOR_PROFILE_UPDATED ─────────────────────────────────────────

  it('starts SF on INVESTOR_PROFILE_UPDATED', async () => {
    const userId = `integ-investor-upd-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        userId,
        tenantId: ctx.tenantId,
        mandate: {
          riskTolerance: 'AGGRESSIVE',
          investmentHorizon: 'LONG_TERM',
          targetReturn: 0.12,
        },
        goal: {
          goalType: 'RETIREMENT',
          targetAmount: 1_500_000,
          targetDate: '2055-01-01',
        },
        riskProfile: {
          score: 9,
          band: 'AGGRESSIVE',
        },
        operatingMode: 'AGGRESSIVE',
        updatedAt: new Date().toISOString(),
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── PORTFOLIO_DRIFT_DETECTED ─────────────────────────────────────────

  it('starts SF on PORTFOLIO_DRIFT_DETECTED', async () => {
    const portfolioId = `integ-drift-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        portfolioId,
        tenantId: ctx.tenantId,
        driftPercentage: 0.15,
        driftDirection: 'OVERWEIGHT_EQUITY',
        detectedAt: new Date().toISOString(),
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── DEPOSIT_DETECTED ─────────────────────────────────────────────────

  it('starts SF on DEPOSIT_DETECTED', async () => {
    const depositId = `integ-deposit-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId,
        tenantId: ctx.tenantId,
        amount: 5000,
        currency: 'USD',
        detectedAt: new Date().toISOString(),
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── ORDER_FILLED ─────────────────────────────────────────────────────

  it('starts SF on ORDER_FILLED', async () => {
    const orderId = `integ-fill-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150,
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── ORDER_REJECTED ───────────────────────────────────────────────────

  it('starts SF on ORDER_REJECTED', async () => {
    const orderId = `integ-rej-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'TSLA',
        reason: 'Margin',
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── CallbackIngress: PORTFOLIO_COMPLETED → AgentOutput row ───────────
  //
  // Post advisory-cycle-agent-precomputation Task 10: PORTFOLIO_COMPLETED
  // and NARRATIVE_COMPLETED are the only completion events that resume the
  // SF (IP and MI now precompute snapshots). The handler writes an
  // AgentOutput row at pk=`T#${tenantId}`, sk=`AgentOutput#${eventId}`
  // BEFORE calling SendTaskSuccess. With a synthetic taskToken the SF call
  // fails with InvalidToken, which the pipeline tolerates — the DDB write
  // is the verifiable contract.

  const fakeTaskToken = (label: string) =>
    `ARN-fake-${label}-${randomUUID()}-${'x'.repeat(64)}`;

  it('CallbackIngress writes AgentOutput row on PORTFOLIO_COMPLETED', async () => {
    const decisionId = `cb-pc-${randomUUID()}`;
    const eventId = `cb-pc-evt-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_COMPLETED',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: fakeTaskToken('pc'),
        agentOutput: { proposedTrades: [{ symbol: 'SPY', side: 'BUY', quantity: 5 }] },
      },
      eventId,
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      sk: `AgentOutput#${eventId}`,
      timeoutMs: 60_000,
    });
    expect(row['__typename']).toBe('AgentOutput');
    expect(row['decisionId']).toBe(decisionId);
  }, 120_000);

  it('CallbackIngress writes AgentOutput row on NARRATIVE_COMPLETED', async () => {
    const decisionId = `cb-nc-${randomUUID()}`;
    const eventId = `cb-nc-evt-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'NARRATIVE_COMPLETED',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: fakeTaskToken('nc'),
        agentOutput: { explanation: 'integration narrative output' },
      },
      eventId,
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      sk: `AgentOutput#${eventId}`,
      timeoutMs: 60_000,
    });
    expect(row['__typename']).toBe('AgentOutput');
    expect(row['decisionId']).toBe(decisionId);
  }, 120_000);

  // ── Payload-first Choice: trigger payload carries operatingMode ────
  //
  // The SF's ResolveMandateSnapshot Choice prefers an inline operatingMode
  // on the trigger envelope over the MandateSnapshot projection. This test
  // sends INVESTOR_PROFILE_UPDATED carrying operatingMode=AGGRESSIVE
  // inline; even if a MandateSnapshot with a different operatingMode were
  // present, the SF should hoist the payload value.
  //
  // Verification here is at the start-of-SF level — full payload-vs-projection
  // assertion requires reading the SF execution state, which is covered by
  // unit tests on decision-state-machine.test.ts and by the Playwright UI
  // e2e suite. Here we assert the SF starts cleanly (operatingMode resolves
  // without LookupMandateSnapshot's fallback failing).

  it('payload-first Choice: SF starts on INVESTOR_PROFILE_UPDATED carrying inline operatingMode (no pre-seeded MandateSnapshot)', async () => {
    const userId = `payload-first-${randomUUID()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        userId,
        tenantId: ctx.tenantId,
        operatingMode: 'AGGRESSIVE',
        investorProfile: { riskScore: 90 },
        updatedAt: new Date().toISOString(),
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);

  // ── ORDER_CANCELLED ──────────────────────────────────────────────────

  it('starts SF on ORDER_CANCELLED', async () => {
    const orderId = `integ-cancel-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'ORDER_CANCELLED',
      detail: {
        orderId,
        tenantId: ctx.tenantId,
        symbol: 'GOOG',
      },
    });

    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);
});

// ── LedgerSnapshot projection (workstream ferry-ledger-positions-to-advisory) ─
//
// Verifies the SnapshotProjectorIngress PORTFOLIO_UPDATED handler materialises
// a LedgerSnapshot row in the DWC local State table. The row is keyed at
// pk=`LedgerSnapshot#${tenantId}`, sk='LedgerSnapshot' (see
// projected-snapshot.repository.ts).
//
// NOTE: These tests WILL FAIL against dev until the ferry-ledger deploy
// (Task 19) has run — the SnapshotProjectorIngress subscription to
// PORTFOLIO_UPDATED from the advisory bus, and the SF Branch C
// LookupLedgerSnapshot, are added in this workstream.

describe('LedgerSnapshot projection', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('materialises a LedgerSnapshot row from PORTFOLIO_UPDATED', async () => {
    // `detail` is the SUBJECT body — eb.putEvent wraps it in {id,type,timestamp,subject:detail,context}.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        streamType: 'CASH',
        snapshot: {
          positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
          cashBalanceCents: 500_000,
          lastEventSequence: 1,
        },
      },
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `LedgerSnapshot#${ctx.tenantId}`,
      sk: 'LedgerSnapshot',
      timeoutMs: 60_000,
    });

    expect(row['tenantId']).toBe(ctx.tenantId);
    expect(row['lastEventSequence']).toBe(1);
    const parsed = JSON.parse(row['state'] as string) as {
      positions: { VTI?: { quantity: number } };
      cashBalanceCents: number;
    };
    expect(parsed.positions.VTI?.quantity).toBe(10);
    expect(parsed.cashBalanceCents).toBe(500_000);
  }, 120_000);

  it('repeated PORTFOLIO_UPDATED for the same tenant upserts (last write wins)', async () => {
    // Emit seq=5 — first upsert
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        streamType: 'CASH',
        snapshot: {
          positions: { VTI: { quantity: 5, lastFillPrice: 200 } },
          cashBalanceCents: 300_000,
          lastEventSequence: 5,
        },
      },
    });

    // Wait for seq=5 to land
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `LedgerSnapshot#${ctx.tenantId}`,
      sk: 'LedgerSnapshot',
      predicate: (item) => item['lastEventSequence'] === 5,
      description: 'lastEventSequence === 5',
      timeoutMs: 60_000,
    });

    // Emit seq=7 — second upsert (last write wins)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        streamType: 'CASH',
        snapshot: {
          positions: { VTI: { quantity: 7, lastFillPrice: 210 } },
          cashBalanceCents: 800_000,
          lastEventSequence: 7,
        },
      },
    });

    // Wait for seq=7 to overwrite — confirms last-write-wins upsert.
    // NOTE: there is no lastEventSequence guard today (no conditional update).
    // See ferry-ledger spec §"Late-arrival behaviour" for context.
    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `LedgerSnapshot#${ctx.tenantId}`,
      sk: 'LedgerSnapshot',
      predicate: (item) => item['lastEventSequence'] === 7,
      description: 'lastEventSequence === 7',
      timeoutMs: 60_000,
    });

    const parsed = JSON.parse(row['state'] as string) as { cashBalanceCents: number };
    expect(parsed.cashBalanceCents).toBe(800_000);
  }, 120_000);
});

