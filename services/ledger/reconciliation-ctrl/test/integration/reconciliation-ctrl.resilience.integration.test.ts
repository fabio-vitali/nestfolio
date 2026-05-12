import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────
//
// reconciliation-ctrl derives `reconciliationId` from a content hash of
// (intentPositions, settlementPositions). Two redeliveries of the same logical
// event — or even a new event with the same content — target the same PK
// (`Reconciliation#${tenantId}#${reconciliationId}`) and CCFE-dedup at the
// handler. This is symmetric across BOTH cache events (PORTFOLIO_UPDATED and
// ALPACA_ACCOUNT_SNAPSHOT): late redelivery of either side after its
// counterpart has cached produces the same reconciliationId.
//
// The assertion is on **distinct reconciliationIds**, not raw EB event count.
// EB CDC is at-least-once: DDB Stream bisect-on-error + retryAttempts:3 + shard
// rebalances can republish the same INSERT, producing duplicate EB events with
// identical `detail.id` and identical `subject.reconciliationId`. Consumer-side
// dedup (record() with attribute_not_exists(pk)) absorbs those at write time;
// the platform contract does not promise at-most-once at the EB layer.

describe('reconciliation-ctrl resilience: idempotency', () => {
  it('duplicate PORTFOLIO_UPDATED does not produce duplicate ReconciliationResult', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const trap = new EventBusTrap(ctx);
      await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      // Cache Settlement side first so Intent events trigger reconciliation
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: {
          tenantId: ctx.tenantId,
          positions: [
            { symbol: 'AAPL', qty: 10 },
            { symbol: 'MSFT', qty: 5 },
          ],
        },
      });

      // Let Settlement snapshot get cached
      await new Promise((r) => setTimeout(r, 10_000));

      const eventId = `recon-idemp-${randomUUID()}`;
      const payload = {
        portfolioId: `portfolio-idemp-${randomUUID()}`,
        positions: [
          { symbol: 'AAPL', quantity: 10 },
          { symbol: 'MSFT', quantity: 5 },
        ],
      };

      // First Intent publish — finds Settlement → reconcile → RECONCILIATION_COMPLETED
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: payload,
        eventId,
      });

      const firstEvent = await trap.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });
      expect(firstEvent.detailType).toBe('RECONCILIATION_COMPLETED');

      // Duplicate publish (same eventId → same reconciliationId → same PK).
      // The handler's PutItem hits ConditionalCheckFailedException
      // (`attribute_not_exists(pk)` in record()), returns deduplicated, and
      // produces no new DDB stream record — so no NEW reconciliationId can be
      // observed downstream.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated) + tolerate any
      // re-delivery of the first INSERT (at-least-once EB CDC).
      await new Promise((r) => setTimeout(r, 20_000));

      const remaining = await trap.drain();
      const allReconEvents = [
        firstEvent,
        ...remaining.filter((e) => e.detailType === 'RECONCILIATION_COMPLETED'),
      ];
      const uniqueReconciliationIds = new Set(
        allReconEvents.map(
          (e) =>
            ((e.detail as { subject: { reconciliationId: string } }).subject)
              .reconciliationId,
        ),
      );
      expect(uniqueReconciliationIds.size).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 300_000);

  // ── Late cache-event redelivery ────────────────────────────────────────
  // After Intent + Settlement have already reconciled once, redelivery of
  // EITHER cache event with the same content must NOT produce a second
  // reconciliation. Pre-fix this regressed: the handler derived
  // reconciliationId from ctx.eventId, so a redelivered ALPACA_ACCOUNT_SNAPSHOT
  // (different eventId, same content) spawned a new ReconciliationResult row
  // → new RECONCILIATION_COMPLETED. Post-fix: reconciliationId is a content
  // hash, so same content → same pk → CCFE → dedup.
  it('late ALPACA_ACCOUNT_SNAPSHOT redelivery does not produce duplicate reconciliation', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const trap = new EventBusTrap(ctx);
      await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      const settlementPositions = [
        { symbol: 'AAPL', qty: 10 },
        { symbol: 'MSFT', qty: 5 },
      ];

      // Cache Settlement first
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: { tenantId: ctx.tenantId, positions: settlementPositions },
      });
      await new Promise((r) => setTimeout(r, 10_000));

      // Intent publish → reconcile → emit RECONCILIATION_COMPLETED
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          portfolioId: `portfolio-late-redeliver-${randomUUID()}`,
          positions: [
            { symbol: 'AAPL', quantity: 10 },
            { symbol: 'MSFT', quantity: 5 },
          ],
        },
      });

      const firstEvent = await trap.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });

      // Simulate late Settlement redelivery with SAME content but NEW eventId
      // (EB client auto-generates a fresh `id` per putEvent when eventId is omitted).
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: { tenantId: ctx.tenantId, positions: settlementPositions },
      });

      await new Promise((r) => setTimeout(r, 20_000));

      const remaining = await trap.drain();
      const allReconEvents = [
        firstEvent,
        ...remaining.filter((e) => e.detailType === 'RECONCILIATION_COMPLETED'),
      ];
      const uniqueReconciliationIds = new Set(
        allReconEvents.map(
          (e) =>
            ((e.detail as { subject: { reconciliationId: string } }).subject)
              .reconciliationId,
        ),
      );
      expect(uniqueReconciliationIds.size).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 300_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────
//
// PORTFOLIO_UPDATED and ALPACA_ACCOUNT_SNAPSHOT each trigger an independent
// reconciliation under a distinct reconciliationId (derived from eventId).
// The two events do not share state, so processing one must not block or
// corrupt the other, regardless of arrival order. Both runs must produce
// two RECONCILIATION_COMPLETED CDC events.

describe('reconciliation-ctrl resilience: order-agnostic pairwise', () => {
  // Cache-and-compare requires both Intent + Settlement sides.
  // Reconciliation triggers only when the SECOND side arrives and finds
  // the first cached. Verify that order of arrival doesn't matter.

  it('Intent-first: PORTFOLIO_UPDATED then ALPACA_ACCOUNT_SNAPSHOT produces reconciliation', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const trap = new EventBusTrap(ctx);
      await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      // Intent side first — caches, no Settlement yet → skip
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          portfolioId: `portfolio-pair-A-${randomUUID()}`,
          positions: [{ symbol: 'AAPL', quantity: 10 }],
        },
      });

      await new Promise((r) => setTimeout(r, 10_000));

      // Settlement side second — finds cached Intent → reconcile
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: {
          tenantId: ctx.tenantId,
          positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
        },
      });

      const event = await trap.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });
      expect(event.detailType).toBe('RECONCILIATION_COMPLETED');
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 300_000);

  it('Settlement-first: ALPACA_ACCOUNT_SNAPSHOT then PORTFOLIO_UPDATED produces reconciliation', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const trap = new EventBusTrap(ctx);
      await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      // Settlement side first — caches, no Intent yet → skip
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: {
          tenantId: ctx.tenantId,
          positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
        },
      });

      await new Promise((r) => setTimeout(r, 10_000));

      // Intent side second — finds cached Settlement → reconcile
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          portfolioId: `portfolio-pair-B-${randomUUID()}`,
          positions: [{ symbol: 'AAPL', quantity: 10 }],
        },
      });

      const event = await trap.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });
      expect(event.detailType).toBe('RECONCILIATION_COMPLETED');
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 300_000);
});
