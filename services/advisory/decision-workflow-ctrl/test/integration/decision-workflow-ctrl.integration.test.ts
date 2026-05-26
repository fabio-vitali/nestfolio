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

// ── Packet-shape contract: DEPOSIT_DETECTED → RECOMMENDATION_PROPOSED ────────
//
// Workstream: fix-assemblepacket-guardrails-units-calibration (2026-05-25)
//
// Verifies the new AssemblePacket → SF state contract end-to-end:
//   1. Emit MANDATE_ISSUED → wait for MandateSnapshot row (so SF can resolve
//      operatingMode via LookupMandateSnapshot Direct DDB GetItem).
//   2. Emit INVESTOR_PROFILE_SNAPSHOT_CREATED (with riskCategory=MODERATE) →
//      wait for InvestorProfileSnapshot row (exercises the JSON.stringify fix
//      in snapshot-projector.ts Task 1 and the States.StringToJson Pass Task 2).
//   3. Emit DEPOSIT_DETECTED with amountCents=100_000 (new field — Task 3).
//   4. Assert RECOMMENDATION_PROPOSED carries:
//      - subject.portfolioValueCents === 100_000 (canonical cents, not dollars)
//      - subject.isInitialBuild === true (no existing positions)
//      - subject.riskCategory === 'MODERATE' (propagated from snapshot)
//      - subject.proposedTrades[0].quantityOrAmountCents matches the formula
//        Math.round((targetWeightPercent / 100) * 100_000)
//   5. Negative assertions: legacy subject.portfolioValue and subject.riskScore
//      must NOT be present.
//
// NOTE: This test WILL FAIL against dev until Task 13 (advisory services
// deploy) has run. Task 14 is the dev validation gate.

