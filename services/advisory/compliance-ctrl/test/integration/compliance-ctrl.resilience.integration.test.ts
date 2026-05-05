import { randomUUID } from 'node:crypto';
import {
  createTestContext,
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  TableAssertions,
  countItems,
  snapshotState,
  assertEquivalentState,
} from '@nestfolio/integration-testing';

// compliance-ctrl resilience — verifies that the MandateSnapshot projection
// from InvestorProfile composite events behaves correctly under SQS
// at-least-once redelivery and out-of-order arrival.
//
// State layout:
//   pk: GuardrailPolicy#${tenantId}#${userId}
//   sk: MandateSnapshot
//
// Two ingress paths under test:
//   - INVESTOR_PROFILE_CREATED / _UPDATED → projects 8 guardrail fields
//     (level, monthlyTurnoverCapPercent, maxSingleTradePercent, ...)
//     Status is intentionally NOT set here — owned by MANDATE_REVOKED.
//   - MANDATE_REVOKED → patches status='REVOKED' + revokedAt only
//     (preserving guardrail fields).
//
// The ordering contract is documented in event-listener.ts:99-104: a late
// INVESTOR_PROFILE_CREATED (e.g., SQS redelivery) must NOT clobber
// MandateSnapshot.status='REVOKED'. The handler's ConditionExpression
// guards this — these tests verify it end-to-end.

const baseMandate = (mandateId: string) => ({
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
});

async function pollForMandateSnapshot(
  table: TableAssertions,
  tenantId: string,
  userId: string,
  predicate: (item: Record<string, unknown>) => boolean,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const item = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${tenantId}#${userId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      if (predicate(item)) return item;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`pollForMandateSnapshot: predicate did not become true within ${timeoutMs}ms`);
}

// ── Idempotency ──────────────────────────────────────────────────────────

describe('compliance-ctrl resilience: idempotency', () => {
  it('duplicate INVESTOR_PROFILE_CREATED produces a single MandateSnapshot row', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const userId = `idemp-user-${randomUUID()}`;
      const mandateId = `idemp-mandate-${randomUUID()}`;
      const eventId = `idemp-profile-${randomUUID()}`;
      const detail = {
        tenantId: ctx.tenantId,
        userId,
        mandate: baseMandate(mandateId),
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
      };

      // First publish
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail,
        eventId,
      });

      await pollForMandateSnapshot(table, ctx.tenantId, userId, (i) => i['mandateId'] === mandateId);

      const countBefore = await countItems(
        table, 'compliance-ctrl', `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      );

      // Duplicate publish (same eventId, same payload)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      const countAfter = await countItems(
        table, 'compliance-ctrl', `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      );
      // Single-row design: still exactly one row, regardless of how many
      // times the projection ran. The handler may have written twice but the
      // sk is constant ('MandateSnapshot') so DDB has exactly one item.
      expect(countAfter).toBe(countBefore);
      expect(countAfter).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate MANDATE_REVOKED does not flip a REVOKED row back to ACTIVE', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const userId = `idemp-revoke-${randomUUID()}`;
      const mandateId = `idemp-revoke-mandate-${randomUUID()}`;

      // Seed
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          mandate: baseMandate(mandateId),
          goal: { type: 'RETIREMENT', horizonYears: 20 },
          riskProfile: { score: 6, band: 'BALANCED' },
          operatingMode: 'BALANCED',
        },
      });
      await pollForMandateSnapshot(table, ctx.tenantId, userId, (i) => i['mandateId'] === mandateId);

      // First revoke
      const revokedAt = '2026-04-01T12:00:00.000Z';
      const revokeEventId = `idemp-revoke-evt-${randomUUID()}`;
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: { tenantId: ctx.tenantId, userId, revokedAt },
        eventId: revokeEventId,
      });
      await pollForMandateSnapshot(table, ctx.tenantId, userId, (i) => i['status'] === 'REVOKED');

      // Duplicate revoke (same eventId)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: { tenantId: ctx.tenantId, userId, revokedAt },
        eventId: revokeEventId,
      });

      await new Promise((r) => setTimeout(r, 10_000));

      const final = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });
      expect(final['status']).toBe('REVOKED');
      expect(final['revokedAt']).toBe(revokedAt);
      // Guardrail fields preserved through the second revoke
      expect(final['mandateId']).toBe(mandateId);
      expect(final['maxSingleTradePercent']).toBe(10);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);
});

