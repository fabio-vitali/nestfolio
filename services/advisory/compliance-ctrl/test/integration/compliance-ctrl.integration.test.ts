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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
      },
    });

    // Poll for THIS test's mandateId — handler may run multiple times if the
    // SQS Lambda redelivers, but each carries the same mandateId so the
    // assertion is stable.
    let item: Record<string, unknown> | undefined;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        item = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (item['mandateId'] === mandateId) break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!item || item['mandateId'] !== mandateId) {
      throw new Error(`MandateSnapshot did not project mandateId=${mandateId} within 90s`);
    }

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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'ADVISORY',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: '2026-01-15T00:00:00.000Z',
      },
    });

    let seeded: Record<string, unknown> | undefined;
    const seedDeadline = Date.now() + 60_000;
    while (Date.now() < seedDeadline) {
      try {
        seeded = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (seeded['mandateId'] === mandateId && seeded['operatingMode'] === 'CONSERVATIVE') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!seeded || seeded['operatingMode'] !== 'CONSERVATIVE') {
      throw new Error(`Initial MandateSnapshot did not seed for ${userId} within 60s`);
    }

    // Now emit OPERATING_MODE_CHANGED — patches only operatingMode, leaves level/mandateId intact
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'OPERATING_MODE_CHANGED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        operatingMode: 'AGGRESSIVE',
      },
    });

    // Poll until the projection reflects the updated operatingMode
    let updated: Record<string, unknown> | undefined;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        updated = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (updated['operatingMode'] === 'AGGRESSIVE') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    expect(updated!['mandateId']).toBe(mandateId);
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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
      },
    });

    // Wait for the row to land — MANDATE_ISSUED projection sets status='ACTIVE'.
    let seeded: Record<string, unknown> | undefined;
    const seedDeadline = Date.now() + 60_000;
    while (Date.now() < seedDeadline) {
      try {
        seeded = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (seeded['mandateId'] === mandateId) break;
      } catch { /* not yet */ }
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
        userId,
        revokedAt,
      },
    });

    // 3. Poll for status=REVOKED
    let revoked: Record<string, unknown> | undefined;
    const revokeDeadline = Date.now() + 60_000;
    while (Date.now() < revokeDeadline) {
      try {
        revoked = await table.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });
        if (revoked['status'] === 'REVOKED') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(revoked!['status']).toBe('REVOKED');
    expect(revoked!['revokedAt']).toBe(revokedAt);
    // Critical: MANDATE_REVOKED must patch only status + revokedAt,
    // leaving mandate fields (mandateId, level, operatingMode, effectiveDate)
    // projected from MANDATE_ISSUED intact for downstream rule evaluation.
    expect(revoked!['mandateId']).toBe(mandateId);
    expect(revoked!['level']).toBe('DISCRETIONARY');
    expect(revoked!['operatingMode']).toBe('BALANCED');
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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-15T00:00:00.000Z',
      },
    });

    // Wait for the seed to land — MANDATE_ISSUED sets status='ACTIVE'.
    // try/catch swallows the inner waitForItem timeout so jest.retryTimes(1)
    // doesn't double-fire the seed/revoke pair.
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
        if (seeded['mandateId'] === mandateId && seeded['status'] !== 'REVOKED') break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!seeded || seeded['mandateId'] !== mandateId || seeded['status'] === 'REVOKED') {
      throw new Error(`MandateSnapshot did not seed for ${policyPk} within 90s`);
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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        operatingMode: 'BALANCED',
        effectiveDate: '2026-01-01T00:00:00.000Z',
      },
    });

    // Wait for THIS test's mandateId to land — try/catch swallows the inner
    // timeout so jest.retryTimes(1) doesn't re-fire the seed/decision pair.
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
        if (seeded['mandateId'] === mandateId) break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!seeded || seeded['mandateId'] !== mandateId) {
      throw new Error(`MandateSnapshot did not project mandateId=${mandateId} for ${policyPk} within 90s`);
    }

    const decisionId = `integ-authority-balanced-${Date.now()}`;

    // Send RECOMMENDATION_PROPOSED with a 6% trade (within BALANCED 10% limit
    // → 6000 cents on 100000 portfolio = 6%). Guardrails derived from operatingMode.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        tenantId: ctx.tenantId,
        userId,
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
      detail: {
        tenantId: ctx.tenantId,
        userId,
        mandateId,
        level: 'DISCRETIONARY',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: '2026-01-01T00:00:00.000Z',
      },
    });

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
        if (seeded['mandateId'] === mandateId) break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!seeded || seeded['mandateId'] !== mandateId) {
      throw new Error(`MandateSnapshot did not project mandateId=${mandateId} for ${policyPk} within 90s`);
    }

    const decisionId = `integ-authority-conservative-${Date.now()}`;

    // 6% trade (6000 cents on 100000) exceeds CONSERVATIVE 5% maxSingleTradePercent → L2 + BLOCKED.
    // Threshold is derived from operatingMode='CONSERVATIVE' at rule-evaluation time.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        decisionId,
        tenantId: ctx.tenantId,
        userId,
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
});