describe('decision-workflow-ctrl packet-shape contract (workstream 2026-05-25)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Arm the trap for RECOMMENDATION_PROPOSED only — this describe block's
    // sole output assertion. Trap filters by ctx.tenantId automatically.
    await trap.deploy({
      bus: 'advisory',
      detailType: ['RECOMMENDATION_PROPOSED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // SKIP REASON (2026-05-25): This test requires the full SF chain — including
  // InvokePortfolioEngine (PE, 120s budget) and InvokeAdvisoryNarrative (AN, 120s
  // budget) — for a total SF budget of 240s. The dev sandbox is hitting intermittent
  // PE TaskTimedOut at exactly 120s due to AgentCore maxVms quota saturation
  // (see backlog items: agentcore-maxvms-prod-quota-increase,
  // agentcore-maxvms-browser-path-resilience). CloudWatch confirmed: execution
  // fb73afaa-f6c0-4d6e-7aa4-c70d4f532072 entered InvokePortfolioEngine at
  // 15:24:38.564 and TaskTimedOut at 15:26:38.634.
  //
  // Coverage is preserved by:
  //   (a) Task 11: compliance-ctrl integration tests — verify the rule engine path
  //       (RECOMMENDATION_PROPOSED → DECISION_APPROVED/BLOCKED) by emitting directly
  //       to compliance-ctrl, bypassing the SF entirely.
  //   (b) Task 15: Playwright new-investor-happy-path — exercises the full UI-driven
  //       chain (DEPOSIT_DETECTED → SF → PE+AN agents → AssemblePacket →
  //       RECOMMENDATION_PROPOSED → compliance-ctrl → DECISION_APPROVED).
  //
  // To unblock this test: add agent-mock infrastructure (test-side mocking of
  // PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED to fake the PE+AN agent responses
  // so the SF never calls out to AgentCore). Filed as a queued backlog item.
  it.skip('DEPOSIT_DETECTED → RECOMMENDATION_PROPOSED carries portfolioValueCents + isInitialBuild + riskCategory', async () => {
    const mandateId = `integ-mandate-pkt-${Date.now()}`;
    const depositId = `integ-deposit-pkt-${Date.now()}`;
    const amountCents = 100_000; // $1 000.00

    // ── Step 1: Project MandateSnapshot so the SF can resolve operatingMode ──
    //
    // Emit MANDATE_ISSUED → mandate-projector.ts writes MandateSnapshot row →
    // CDC emits MANDATE_SNAPSHOT_CREATED → SF Orchestration trigger fires
    // (but only AFTER DEPOSIT_DETECTED below, since we want that to be the
    // trigger). We seed the mandate first so it's available when the SF
    // executes LookupMandateSnapshot during the DEPOSIT_DETECTED-triggered run.
    //
    // NOTE: ctx.userId (not a per-test userId) is required because the SF's
    // UnpackTriggerEnvelope reads $.context.userId, which the EB envelope
    // helper hardcodes to ctx.userId. Per-test uniqueness comes from
    // mandateId/depositId and the match predicate's portfolioValueCents
    // discriminator.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'BALANCED',
        effectiveDate: new Date().toISOString(),
      },
    });

    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MandateSnapshot#${ctx.tenantId}#${ctx.userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 30_000,
    });

    // ── Step 2: Seed InvestorProfileSnapshot via the projector event path ──
    //
    // Publishing INVESTOR_PROFILE_SNAPSHOT_CREATED exercises:
    //   - snapshot-projector.ts: agentOutput → JSON.stringify (Task 1 fix)
    //   - SF ExtractInvestorProfileSnapshot Pass: States.StringToJson (Task 2)
    //   - AssemblePacket: riskCategory hoisted from agentOutput (Task 3)
    //
    // We do NOT write the DDB row directly — that would bypass the
    // JSON.stringify fix and make the Task 1 change invisible to this test.
    const ipAgentOutput = { riskCategory: 'MODERATE', riskScore: 50 };

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentOutput: ipAgentOutput,
        sourceEventId: `integ-ip-src-${Date.now()}`,
        sourceEventType: 'INVESTOR_PROFILE_UPDATED',
      },
    });

    // Wait for the row to land (confirms snapshot-projector ran before the
    // trigger event races ahead of the SF's LookupInvestorProfileSnapshot).
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${ctx.userId}`,
      sk: 'InvestorProfileSnapshot',
      timeoutMs: 60_000,
    });

    // ── Step 3: Emit DEPOSIT_DETECTED with amountCents (new field — Task 3) ──
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        amountCents,
        currency: 'USD',
      },
    });

    // ── Step 4: Assert RECOMMENDATION_PROPOSED output shape ──
    //
    // The full advisory pipeline (PE agent + AN agent via waitForTaskToken)
    // must complete before AssemblePacket emits this event. Budget: 240s.
    const evt = await trap.waitForEvent<{
      subject: {
        portfolioValueCents: number;
        isInitialBuild: boolean;
        riskCategory: string;
        proposedTrades: Array<{
          quantityOrAmountCents: number;
          targetWeightPercent: number;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };
    }>({
      detailType: 'RECOMMENDATION_PROPOSED',
      match: (detail) => {
        const s = detail.subject as {
          userId?: string;
          portfolioValueCents?: number;
        };
        return s?.userId === ctx.userId && s?.portfolioValueCents === amountCents;
      },
      timeoutMs: 240_000,
    });

    // Canonical cents — NOT the legacy dollars float
    expect(evt.detail.subject.portfolioValueCents).toBe(amountCents);

    // isInitialBuild=true because the seeded snapshot carries no currentPositions
    expect(evt.detail.subject.isInitialBuild).toBe(true);

    // riskCategory propagated from the InvestorProfileSnapshot agentOutput
    expect(evt.detail.subject.riskCategory).toBe('MODERATE');

    // Proposed trade quantities are canonical cents (not basis-points)
    const firstTrade = evt.detail.subject.proposedTrades[0];
    expect(firstTrade).toBeDefined();
    expect(firstTrade.quantityOrAmountCents).toBe(
      Math.round((firstTrade.targetWeightPercent / 100) * amountCents),
    );

    // ── Step 5: Negative assertions — legacy fields must be absent ────────────
    expect(evt.detail.subject).not.toHaveProperty('portfolioValue');
    expect(evt.detail.subject).not.toHaveProperty('riskScore');
  }, 240_000);
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
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        id: `integ-port-${Date.now()}`,
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
            cashBalanceCents: 500_000,
            lastEventSequence: 1,
          },
        },
        context: {
          tenantId: ctx.tenantId,
          userId: ctx.tenantId,
          region: 'us-east-1',
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
        id: `integ-port-seq5-${Date.now()}`,
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: { VTI: { quantity: 5, lastFillPrice: 200 } },
            cashBalanceCents: 300_000,
            lastEventSequence: 5,
          },
        },
        context: {
          tenantId: ctx.tenantId,
          userId: ctx.tenantId,
          region: 'us-east-1',
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
        id: `integ-port-seq7-${Date.now()}`,
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: { VTI: { quantity: 7, lastFillPrice: 210 } },
            cashBalanceCents: 800_000,
            lastEventSequence: 7,
          },
        },
        context: {
          tenantId: ctx.tenantId,
          userId: ctx.tenantId,
          region: 'us-east-1',
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

// ── SF reads LedgerSnapshot → AssemblePacket payload (workstream ferry-ledger-positions-to-advisory) ──
//
// Verifies the end-to-end chain:
//   1. PORTFOLIO_UPDATED → SnapshotProjectorIngress writes LedgerSnapshot row.
//   2. PORTFOLIO_DRIFT_DETECTED → SF starts, Branch C (LookupLedgerSnapshot) reads
//      the row, ExtractLedgerSnapshot parses positions, AssembleDecisionPacket Lambda
//      receives ledgerSnapshot with populated positions + cashBalanceCents.
//   3. The SF emits RECOMMENDATION_PROPOSED (via WaitForCompliance CDC) carrying
//      subject.currentPositions derived from the LedgerSnapshot.
//
// NOTE: AssemblePacket returns currentPositions to the SF state (ResultSelector) but
// does NOT persist them to the DDB DecisionPacket row — currentPositions lives in SF
// state, not in DDB. Assertion therefore reads from the RECOMMENDATION_PROPOSED CDC
// event captured by the trap.
//
// NOTE: This test WILL FAIL against dev until Task 19's deploy (SnapshotProjectorIngress
// PORTFOLIO_UPDATED subscription + SF Branch C wiring). It also requires the full
// advisory pipeline (PE + AN agents, ~120s each) to produce RECOMMENDATION_PROPOSED.
// The AgentCore maxVms quota saturation issue applies here too — see existing skip note
// above on the packet-shape contract test.

describe('SF reads ledgerSnapshot into AssemblePacket payload', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Arm trap for RECOMMENDATION_PROPOSED — this carries currentPositions from
    // SF state (populated by AssemblePacket from the LedgerSnapshot lookup).
    await trap.deploy({
      bus: 'advisory',
      detailType: ['RECOMMENDATION_PROPOSED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('SF threads ledgerSnapshot into AssemblePacket — RECOMMENDATION_PROPOSED carries currentPositions', async () => {
    const portfolioId = `integ-ledger-drift-${Date.now()}`;
    const mandateId = `integ-mandate-ledger-${Date.now()}`;

    // ── Step 1: Seed MandateSnapshot so SF can resolve operatingMode ──
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'BALANCED',
        effectiveDate: new Date().toISOString(),
      },
    });
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MandateSnapshot#${ctx.tenantId}#${ctx.userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 30_000,
    });

    // ── Step 2: Seed LedgerSnapshot via PORTFOLIO_UPDATED ──
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        id: `integ-port-drift-${Date.now()}`,
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
            cashBalanceCents: 50_000,
            lastEventSequence: 3,
          },
        },
        context: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          region: 'us-east-1',
        },
      },
    });

    // Wait for LedgerSnapshot projection to land before triggering the SF —
    // Branch C's DDB GetItem must find the row to exercise the hit path.
    await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `LedgerSnapshot#${ctx.tenantId}`,
      sk: 'LedgerSnapshot',
      timeoutMs: 60_000,
    });

    // ── Step 3: Emit PORTFOLIO_DRIFT_DETECTED to start the SF ──
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        portfolioId,
        tenantId: ctx.tenantId,
        driftPercentage: 0.12,
        driftDirection: 'OVERWEIGHT_EQUITY',
        detectedAt: new Date().toISOString(),
      },
    });

    // ── Step 4: Assert RECOMMENDATION_PROPOSED carries currentPositions from LedgerSnapshot ──
    //
    // AssemblePacket maps LedgerSnapshot.positions → currentPositions (symbols with quantity>0).
    // The SF propagates currentPositions from the AssembleDecisionPacket ResultSelector into the
    // WaitForCompliance putEvents payload (subject.currentPositions).
    // Budget: 240s for the full advisory pipeline (PE 120s + AN 120s).
    const evt = await trap.waitForEvent<{
      subject: {
        currentPositions: Array<{ symbol: string; quantity: number; marketValueCents: number }>;
        isInitialBuild: boolean;
        [key: string]: unknown;
      };
    }>({
      detailType: 'RECOMMENDATION_PROPOSED',
      match: (detail) => {
        const s = detail.subject as { userId?: string };
        return s?.userId === ctx.userId;
      },
      timeoutMs: 240_000,
    });

    // currentPositions must contain the VTI position from the seeded LedgerSnapshot
    const vtiPosition = evt.detail.subject.currentPositions.find(
      (p) => p.symbol === 'VTI',
    );
    expect(vtiPosition).toBeDefined();
    expect(vtiPosition!.quantity).toBe(10);
    // isInitialBuild=false because currentPositions is non-empty
    expect(evt.detail.subject.isInitialBuild).toBe(false);
  }, 300_000);
});