// ── Order-Agnostic ──────────────────────────────────────────────────────
// Critical contract per event-listener.ts:99-104: a late
// INVESTOR_PROFILE_CREATED arriving AFTER MANDATE_REVOKED must NOT clobber
// MandateSnapshot.status='REVOKED'. This guards against SQS at-least-once
// redelivery of the create event after the revoke landed.

describe('compliance-ctrl resilience: order-agnostic', () => {
  it('INVESTOR_PROFILE_CREATED + MANDATE_REVOKED arriving in either order both end with status=REVOKED', async () => {
    // Run A: create → revoke (canonical lifecycle)
    const ctxA = await createTestContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();

      const userIdA = `pair-A-user-${randomUUID()}`;
      const mandateIdA = `pair-A-mandate-${randomUUID()}`;
      const revokedAt = '2026-04-01T12:00:00.000Z';

      await ebA.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail: {
          tenantId: ctxA.tenantId,
          userId: userIdA,
          mandate: baseMandate(mandateIdA),
          goal: { type: 'RETIREMENT', horizonYears: 20 },
          riskProfile: { score: 6, band: 'BALANCED' },
          operatingMode: 'BALANCED',
        },
      });
      await pollForMandateSnapshot(tableA, ctxA.tenantId, userIdA, (i) => i['mandateId'] === mandateIdA);

      await ebA.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: { tenantId: ctxA.tenantId, userId: userIdA, revokedAt },
      });
      await pollForMandateSnapshot(tableA, ctxA.tenantId, userIdA, (i) => i['status'] === 'REVOKED');

      const snapshotA = await snapshotState(
        tableA, 'compliance-ctrl', `GuardrailPolicy#${ctxA.tenantId}#${userIdA}`,
      );

      // Run B: revoke arrives FIRST (e.g., out-of-order SQS), then create
      // arrives late (e.g., redelivery). Final state should preserve REVOKED.
      const ctxB = await createTestContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();

        const userIdB = `pair-B-user-${randomUUID()}`;
        const mandateIdB = `pair-B-mandate-${randomUUID()}`;

        await ebB.putEvent({
          bus: 'advisory',
          targetService: 'compliance-ctrl',
          detailType: 'MANDATE_REVOKED',
          detail: { tenantId: ctxB.tenantId, userId: userIdB, revokedAt },
        });
        // Wait briefly — revoke handler creates the row with status=REVOKED
        // even when no prior projection exists (defensive design).
        await pollForMandateSnapshot(tableB, ctxB.tenantId, userIdB, (i) => i['status'] === 'REVOKED');

        await ebB.putEvent({
          bus: 'advisory',
          targetService: 'compliance-ctrl',
          detailType: 'INVESTOR_PROFILE_CREATED',
          detail: {
            tenantId: ctxB.tenantId,
            userId: userIdB,
            mandate: baseMandate(mandateIdB),
            goal: { type: 'RETIREMENT', horizonYears: 20 },
            riskProfile: { score: 6, band: 'BALANCED' },
            operatingMode: 'BALANCED',
          },
        });

        // Allow late create to settle. The conditional write in
        // event-listener.ts must NOT clobber status=REVOKED.
        await new Promise((r) => setTimeout(r, 15_000));

        const finalB = await tableB.waitForItem({
          table: 'compliance-ctrl',
          pk: `GuardrailPolicy#${ctxB.tenantId}#${userIdB}`,
          sk: 'MandateSnapshot',
          timeoutMs: 5_000,
        });

        // Both runs end with status=REVOKED. Ordering is invariant.
        expect(finalB['status']).toBe('REVOKED');
        expect(finalB['revokedAt']).toBe(revokedAt);

        // Final-state structural equivalence excluding userId/mandateId
        // (per-tenant isolators) — both rows carry status=REVOKED + revokedAt.
        // Per-Run mandateId and userId differ; stripDynamicFields removes
        // userId. mandateId is preserved by the create path on Run A but
        // never set on Run B (since revoke landed first and the create
        // didn't run before assertion). Drop mandateId before comparing.
        const cleanA = snapshotA.map(({ mandateId: _m, ...rest }) => rest);
        const snapshotB = await snapshotState(
          tableB, 'compliance-ctrl', `GuardrailPolicy#${ctxB.tenantId}#${userIdB}`,
        );
        const cleanB = snapshotB.map(({ mandateId: _m, ...rest }) => rest);
        assertEquivalentState(cleanA, cleanB);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 240_000);
});
