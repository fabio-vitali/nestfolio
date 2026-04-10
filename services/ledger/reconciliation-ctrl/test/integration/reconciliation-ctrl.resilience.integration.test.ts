import { randomUUID } from 'node:crypto';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────
//
// reconciliation-ctrl derives `reconciliationId` from `ctx.eventId` in the
// handler, so publishing the same logical event twice with the same eventId
// must target the same PK (`Reconciliation#${tenantId}#${reconciliationId}`)
// and therefore cannot produce a second ReconciliationResult insert — which
// means no second RECONCILIATION_COMPLETED CDC event should fire.

describe('reconciliation-ctrl resilience: idempotency', () => {
  it('duplicate PORTFOLIO_UPDATED does not produce duplicate ReconciliationResult', async () => {
    const ctx = await createIntegrationContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const trap = new EventBusTrap(ctx);
      await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      const eventId = `recon-idemp-${randomUUID()}`;
      const payload = {
        portfolioId: `portfolio-idemp-${randomUUID()}`,
        positions: [
          { symbol: 'AAPL', quantity: 10 },
          { symbol: 'MSFT', quantity: 5 },
        ],
      };

      // First publish — should produce one RECONCILIATION_COMPLETED
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
      // The handler writes an identical ReconciliationResult item, which
      // DynamoDB treats as a MODIFY (not an INSERT), so CDC must NOT emit
      // RECONCILIATION_COMPLETED a second time.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 20_000));

      const remaining = await trap.drain();
      const reconEvents = remaining.filter(
        (e) => e.detailType === 'RECONCILIATION_COMPLETED',
      );
      expect(reconEvents).toHaveLength(0);
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
  it('PORTFOLIO_UPDATED and ALPACA_ACCOUNT_SNAPSHOT in either order both produce reconciliation', async () => {
    // ── Run A: PORTFOLIO_UPDATED first, then ALPACA_ACCOUNT_SNAPSHOT ──
    const ctxA = await createIntegrationContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const trapA = new EventBusTrap(ctxA);
      await trapA.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

      await ebA.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          portfolioId: `portfolio-pair-A-${randomUUID()}`,
          positions: [{ symbol: 'AAPL', quantity: 10 }],
        },
      });

      const firstA = await trapA.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });
      expect(firstA.detailType).toBe('RECONCILIATION_COMPLETED');

      await ebA.putEvent({
        bus: 'ledger',
        targetService: 'reconciliation-ctrl',
        detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
        detail: {
          snapshotId: `snapshot-pair-A-${randomUUID()}`,
          positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
          cash: 50000,
        },
      });

      const secondA = await trapA.waitForEvent({
        detailType: 'RECONCILIATION_COMPLETED',
        timeoutMs: 120_000,
      });
      expect(secondA.detailType).toBe('RECONCILIATION_COMPLETED');

      // ── Run B: ALPACA_ACCOUNT_SNAPSHOT first, then PORTFOLIO_UPDATED ──
      const ctxB = await createIntegrationContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const trapB = new EventBusTrap(ctxB);
        await trapB.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

        await ebB.putEvent({
          bus: 'ledger',
          targetService: 'reconciliation-ctrl',
          detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
          detail: {
            snapshotId: `snapshot-pair-B-${randomUUID()}`,
            positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
            cash: 50000,
          },
        });

        const firstB = await trapB.waitForEvent({
          detailType: 'RECONCILIATION_COMPLETED',
          timeoutMs: 120_000,
        });
        expect(firstB.detailType).toBe('RECONCILIATION_COMPLETED');

        await ebB.putEvent({
          bus: 'ledger',
          targetService: 'reconciliation-ctrl',
          detailType: 'PORTFOLIO_UPDATED',
          detail: {
            portfolioId: `portfolio-pair-B-${randomUUID()}`,
            positions: [{ symbol: 'AAPL', quantity: 10 }],
          },
        });

        const secondB = await trapB.waitForEvent({
          detailType: 'RECONCILIATION_COMPLETED',
          timeoutMs: 120_000,
        });
        expect(secondB.detailType).toBe('RECONCILIATION_COMPLETED');
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 600_000);
});
