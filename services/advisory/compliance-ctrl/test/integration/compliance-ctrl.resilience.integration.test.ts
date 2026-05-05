import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
  countItems,
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
    const ctx = await createIntegrationTestContext();
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
    const ctx = await createIntegrationTestContext();
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

// ── Order-Agnostic (SQS redelivery contract) ───────────────────────────
// Documented contract per event-listener.ts:99-104: a late
// INVESTOR_PROFILE_CREATED arriving AFTER the row has been REVOKED must
// NOT clobber MandateSnapshot.status='REVOKED'. This is the realistic
// SQS-at-least-once scenario: original create lands → revoke patches in
// status=REVOKED → SQS redelivers the original create (typical 12-hour
// visibility timeout window) → conditional write skips, REVOKED preserved.
//
// Note: a "revoke before any create" ordering is NOT a real product
// scenario (you cannot revoke a mandate that was never created), and the
// system does not guarantee guardrail-field projection in that case.
// The contract under test is solely the REVOKED-preservation property.

describe('compliance-ctrl resilience: order-agnostic (SQS redelivery)', () => {
  it('CREATE → REVOKE → late-CREATE does not clobber MandateSnapshot.status=REVOKED', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const userId = `redelivery-user-${randomUUID()}`;
      const mandateId = `redelivery-mandate-${randomUUID()}`;
      const revokedAt = '2026-04-01T12:00:00.000Z';
      const createEventId = `redelivery-create-${randomUUID()}`;
      const createDetail = {
        tenantId: ctx.tenantId,
        userId,
        mandate: baseMandate(mandateId),
        goal: { type: 'RETIREMENT', horizonYears: 20 },
        riskProfile: { score: 6, band: 'BALANCED' },
        operatingMode: 'BALANCED',
      };

      // 1. Original CREATE — projects guardrail fields (no status set)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail: createDetail,
        eventId: createEventId,
      });
      const projected = await pollForMandateSnapshot(
        table, ctx.tenantId, userId, (i) => i['mandateId'] === mandateId,
      );
      expect(projected['status']).toBeUndefined();
      expect(projected['maxSingleTradePercent']).toBe(10);

      // 2. REVOKE — patches status=REVOKED + revokedAt, preserving guardrails
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: { tenantId: ctx.tenantId, userId, revokedAt },
      });
      const revoked = await pollForMandateSnapshot(
        table, ctx.tenantId, userId, (i) => i['status'] === 'REVOKED',
      );
      expect(revoked['maxSingleTradePercent']).toBe(10); // guardrails preserved

      // 3. SQS redelivery of the original CREATE (same eventId, same payload)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail: createDetail,
        eventId: createEventId,
      });

      // Allow the redelivery to land and the handler to either skip
      // (ConditionExpression) or process without clobbering.
      await new Promise((r) => setTimeout(r, 15_000));

      const final = await table.waitForItem({
        table: 'compliance-ctrl',
        pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
        sk: 'MandateSnapshot',
        timeoutMs: 5_000,
      });

      // The contract: the redelivered CREATE must NOT clobber REVOKED.
      expect(final['status']).toBe('REVOKED');
      expect(final['revokedAt']).toBe(revokedAt);
      // And guardrail fields remain intact for any subsequent rule evaluation.
      expect(final['mandateId']).toBe(mandateId);
      expect(final['level']).toBe('DISCRETIONARY');
      expect(final['maxSingleTradePercent']).toBe(10);
      expect(final['monthlyTurnoverCapPercent']).toBe(25);

      // Snapshot stays a single row throughout the lifecycle
      const count = await countItems(
        table, 'compliance-ctrl', `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      );
      expect(count).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 240_000);
});
