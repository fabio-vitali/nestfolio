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
// from mandate lifecycle events behaves correctly under SQS at-least-once
// redelivery and out-of-order arrival.
//
// State layout:
//   pk: GuardrailPolicy#${tenantId}#${userId}
//   sk: MandateSnapshot
//
// Two ingress paths under test:
//   - MANDATE_ISSUED  → projects {mandateId, level, status:'ACTIVE', operatingMode, effectiveDate}
//     Numeric guardrail thresholds are no longer stored on the row —
//     GuardrailEvaluator derives them from operatingMode via resolveGuardrailParams.
//   - MANDATE_REVOKED → patches status='REVOKED' + revokedAt only
//     (preserving mandate fields: mandateId, level, operatingMode, effectiveDate).
//
// The ordering contract: a late MANDATE_ISSUED (e.g., SQS redelivery)
// must NOT clobber MandateSnapshot.status='REVOKED'. The handler's
// ConditionExpression guards this — these tests verify it end-to-end.

const baseMandateIssued = (mandateId: string) => ({
  mandateId,
  level: 'DISCRETIONARY',
  operatingMode: 'BALANCED',
  effectiveDate: '2026-01-15T00:00:00.000Z',
});

async function pollForMandateSnapshot(
  table: TableAssertions,
  tenantId: string,
  userId: string,
  predicate: (item: Record<string, unknown>) => boolean,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  return table.waitForItem({
    table: 'compliance-ctrl',
    pk: `GuardrailPolicy#${tenantId}#${userId}`,
    sk: 'MandateSnapshot',
    timeoutMs,
    predicate,
    description: 'MandateSnapshot predicate',
  });
}

// ── Idempotency ──────────────────────────────────────────────────────────

describe('compliance-ctrl resilience: idempotency', () => {
  it('duplicate MANDATE_ISSUED produces a single MandateSnapshot row', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const userId = `idemp-user-${randomUUID()}`;
      const mandateId = `idemp-mandate-${randomUUID()}`;
      const eventId = `idemp-mandate-issued-${randomUUID()}`;
      const detail = {
        tenantId: ctx.tenantId,
        userId,
        ...baseMandateIssued(mandateId),
        status: 'ACTIVE',
        __version: 1,
      };

      // First publish
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
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
        detailType: 'MANDATE_ISSUED',
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

      // Seed via MANDATE_ISSUED
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          ...baseMandateIssued(mandateId),
          status: 'ACTIVE',
          __version: 1,
        },
      });
      await pollForMandateSnapshot(table, ctx.tenantId, userId, (i) => i['mandateId'] === mandateId);

      // First revoke — full image at __version:2 so projectVersioned version guard accepts it
      const revokedAt = '2026-04-01T12:00:00.000Z';
      const revokeEventId = `idemp-revoke-evt-${randomUUID()}`;
      const revokeDetail = {
        tenantId: ctx.tenantId,
        userId,
        ...baseMandateIssued(mandateId),
        status: 'REVOKED',
        revokedAt,
        __version: 2,
      };
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: revokeDetail,
        eventId: revokeEventId,
      });
      await pollForMandateSnapshot(table, ctx.tenantId, userId, (i) => i['status'] === 'REVOKED');

      // Duplicate revoke (same eventId, same payload — __version:2 redelivery)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: revokeDetail,
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
      // Mandate fields preserved through the second revoke
      expect(final['mandateId']).toBe(mandateId);
      expect(final['level']).toBe('DISCRETIONARY');
      expect(final['operatingMode']).toBe('BALANCED');
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);
});

// ── Order-Agnostic (SQS redelivery contract) ───────────────────────────
// Documented contract: a late MANDATE_ISSUED arriving AFTER the row has
// been REVOKED must NOT clobber MandateSnapshot.status='REVOKED'. This is
// the realistic SQS-at-least-once scenario:
//   original MANDATE_ISSUED lands → MANDATE_REVOKED patches status=REVOKED
//   → SQS redelivers the original MANDATE_ISSUED (typical 12-hour visibility
//   timeout window) → conditional write skips, REVOKED preserved.
//
// Note: a "revoke before any issue" ordering is NOT a real product
// scenario (you cannot revoke a mandate that was never issued), and the
// system does not guarantee field projection in that case.
// The contract under test is solely the REVOKED-preservation property.

describe('compliance-ctrl resilience: order-agnostic (SQS redelivery)', () => {
  it('ISSUE → REVOKE → late-ISSUE does not clobber MandateSnapshot.status=REVOKED', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const userId = `redelivery-user-${randomUUID()}`;
      const mandateId = `redelivery-mandate-${randomUUID()}`;
      const revokedAt = '2026-04-01T12:00:00.000Z';
      const issueEventId = `redelivery-issue-${randomUUID()}`;
      // __version:1 — the original issue; redelivered late MANDATE_ISSUED reuses
      // the same version so the version guard (current __version:2 >= :version 1)
      // drops it and REVOKED is preserved.
      const issueDetail = {
        tenantId: ctx.tenantId,
        userId,
        ...baseMandateIssued(mandateId),
        status: 'ACTIVE',
        __version: 1,
      };

      // 1. Original MANDATE_ISSUED — projects {mandateId, level, status:'ACTIVE', operatingMode, effectiveDate}
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        detail: issueDetail,
        eventId: issueEventId,
      });
      const projected = await pollForMandateSnapshot(
        table, ctx.tenantId, userId, (i) => i['mandateId'] === mandateId,
      );
      expect(projected['status']).toBe('ACTIVE');
      expect(projected['level']).toBe('DISCRETIONARY');
      expect(projected['operatingMode']).toBe('BALANCED');

      // 2. REVOKE — full image at __version:2 so projectVersioned version guard accepts it;
      //    writes the whole row (mandateId/level/operatingMode/effectiveDate preserved from image)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_REVOKED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          ...baseMandateIssued(mandateId),
          status: 'REVOKED',
          revokedAt,
          __version: 2,
        },
      });
      const revoked = await pollForMandateSnapshot(
        table, ctx.tenantId, userId, (i) => i['status'] === 'REVOKED',
      );
      // Mandate fields (not just numeric thresholds) preserved through revoke
      expect(revoked['mandateId']).toBe(mandateId);
      expect(revoked['level']).toBe('DISCRETIONARY');
      expect(revoked['operatingMode']).toBe('BALANCED');

      // 3. SQS redelivery of the original MANDATE_ISSUED (same eventId, same payload)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'compliance-ctrl',
        detailType: 'MANDATE_ISSUED',
        detail: issueDetail,
        eventId: issueEventId,
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

      // The contract: the redelivered MANDATE_ISSUED must NOT clobber REVOKED.
      expect(final['status']).toBe('REVOKED');
      expect(final['revokedAt']).toBe(revokedAt);
      // And mandate fields remain intact for any subsequent rule evaluation.
      expect(final['mandateId']).toBe(mandateId);
      expect(final['level']).toBe('DISCRETIONARY');
      expect(final['operatingMode']).toBe('BALANCED');

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
