import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('compliance-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Trap CDC output events — ComplianceCheck insert dispatches DECISION_APPROVED or DECISION_BLOCKED
    await trap.deploy({
      bus: 'advisory',
      detailType: ['DECISION_APPROVED', 'DECISION_BLOCKED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Recommendation Proposed (taskToken propagation) ────────────────

  it('should emit DECISION_APPROVED or DECISION_BLOCKED on RECOMMENDATION_PROPOSED with taskToken propagated to subject', async () => {
    const decisionId = `integ-decision-created-${Date.now()}`;
    const taskToken = `integ-task-token-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        taskToken,
        awaitingCompliance: true,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150.0 },
        ],
        portfolioValue: 50000,
        riskScore: 5,
        currentPositions: [
          { symbol: 'AAPL', quantity: 5, value: 750.0 },
        ],
      },
    });

    // Regression: taskToken on RECOMMENDATION_PROPOSED must round-trip through
    // ComplianceCheck row → CDC subject on DECISION_APPROVED|BLOCKED so the SF
    // callback Lambda can call SendTaskSuccess. Without this round-trip the
    // decision-workflow-ctrl state machine remains stuck at WaitForCompliance.
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;
    expect(subject['taskToken']).toBe(taskToken);
  }, 120_000);

  // ── Mandate Created (compliance rules projection) ─────────────────

  it('should write MandateSnapshot to DDB on MANDATE_CREATED', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 25,
        maxSingleTradePercent: 10,
        equityRiskBandPercent: 6,
        driftTriggerPercent: 4,
        singleEtfConcentrationPercent: 30,
        drawdownCircuitBreakerPercent: 12,
        effectiveDate: '2026-01-15T00:00:00.000Z',
        revokedAt: null,
      },
    });

    // Assert: MandateSnapshot projected into DDB
    // pk = GuardrailPolicy#{tenantId}#{userId}, sk = MandateSnapshot
    // userId falls back to tenantId when not provided in subject
    const item = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
    });

    expect(item['mandateId']).toBe(mandateId);
    expect(item['level']).toBe('DISCRETIONARY');
    expect(item['monthlyTurnoverCapPercent']).toBe(25);
    expect(item['maxSingleTradePercent']).toBe(10);
    expect(item['equityRiskBandPercent']).toBe(6);
    expect(item['driftTriggerPercent']).toBe(4);
    expect(item['singleEtfConcentrationPercent']).toBe(30);
    expect(item['drawdownCircuitBreakerPercent']).toBe(12);
  }, 120_000);

  // ── Authority Resolution ────────────────────────────────────────────

  it('should resolve L1 authority for DISCRETIONARY+BALANCED when trade is within thresholds', async () => {
    const mandateId = `integ-mandate-balanced-${Date.now()}`;

    // Seed MandateSnapshot with BALANCED params (maxSingleTradePercent=10)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 25,
        maxSingleTradePercent: 10,
        equityRiskBandPercent: 6,
        driftTriggerPercent: 4,
        singleEtfConcentrationPercent: 30,
        drawdownCircuitBreakerPercent: 12,
        effectiveDate: '2026-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });

    // Wait for MandateSnapshot to be projected
    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
    });

    const decisionId = `integ-authority-balanced-${Date.now()}`;

    // Send RECOMMENDATION_PROPOSED with a 6% trade (within BALANCED 10% limit)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        taskToken: `integ-task-token-${decisionId}`,
        awaitingCompliance: true,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 6000,
            targetWeightPercent: 5,
            rationale: 'Integration test trade',
          },
        ],
        portfolioValue: 100000,
        riskScore: 7,
        currentPositions: [
          { ticker: 'AAPL', weight: 10 },
        ],
      },
    });

    // Wait for ComplianceCheck CDC output
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('DECISION_APPROVED');

    // Verify ComplianceCheck record has authorityLevel L1
    // pk = ComplianceCheck#{tenantId}#{eventId} — but eventId is generated by event-processor.
    // Instead, query by detailType from the trap event to confirm L1.
    // The CDC event detail.subject should contain the authorityLevel.
    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;
    expect(subject['authorityLevel']).toBe('L1');
  }, 180_000);

  it('should resolve L2 authority for DISCRETIONARY+CONSERVATIVE when trade exceeds threshold', async () => {
    const mandateId = `integ-mandate-conservative-${Date.now()}`;

    // Seed MandateSnapshot with CONSERVATIVE params (maxSingleTradePercent=5)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        equityRiskBandPercent: 4,
        driftTriggerPercent: 2,
        singleEtfConcentrationPercent: 20,
        drawdownCircuitBreakerPercent: 8,
        effectiveDate: '2026-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });

    // Wait for MandateSnapshot to be projected (overwrite previous)
    let snapshot: Record<string, unknown> | undefined;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      snapshot = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      if (snapshot['mandateId'] === mandateId) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(snapshot!['mandateId']).toBe(mandateId);

    const decisionId = `integ-authority-conservative-${Date.now()}`;

    // Send same 6% trade — exceeds CONSERVATIVE 5% maxSingleTradePercent
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        taskToken: `integ-task-token-${decisionId}`,
        awaitingCompliance: true,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 6000,
            targetWeightPercent: 5,
            rationale: 'Integration test trade',
          },
        ],
        portfolioValue: 100000,
        riskScore: 7,
        currentPositions: [
          { ticker: 'AAPL', weight: 10 },
        ],
      },
    });

    // Wait for ComplianceCheck CDC output — BLOCKED because trade exceeds guardrail
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('DECISION_BLOCKED');

    // Verify ComplianceCheck record has authorityLevel L2
    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;
    expect(subject['authorityLevel']).toBe('L2');
  }, 180_000);
});
