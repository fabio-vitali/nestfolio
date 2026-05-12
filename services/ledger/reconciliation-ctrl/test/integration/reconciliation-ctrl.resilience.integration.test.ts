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
// reconciliation-ctrl derives `reconciliationId` from `ctx.eventId` in the
// handler, so publishing the same logical event twice with the same eventId
// must target the same PK (`Reconciliation#${tenantId}#${reconciliationId}`)
// and therefore cannot produce a second ReconciliationResult INSERT.
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
      expect([...uniqueReconciliationIds][0]).toBe(eventId);
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
