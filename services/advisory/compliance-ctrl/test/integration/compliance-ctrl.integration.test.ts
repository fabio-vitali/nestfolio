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

  // ── InvestorProfile composite events (compliance rules projection) ────
  // Phase 3 of the InvestorProfile collapse replaced the legacy
  // MANDATE_CREATED/UPDATED/OPERATING_MODE_CHANGED fan-out with a single
  // composite INVESTOR_PROFILE_CREATED|UPDATED carrying mandate + goal +
  // riskProfile + operatingMode in subject.

  it('should project MandateSnapshot from INVESTOR_PROFILE_CREATED composite payload', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
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
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
      },
    });

    // Assert: MandateSnapshot projected into DDB
    // pk = GuardrailPolicy#{tenantId}#{userId}, sk = MandateSnapshot
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
    // Initial projection sets the lifecycle status to ACTIVE (Phase 3).
    expect(item['status']).toBe('ACTIVE');
  }, 120_000);

  it('should update MandateSnapshot from INVESTOR_PROFILE_UPDATED composite payload', async () => {
    const mandateId = `integ-mandate-updated-${Date.now()}`;

    // Seed via INVESTOR_PROFILE_CREATED first
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
          mandateId,
          level: 'ADVISORY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          equityRiskBandPercent: 4,
          driftTriggerPercent: 2,
          singleEtfConcentrationPercent: 20,
          drawdownCircuitBreakerPercent: 8,
          effectiveDate: '2026-01-15T00:00:00.000Z',
          revokedAt: null,
        },
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 3, band: 'CONSERVATIVE' },
        operatingMode: 'CONSERVATIVE',
      },
    });

    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
    });

    // Now emit INVESTOR_PROFILE_UPDATED with broadened guardrails
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
          mandateId,
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 40,
          maxSingleTradePercent: 20,
          equityRiskBandPercent: 10,
          driftTriggerPercent: 6,
          singleEtfConcentrationPercent: 35,
          drawdownCircuitBreakerPercent: 15,
          effectiveDate: '2026-01-15T00:00:00.000Z',
          revokedAt: null,
        },
        goal: { type: 'WEALTH_GROWTH', horizonYears: 30 },
        riskProfile: { score: 8, band: 'AGGRESSIVE' },
        operatingMode: 'AGGRESSIVE',
      },
    });

    // Poll until the projection reflects the updated values
    let updated: Record<string, unknown> | undefined;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      updated = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      if (updated['level'] === 'DISCRETIONARY' && updated['maxSingleTradePercent'] === 20) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }

    expect(updated!['mandateId']).toBe(mandateId);
    expect(updated!['level']).toBe('DISCRETIONARY');
    expect(updated!['monthlyTurnoverCapPercent']).toBe(40);
    expect(updated!['maxSingleTradePercent']).toBe(20);
    expect(updated!['equityRiskBandPercent']).toBe(10);
    expect(updated!['driftTriggerPercent']).toBe(6);
    expect(updated!['singleEtfConcentrationPercent']).toBe(35);
    expect(updated!['drawdownCircuitBreakerPercent']).toBe(15);
    expect(updated!['status']).toBe('ACTIVE');
  }, 180_000);

  // ── MANDATE_REVOKED projection ────────────────────────────────────────
  it('should set MandateSnapshot.status=REVOKED on MANDATE_REVOKED event', async () => {
    const mandateId = `integ-mandate-revoke-${Date.now()}`;
    const revokedAt = '2026-05-03T10:00:00.000Z';

    // 1. Seed MandateSnapshot via INVESTOR_PROFILE_CREATED (status=ACTIVE)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
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
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
      },
    });

    // Wait for ACTIVE seed
    let seeded: Record<string, unknown> | undefined;
    const seedDeadline = Date.now() + 60_000;
    while (Date.now() < seedDeadline) {
      seeded = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      if (seeded['mandateId'] === mandateId && seeded['status'] === 'ACTIVE') break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(seeded!['mandateId']).toBe(mandateId);
    expect(seeded!['status']).toBe('ACTIVE');

    // 2. Emit MANDATE_REVOKED
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_REVOKED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        revokedAt,
      },
    });

    // 3. Poll for status=REVOKED
    let revoked: Record<string, unknown> | undefined;
    const revokeDeadline = Date.now() + 60_000;
    while (Date.now() < revokeDeadline) {
      revoked = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${ctx.tenantId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      if (revoked['status'] === 'REVOKED') break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(revoked!['status']).toBe('REVOKED');
    expect(revoked!['revokedAt']).toBe(revokedAt);
  }, 240_000);

  // ── REVOKED-blocks-cycle (rule engine gate) ──────────────────────────
  it('should return DECISION_BLOCKED with MANDATE_SCOPE violation on RECOMMENDATION_PROPOSED when MandateSnapshot.status=REVOKED', async () => {
    // Per-test unique userId — isolates this scenario's MandateSnapshot from
    // late-arriving lambda invocations of other tests' INVESTOR_PROFILE_CREATED
    // (which would project the row back to ACTIVE and break the REVOKED gate).
    const userId = `integ-user-revoked-${Date.now()}`;
    const mandateId = `integ-mandate-revoked-block-${Date.now()}`;
    const revokedAt = '2026-05-03T11:00:00.000Z';
    const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

    // Seed ACTIVE snapshot
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandate: {
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
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
      },
    });

    // Wait for ACTIVE — try/catch swallows the inner waitForItem timeout so
    // jest.retryTimes(1) doesn't double-fire the seed/revoke pair.
    let seeded: Record<string, unknown> | undefined;
    const seedDeadline = Date.now() + 90_000;
    while (Date.now() < seedDeadline) {
      try {
        seeded = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: policyPk,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (seeded['mandateId'] === mandateId && seeded['status'] === 'ACTIVE') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!seeded || seeded['status'] !== 'ACTIVE') {
      throw new Error(`MandateSnapshot did not reach ACTIVE for ${policyPk} within 90s`);
    }

    // Revoke
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_REVOKED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        revokedAt,
      },
    });

    // Wait for REVOKED
    let revoked: Record<string, unknown> | undefined;
    const revokeDeadline = Date.now() + 90_000;
    while (Date.now() < revokeDeadline) {
      try {
        revoked = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: policyPk,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (revoked['status'] === 'REVOKED') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(revoked!['status']).toBe('REVOKED');

    // Now run a decision cycle — must be BLOCKED with MANDATE_SCOPE violation
    const decisionId = `integ-decision-revoked-${Date.now()}`;
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        // Pin userId so processDecisionPacket reads the same MandateSnapshot
        // pk this test seeded above — otherwise it falls back to
        // ctx.tenantId and misses the per-test row.
        tenantId: ctx.tenantId,
        userId,
        taskToken: `integ-task-token-${decisionId}`,
        awaitingCompliance: true,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 1_000_00, // tiny — would normally pass
            targetWeightPercent: 1,
            rationale: 'Small buy under revoked mandate',
          },
        ],
        portfolioValue: 100000,
        riskScore: 5,
        currentPositions: [{ ticker: 'AAPL', weight: 5 }],
      },
    });

    const event = await trap.waitForEvent({
      detailType: 'DECISION_BLOCKED',
      match: (d) => {
        const subject = (d as Record<string, unknown>).subject as Record<string, unknown>;
        return subject?.['decisionPacketId'] === decisionId;
      },
      timeoutMs: 120_000,
    });
    expect(event.detailType).toBe('DECISION_BLOCKED');

    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;

    // RuleEngine wraps the failed mandate-validator check (name=MANDATE_REVOKED)
    // as a violation with rule=MANDATE_SCOPE + severity=BLOCKING.
    const violations = subject['violations'] as Array<Record<string, unknown>> | undefined;
    expect(violations).toBeDefined();
    expect(violations!.some((v) => v['rule'] === 'MANDATE_SCOPE')).toBe(true);

    // Authority resolver forces L2 on REVOKED.
    expect(subject['authorityLevel']).toBe('L2');
  }, 300_000);

  // ── Authority Resolution ────────────────────────────────────────────

  it('should resolve L1 authority for DISCRETIONARY+BALANCED when trade is within thresholds', async () => {
    const mandateId = `integ-mandate-balanced-${Date.now()}`;

    // Seed MandateSnapshot with BALANCED params (maxSingleTradePercent=10)
    // via composite INVESTOR_PROFILE_CREATED event (Phase 3 collapse).
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
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
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
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
    // via composite INVESTOR_PROFILE_CREATED event (Phase 3 collapse).
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        mandate: {
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
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 3, band: 'CONSERVATIVE' },
        operatingMode: 'CONSERVATIVE',
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
