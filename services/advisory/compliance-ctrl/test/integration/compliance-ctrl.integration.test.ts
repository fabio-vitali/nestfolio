import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('compliance-ctrl', () => {
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
      subject: {
        decisionId,
        taskToken,
        awaitingCompliance: true,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150.0 },
        ],
        portfolioValueCents: 50000,
        riskCategory: 'MODERATE',
        isInitialBuild: false,
        currentPositions: [
          { symbol: 'AAPL', quantity: 5, value: 750.0 },
        ],
      },
    });

    // Regression: taskToken on RECOMMENDATION_PROPOSED must round-trip through
    // ComplianceCheck row → CDC subject on DECISION_APPROVED|BLOCKED so the SF
    // callback Lambda can call SendTaskSuccess. Without this round-trip the
    // decision-workflow-ctrl state machine remains stuck at WaitForCompliance.
    const event = await trap.waitForEvent({ timeoutMs: 30_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;
    expect(subject['taskToken']).toBe(taskToken);
    // WS-1: proposedTrades must round-trip onto the DECISION_APPROVED/BLOCKED subject
    expect(Array.isArray(subject['proposedTrades'])).toBe(true);
    expect((subject['proposedTrades'] as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);

  // ── Mandate lifecycle events (compliance rules projection) ────────────
  // Post-resplit: INVESTOR_PROFILE_CREATED/UPDATED no longer feed compliance-ctrl.
  // The handler now subscribes to three semantic mandate events:
  //   MANDATE_ISSUED         → projects a fresh MandateSnapshot {mandateId, level, status:'ACTIVE', operatingMode, effectiveDate}
  //   OPERATING_MODE_CHANGED → patches operatingMode on the existing snapshot
  //   MANDATE_REVOKED        → patches status='REVOKED' + revokedAt
  // Numeric guardrail thresholds (maxSingleTradePercent etc.) are no longer
  // stored on the row — GuardrailEvaluator derives them at evaluation time
  // from operatingMode via resolveGuardrailParams (guardrail-params.ts).

  it('should project MandateSnapshot from MANDATE_ISSUED event', async () => {
    // Per-test unique userId — isolates the row so prior runs cannot pollute
    // it (the REVOKED-gate test below leaves `status: REVOKED`, and the
    // MANDATE_ISSUED handler's ConditionExpression skips re-init when REVOKED
    // is set, so a shared row would cause this test to read a stale REVOKED row).
    const userId = `integ-user-create-${Date.now()}`;
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    // Poll for THIS test's mandateId — handler may run multiple times if the
    // SQS Lambda redelivers, but each carries the same mandateId so the
    // assertion is stable.
    const item = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 90_000,
      match: { mandateId },
    });

    expect(item['mandateId']).toBe(mandateId);
    expect(item['level']).toBe('DISCRETIONARY');
    expect(item['operatingMode']).toBe('BALANCED');
    expect(item['effectiveDate']).toBe('2026-01-15T00:00:00.000Z');
    // MANDATE_ISSUED sets status='ACTIVE' directly (no separate REVOKED handler needed
    // to initialize the row — the REVOKED condition protects against late redeliveries).
    expect(item['status']).toBe('ACTIVE');
  }, 120_000);

  it('should patch MandateSnapshot.operatingMode on OPERATING_MODE_CHANGED event', async () => {
    const userId = `integ-user-update-${Date.now()}`;
    const mandateId = `integ-mandate-updated-${Date.now()}`;

    // Seed via MANDATE_ISSUED first (CONSERVATIVE operating mode)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'ADVISORY',
        status: 'ACTIVE',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
      match: { mandateId, operatingMode: 'CONSERVATIVE' },
    });

    // Now emit OPERATING_MODE_CHANGED — full image at __version:2 so projectVersioned version guard accepts it
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'OPERATING_MODE_CHANGED',
      subject: {
        mandateId,
        level: 'ADVISORY',
        status: 'ACTIVE',
        operatingMode: 'AGGRESSIVE',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 2,
      },
      context: { userId },
    });

    // Poll until the projection reflects the updated operatingMode
    const updated = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
      match: { operatingMode: 'AGGRESSIVE' },
    });

    expect(updated['mandateId']).toBe(mandateId);
    // level is unchanged — OPERATING_MODE_CHANGED only patches operatingMode
    expect(updated!['level']).toBe('ADVISORY');
    expect(updated!['operatingMode']).toBe('AGGRESSIVE');
    // status field untouched by OPERATING_MODE_CHANGED
    expect(updated!['status']).toBe('ACTIVE');
  }, 180_000);

  // ── MANDATE_REVOKED projection ────────────────────────────────────────
  it('should set MandateSnapshot.status=REVOKED on MANDATE_REVOKED event', async () => {
    const userId = `integ-user-revoke-event-${Date.now()}`;
    const mandateId = `integ-mandate-revoke-${Date.now()}`;
    const revokedAt = '2026-05-03T10:00:00.000Z';

    // 1. Seed MandateSnapshot via MANDATE_ISSUED.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    // Wait for the row to land — MANDATE_ISSUED projection sets status='ACTIVE'.
    const seeded = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
      match: { mandateId },
    });
    expect(seeded['mandateId']).toBe(mandateId);
    expect(seeded['status']).toBe('ACTIVE');

    // 2. Emit MANDATE_REVOKED — full image at __version:2 so projectVersioned version guard accepts it
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_REVOKED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'REVOKED',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        revokedAt,
        __version: 2,
      },
      context: { userId },
    });

    // 3. Poll for status=REVOKED
    const revoked = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 60_000,
      match: { status: 'REVOKED' },
    });
    expect(revoked['status']).toBe('REVOKED');
    expect(revoked['revokedAt']).toBe(revokedAt);
    // Critical: MANDATE_REVOKED must patch only status + revokedAt,
    // leaving mandate fields (mandateId, level, operatingMode, effectiveDate)
    // projected from MANDATE_ISSUED intact for downstream rule evaluation.
    expect(revoked['mandateId']).toBe(mandateId);
    expect(revoked['level']).toBe('DISCRETIONARY');
    expect(revoked['operatingMode']).toBe('BALANCED');
  }, 240_000);

  // ── REVOKED-blocks-cycle (rule engine gate) ──────────────────────────
  it('should return DECISION_BLOCKED with MANDATE_SCOPE violation on RECOMMENDATION_PROPOSED when MandateSnapshot.status=REVOKED', async () => {
    // Per-test unique userId — isolates this scenario's MandateSnapshot from
    // late-arriving lambda invocations of other tests' MANDATE_ISSUED events
    // (which would project the row back to ACTIVE and break the REVOKED gate).
    const userId = `integ-user-revoked-${Date.now()}`;
    const mandateId = `integ-mandate-revoked-block-${Date.now()}`;
    const revokedAt = '2026-05-03T11:00:00.000Z';
    const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

    // Seed ACTIVE snapshot via MANDATE_ISSUED
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    // Wait for the seed to land — MANDATE_ISSUED sets status='ACTIVE'.
    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: policyPk,
      sk: 'MandateSnapshot',
      timeoutMs: 90_000,
      predicate: (i) => i['mandateId'] === mandateId && i['status'] !== 'REVOKED',
      description: `mandateId=${mandateId} with status≠REVOKED`,
    });

    // Revoke — full image at __version:2 so projectVersioned version guard accepts it
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_REVOKED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'REVOKED',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
        revokedAt,
        __version: 2,
      },
      context: { userId },
    });

    // Wait for REVOKED
    const revoked = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: policyPk,
      sk: 'MandateSnapshot',
      timeoutMs: 90_000,
      match: { status: 'REVOKED' },
    });
    expect(revoked['status']).toBe('REVOKED');

    // Now run a decision cycle — must be BLOCKED with MANDATE_SCOPE violation
    const decisionId = `integ-decision-revoked-${Date.now()}`;
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      subject: {
        decisionId,
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
        portfolioValueCents: 100000,
        riskCategory: 'MODERATE',
        isInitialBuild: false,
        currentPositions: [{ ticker: 'AAPL', weight: 5 }],
      },
      // Pin userId so processDecisionPacket reads the same MandateSnapshot
      // pk this test seeded above — identity now travels in context.
      context: { userId },
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
  // Guardrail thresholds are now derived at evaluation time from operatingMode
  // via resolveGuardrailParams (guardrail-params.ts). BALANCED mode:
  //   maxSingleTradePercent=10, monthlyTurnoverCapPercent=25
  // CONSERVATIVE mode: maxSingleTradePercent=5, monthlyTurnoverCapPercent=10
  // Seed the MandateSnapshot via MANDATE_ISSUED; the RECOMMENDATION_PROPOSED
  // trade size is calibrated to the mode-derived threshold.

  it('should resolve L1 authority for DISCRETIONARY+BALANCED when trade is within thresholds', async () => {
    // Per-test unique userId — isolates this scenario's MandateSnapshot pk
    // from out-of-order lambda invocations of other tests' MANDATE_ISSUED
    // events (which would overwrite a shared row mid-test).
    const userId = `integ-user-balanced-${Date.now()}`;
    const mandateId = `integ-mandate-balanced-${Date.now()}`;
    const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

    // BALANCED mode — maxSingleTradePercent=10 (from guardrail-params.ts)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-01T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    // Wait for THIS test's mandateId to land.
    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: policyPk,
      sk: 'MandateSnapshot',
      timeoutMs: 90_000,
      match: { mandateId },
    });

    const decisionId = `integ-authority-balanced-${Date.now()}`;

    // Send RECOMMENDATION_PROPOSED with a 6% trade (within BALANCED 10% limit
    // → 6000 cents on 100000 portfolio = 6%). Guardrails derived from operatingMode.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      subject: {
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
        portfolioValueCents: 100000,
        riskCategory: 'AGGRESSIVE',
        isInitialBuild: false,
        currentPositions: [
          { ticker: 'AAPL', weight: 10 },
        ],
      },
      // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
      context: { userId },
    });

    // Match the trap event by detailType + decisionPacketId. The detailType
    // filter is required because the trap rule fires on both DECISION_APPROVED
    // and DECISION_BLOCKED, and prior tests' DECISION_BLOCKED frames may sit
    // in the buffer; without the type narrow, a buffered non-matching event
    // could starve the predicate-only loop of fresh-fetch attempts.
    const event = await trap.waitForEvent({
      detailType: 'DECISION_APPROVED',
      match: (d) => {
        const subject = (d as Record<string, unknown>).subject as Record<string, unknown>;
        return subject?.['decisionPacketId'] === decisionId;
      },
      timeoutMs: 120_000,
    });
    expect(event.detailType).toBe('DECISION_APPROVED');
    const detail = event.detail as Record<string, unknown>;
    const subject = detail.subject as Record<string, unknown>;
    expect(subject['authorityLevel']).toBe('L1');
  }, 300_000);

  it('should resolve L2 authority for DISCRETIONARY+CONSERVATIVE when trade exceeds threshold', async () => {
    const userId = `integ-user-conservative-${Date.now()}`;
    const mandateId = `integ-mandate-conservative-${Date.now()}`;
    const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

    // CONSERVATIVE mode — maxSingleTradePercent=5 (from guardrail-params.ts)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: {
        mandateId,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: '2026-01-01T00:00:00.000Z',
        __version: 1,
      },
      context: { userId },
    });

    await table.waitForItem({
      table: 'compliance-ctrl',
      pk: policyPk,
      sk: 'MandateSnapshot',
      timeoutMs: 90_000,
      match: { mandateId },
    });

    const decisionId = `integ-authority-conservative-${Date.now()}`;

    // 6% trade (6000 cents on 100000) exceeds CONSERVATIVE 5% maxSingleTradePercent → L2 + BLOCKED.
    // Threshold is derived from operatingMode='CONSERVATIVE' at rule-evaluation time.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      subject: {
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
        portfolioValueCents: 100000,
        riskCategory: 'AGGRESSIVE',
        isInitialBuild: false,
        currentPositions: [
          { ticker: 'AAPL', weight: 10 },
        ],
      },
      // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
      context: { userId },
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
    expect(subject['authorityLevel']).toBe('L2');
  }, 300_000);

  // ── Units calibration regression (workstream 2026-05-25) ─────────────
  // These two cases prove the fix shipped in this workstream:
  //   1. isInitialBuild=true skips MAX_SINGLE_TRADE + TURNOVER_CAP so a full
  //      initial portfolio allocation passes even though individual trades
  //      exceed the per-trade cap.
  //   2. isInitialBuild=false with a 25%-of-portfolio trade (25_000 cents) is
  //      correctly BLOCKED on MAX_SINGLE_TRADE — under the pre-fix bug the rule
  //      engine read portfolioValue (old field) as 0 so 25_000 cents was
  //      interpreted as 2500% of $0, but the division guard returned 0 and
  //      silently passed; with portfolioValueCents the math is correct and the
  //      cap fires at 10% of 100_000 = 10_000 cents.

  describe('decision-pipeline-units-calibration-suitability (workstream 2026-05-25)', () => {
    it('isInitialBuild=true, ADVISORY+BALANCED, BND@27 + 55% equity → DECISION_APPROVED (L2)', async () => {
      // Per-test unique userId — isolates this scenario's MandateSnapshot pk from
      // other concurrent tests that emit MANDATE_ISSUED against the same tenantId.
      const userId = `integ-user-initbuild-${Date.now()}`;
      const mandateId = `integ-mandate-initbuild-${Date.now()}`;
      const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

      // Seed MandateSnapshot via MANDATE_ISSUED with level=ADVISORY so
      // AuthorityResolver returns L2 regardless of trade size.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        subject: {
          mandateId,
          level: 'ADVISORY',
          status: 'ACTIVE',
          operatingMode: 'BALANCED',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          __version: 1,
        },
        context: { userId },
      });

      // Wait for the compliance-ctrl MandateSnapshot row to land.
      // pk=GuardrailPolicy#tenantId#userId, sk=MandateSnapshot (confirmed from
      // the MANDATE_ISSUED projection tests above).
      await table.waitForItem({
        table: 'compliance-ctrl',
        pk: policyPk,
        sk: 'MandateSnapshot',
        timeoutMs: 90_000,
        match: { mandateId },
      });

      // Unique decisionId — match predicate below filters on subject.decisionPacketId
      // so stale DECISION_APPROVED/BLOCKED frames from concurrent tests don't
      // trigger a false positive.
      const decisionId = `integ-initbuild-${Date.now()}`;

      // Full initial portfolio: 6 trades totalling 100% of portfolio.
      // Equity: VTI(14) + IXUS(14) + QQQ(14) + VWO(13) = 55%.
      // MODERATE suitability cap = 60%; 55% < 60% → SUITABILITY passes.
      // Fixed income: BND(27) + SHY(18) = 45%.
      // isInitialBuild=true → MAX_SINGLE_TRADE and TURNOVER_CAP both skip.
      // ADVISORY mandate → L2. No blocking violations → DECISION_APPROVED.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'RECOMMENDATION_PROPOSED',
        subject: {
          decisionId,
          taskToken: `integ-task-token-${decisionId}`,
          awaitingCompliance: true,
          proposedTrades: [
            { symbol: 'VTI',  assetClass: 'EQUITY',        side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'Initial build' },
            { symbol: 'IXUS', assetClass: 'EQUITY',        side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'Initial build' },
            { symbol: 'QQQ',  assetClass: 'EQUITY',        side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'Initial build' },
            { symbol: 'VWO',  assetClass: 'EQUITY',        side: 'BUY', quantityOrAmountCents: 13_000, targetWeightPercent: 13, rationale: 'Initial build' },
            { symbol: 'BND',  assetClass: 'FIXED_INCOME',  side: 'BUY', quantityOrAmountCents: 27_000, targetWeightPercent: 27, rationale: 'Initial build' },
            { symbol: 'SHY',  assetClass: 'FIXED_INCOME',  side: 'BUY', quantityOrAmountCents: 18_000, targetWeightPercent: 18, rationale: 'Initial build' },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: true,
          currentPositions: [],
        },
        // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
        context: { userId },
      });

      // Match on decisionPacketId — the CDC subject carries this from the
      // ComplianceCheck row (handler writes decisionPacketId = subject.decisionId).
      const event = await trap.waitForEvent({
        detailType: 'DECISION_APPROVED',
        match: (d) => {
          const subject = (d as Record<string, unknown>).subject as Record<string, unknown>;
          return subject?.['decisionPacketId'] === decisionId;
        },
        timeoutMs: 90_000,
      });
      expect(event.detailType).toBe('DECISION_APPROVED');
      const detail = event.detail as Record<string, unknown>;
      const subject = detail.subject as Record<string, unknown>;
      // ADVISORY mandate forces L2 even when all checks pass.
      expect(subject['authorityLevel']).toBe('L2');
    }, 180_000);

    it('isInitialBuild=false, ADVISORY+BALANCED, VTI@25% → DECISION_BLOCKED on MAX_SINGLE_TRADE', async () => {
      // Per-test unique userId — isolates the MandateSnapshot row from other tests.
      const userId = `integ-user-steadystate-${Date.now()}`;
      const mandateId = `integ-mandate-steadystate-${Date.now()}`;
      const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

      // Seed MandateSnapshot via MANDATE_ISSUED with ADVISORY+BALANCED.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        subject: {
          mandateId,
          level: 'ADVISORY',
          status: 'ACTIVE',
          operatingMode: 'BALANCED',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          __version: 1,
        },
        context: { userId },
      });

      await table.waitForItem({
        table: 'compliance-ctrl',
        pk: policyPk,
        sk: 'MandateSnapshot',
        timeoutMs: 90_000,
        match: { mandateId },
      });

      const decisionId = `integ-steadystate-${Date.now()}`;

      // Single trade: VTI 25% allocation = 25_000 cents against 100_000 cents portfolio.
      // BALANCED maxSingleTradePercent=10 → cap = 10_000 cents.
      // 25_000 > 10_000 → MAX_SINGLE_TRADE fails → DECISION_BLOCKED.
      // Pre-fix bug: portfolioValue (old field) was undefined, so maxAmountCents
      // was NaN; `trade > NaN` is false in JS, so the check silently passed.
      // portfolioValueCents fix ensures the math is correct.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'RECOMMENDATION_PROPOSED',
        subject: {
          decisionId,
          taskToken: `integ-task-token-${decisionId}`,
          awaitingCompliance: true,
          proposedTrades: [
            {
              symbol: 'VTI',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 25_000,
              targetWeightPercent: 25,
              rationale: 'Steady-state rebalance exceeding single-trade cap',
            },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: false,
          currentPositions: [],
        },
        // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
        context: { userId },
      });

      const event = await trap.waitForEvent({
        detailType: 'DECISION_BLOCKED',
        match: (d) => {
          const subject = (d as Record<string, unknown>).subject as Record<string, unknown>;
          return subject?.['decisionPacketId'] === decisionId;
        },
        timeoutMs: 90_000,
      });
      expect(event.detailType).toBe('DECISION_BLOCKED');
      const detail = event.detail as Record<string, unknown>;
      const subject = detail.subject as Record<string, unknown>;

      // Verify the specific violation rule that fired.
      const violations = subject['violations'] as Array<Record<string, unknown>> | undefined;
      expect(violations).toBeDefined();
      expect(violations!.some((v) => v['rule'] === 'MAX_SINGLE_TRADE')).toBe(true);
      // Defensive exclusivity check: TURNOVER_CAP sits exactly at the 25% cap
      // boundary (25_000 cents = 25% of 100_000 = cap, NOT over) and
      // CONCENTRATION_LIMIT BALANCED=30% > the trade's 25%, so by design only
      // MAX_SINGLE_TRADE fires. If a future params change (e.g. TURNOVER_CAP
      // lowered, or CONCENTRATION_LIMIT tightened) makes a second rule fire,
      // this assertion catches the silent expansion.
      expect(violations).toHaveLength(1);

      // ADVISORY mandate + violations → L2.
      expect(subject['authorityLevel']).toBe('L2');
    }, 180_000);
  });

  // ── Steady-state guardrails — ferry-ledger ────────────────────────────
  // These three cases exercise the two guardrails that are gated on
  // isInitialBuild=false (MAX_SINGLE_TRADE, TURNOVER_CAP) under the
  // BALANCED operating mode, plus the initial-build skip path as a
  // regression guard. Added as part of the ferry-ledger-positions-to-advisory
  // workstream to prove that the positions payload delivered by the new
  // ledger ferry is correctly evaluated in steady-state cycles.

  describe('Steady-state guardrails — ferry-ledger', () => {
    it('BLOCKS a decision when a single trade exceeds maxSingleTradePercent in steady state', async () => {
      const userId = `integ-user-ferry-mst-${Date.now()}`;
      const mandateId = `integ-mandate-ferry-mst-${Date.now()}`;
      const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

      // Seed MandateSnapshot with BALANCED operatingMode (maxSingleTradePercent=10).
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        subject: {
          mandateId,
          level: 'DISCRETIONARY',
          status: 'ACTIVE',
          operatingMode: 'BALANCED',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          __version: 1,
        },
        context: { userId },
      });

      await table.waitForItem({
        table: 'compliance-ctrl',
        pk: policyPk,
        sk: 'MandateSnapshot',
        timeoutMs: 90_000,
        match: { mandateId },
      });

      const decisionId = `integ-ferry-mst-${Date.now()}`;

      // Single trade: VTI at 15% of portfolio (15_000 cents on 100_000).
      // BALANCED maxSingleTradePercent=10 → cap=10_000 cents.
      // 15_000 > 10_000 → MAX_SINGLE_TRADE fires → DECISION_BLOCKED.
      // targetWeightPercent=15 < singleEtfConcentrationPercent=30 (BALANCED) so
      // CONCENTRATION_LIMIT does NOT fire — only MAX_SINGLE_TRADE blocks.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'RECOMMENDATION_PROPOSED',
        subject: {
          decisionId,
          taskToken: `integ-task-token-${decisionId}`,
          awaitingCompliance: true,
          proposedTrades: [
            {
              symbol: 'VTI',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 15_000,
              targetWeightPercent: 15,
              rationale: 'Steady-state rebalance above single-trade cap',
            },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: false,
          currentPositions: [
            { ticker: 'VTI', weight: 0 },
          ],
        },
        // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
        context: { userId },
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

      const violations = subject['violations'] as Array<Record<string, unknown>> | undefined;
      expect(violations).toBeDefined();
      expect(violations!.some((v) => v['rule'] === 'MAX_SINGLE_TRADE')).toBe(true);
    }, 300_000);

    it('BLOCKS when sum of trade absolute values exceeds monthlyTurnoverCapPercent', async () => {
      const userId = `integ-user-ferry-tc-${Date.now()}`;
      const mandateId = `integ-mandate-ferry-tc-${Date.now()}`;
      const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

      // Seed MandateSnapshot with BALANCED operatingMode (monthlyTurnoverCapPercent=25).
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        subject: {
          mandateId,
          level: 'DISCRETIONARY',
          status: 'ACTIVE',
          operatingMode: 'BALANCED',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          __version: 1,
        },
        context: { userId },
      });

      await table.waitForItem({
        table: 'compliance-ctrl',
        pk: policyPk,
        sk: 'MandateSnapshot',
        timeoutMs: 90_000,
        match: { mandateId },
      });

      const decisionId = `integ-ferry-tc-${Date.now()}`;

      // 4 trades × 7_000 cents = 28_000 cents total (28% of 100_000 portfolio).
      // BALANCED monthlyTurnoverCapPercent=25 → cap=25_000 cents.
      // 28_000 > 25_000 → TURNOVER_CAP fires → DECISION_BLOCKED.
      // Each individual trade 7% < maxSingleTradePercent=10 → MAX_SINGLE_TRADE passes.
      // Each targetWeightPercent=7 < singleEtfConcentrationPercent=30 → CONCENTRATION_LIMIT passes.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'RECOMMENDATION_PROPOSED',
        subject: {
          decisionId,
          taskToken: `integ-task-token-${decisionId}`,
          awaitingCompliance: true,
          proposedTrades: [
            { symbol: 'VTI',  assetClass: 'EQUITY',       side: 'BUY', quantityOrAmountCents: 7_000, targetWeightPercent: 7, rationale: 'Rebalance' },
            { symbol: 'IXUS', assetClass: 'EQUITY',       side: 'BUY', quantityOrAmountCents: 7_000, targetWeightPercent: 7, rationale: 'Rebalance' },
            { symbol: 'QQQ',  assetClass: 'EQUITY',       side: 'BUY', quantityOrAmountCents: 7_000, targetWeightPercent: 7, rationale: 'Rebalance' },
            { symbol: 'BND',  assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 7_000, targetWeightPercent: 7, rationale: 'Rebalance' },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: false,
          currentPositions: [],
        },
        // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
        context: { userId },
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

      const violations = subject['violations'] as Array<Record<string, unknown>> | undefined;
      expect(violations).toBeDefined();
      expect(violations!.some((v) => v['rule'] === 'TURNOVER_CAP')).toBe(true);
    }, 300_000);

    it('APPROVES the same oversized trades when isInitialBuild=true (skip path preserved)', async () => {
      const userId = `integ-user-ferry-skip-${Date.now()}`;
      const mandateId = `integ-mandate-ferry-skip-${Date.now()}`;
      const policyPk = `GuardrailPolicy#${ctx.tenantId}#${userId}`;

      // Seed MandateSnapshot with BALANCED operatingMode.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        subject: {
          mandateId,
          level: 'DISCRETIONARY',
          status: 'ACTIVE',
          operatingMode: 'BALANCED',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          __version: 1,
        },
        context: { userId },
      });

      await table.waitForItem({
        table: 'compliance-ctrl',
        pk: policyPk,
        sk: 'MandateSnapshot',
        timeoutMs: 90_000,
        match: { mandateId },
      });

      const decisionId = `integ-ferry-skip-${Date.now()}`;

      // Same 15% trade as the MAX_SINGLE_TRADE case above — would block at
      // isInitialBuild=false, but isInitialBuild=true skips MAX_SINGLE_TRADE
      // and TURNOVER_CAP. No other blocking violations → DECISION_APPROVED.
      // DISCRETIONARY+BALANCED, no violations after skip → L1.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'RECOMMENDATION_PROPOSED',
        subject: {
          decisionId,
          taskToken: `integ-task-token-${decisionId}`,
          awaitingCompliance: true,
          proposedTrades: [
            {
              symbol: 'VTI',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 15_000,
              targetWeightPercent: 15,
              rationale: 'Initial allocation above steady-state cap',
            },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: true,
          currentPositions: [],
        },
        // Pin userId so processDecisionPacket reads the correct per-test MandateSnapshot.
        context: { userId },
      });

      const event = await trap.waitForEvent({
        detailType: 'DECISION_APPROVED',
        match: (d) => {
          const subject = (d as Record<string, unknown>).subject as Record<string, unknown>;
          return subject?.['decisionPacketId'] === decisionId;
        },
        timeoutMs: 120_000,
      });
      expect(event.detailType).toBe('DECISION_APPROVED');
      // The primary assertion is DECISION_APPROVED itself — proves the
      // isInitialBuild=true skip path on MAX_SINGLE_TRADE + TURNOVER_CAP is
      // preserved. authorityLevel resolution (L1 vs L2) is a separate concern
      // driven by trade size + risk category, not by the skip flag — a 15%
      // single-trade still warrants user confirmation (L2) even on first build.
    }, 300_000);
  });
});
