import { randomUUID } from 'node:crypto';
import {
  createTestContext,
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
  countItems,
} from '@nestfolio/integration-testing';

// ── Helpers ──────────────────────────────────────────────────────────────
//
// execution-ctrl stores entities under per-entity partition keys:
//   Order       → pk: `Order#${tenantId}#${orderId}`       sk: 'Order'
//   StagedOrder → pk: `StagedOrder#${tenantId}#${orderId}` sk: 'StagedOrder'
//
// The handler sets `orderId = ctx.eventId`, so tests that control eventId
// know deterministically which partitions to query. The plan's earlier
// `T#${tenantId}` partition does not exist here — we count per-eventId.

/**
 * Count all Order/StagedOrder items written for a given eventId.
 * Queries both possible partitions (Order + StagedOrder) and sums.
 */
async function countItemsForEventId(
  table: TableAssertions,
  tenantId: string,
  eventId: string,
): Promise<number> {
  const orderCount = await countItems(
    table,
    'execution-ctrl',
    `Order#${tenantId}#${eventId}`,
  );
  const stagedCount = await countItems(
    table,
    'execution-ctrl',
    `StagedOrder#${tenantId}#${eventId}`,
  );
  return orderCount + stagedCount;
}

// ── Idempotency ──────────────────────────────────────────────────────────
// Each test gets a fresh context (fresh tenant) to prevent cross-test
// contamination. See ledger-ctrl.resilience for the rationale.

describe('execution-ctrl resilience: idempotency', () => {
  it('duplicate DECISION_APPROVED does not create duplicate Order/StagedOrder', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'execution',
        detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'],
      });

      const eventId = `idemp-decision-${randomUUID()}`;
      const payload = {
        decisionPacketId: `dp-idemp-${randomUUID()}`,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'equity',
            side: 'BUY',
            quantityOrAmountCents: 10,
            targetWeightPercent: 25,
          },
        ],
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: payload,
        eventId,
      });

      // Wait for CDC event confirming processing
      await trap.waitForEvent({ timeoutMs: 90_000 });

      const countBefore = await countItemsForEventId(
        table,
        ctx.tenantId,
        eventId,
      );
      expect(countBefore).toBeGreaterThanOrEqual(1);

      // Duplicate publish (same eventId)
      await eb.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: payload,
        eventId,
      });

      // Wait for duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      const countAfter = await countItemsForEventId(
        table,
        ctx.tenantId,
        eventId,
      );

      expect(countAfter).toBe(countBefore);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('execution-ctrl resilience: order-agnostic pairwise', () => {
  it('two DECISION_APPROVED events in either order produce same record set', async () => {
    // ── Run A: event1 (AAPL) then event2 (MSFT) ──
    const ctxA = await createTestContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();
      const trapA = new EventBusTrap(ctxA);
      await trapA.deploy({
        bus: 'execution',
        detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'],
      });

      const eventIdA1 = `pair-A1-${randomUUID()}`;
      const eventIdA2 = `pair-A2-${randomUUID()}`;

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionPacketId: `dp-pair-A1-${randomUUID()}`,
          proposedTrades: [
            {
              symbol: 'AAPL',
              assetClass: 'equity',
              side: 'BUY',
              quantityOrAmountCents: 5,
              targetWeightPercent: 20,
            },
          ],
        },
        eventId: eventIdA1,
      });
      await trapA.waitForEvent({ timeoutMs: 90_000 });

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionPacketId: `dp-pair-A2-${randomUUID()}`,
          proposedTrades: [
            {
              symbol: 'MSFT',
              assetClass: 'equity',
              side: 'BUY',
              quantityOrAmountCents: 3,
              targetWeightPercent: 15,
            },
          ],
        },
        eventId: eventIdA2,
      });
      await trapA.waitForEvent({ timeoutMs: 90_000 });

      await new Promise((r) => setTimeout(r, 10_000));
      const countA =
        (await countItemsForEventId(tableA, ctxA.tenantId, eventIdA1)) +
        (await countItemsForEventId(tableA, ctxA.tenantId, eventIdA2));

      // ── Run B: event2 (MSFT) then event1 (AAPL), same payloads reversed ──
      const ctxB = await createTestContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();
        const trapB = new EventBusTrap(ctxB);
        await trapB.deploy({
          bus: 'execution',
          detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'],
        });

        const eventIdB2 = `pair-B2-${randomUUID()}`;
        const eventIdB1 = `pair-B1-${randomUUID()}`;

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'execution-ctrl',
          detailType: 'DECISION_APPROVED',
          detail: {
            decisionPacketId: `dp-pair-B2-${randomUUID()}`,
            proposedTrades: [
              {
                symbol: 'MSFT',
                assetClass: 'equity',
                side: 'BUY',
                quantityOrAmountCents: 3,
                targetWeightPercent: 15,
              },
            ],
          },
          eventId: eventIdB2,
        });
        await trapB.waitForEvent({ timeoutMs: 90_000 });

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'execution-ctrl',
          detailType: 'DECISION_APPROVED',
          detail: {
            decisionPacketId: `dp-pair-B1-${randomUUID()}`,
            proposedTrades: [
              {
                symbol: 'AAPL',
                assetClass: 'equity',
                side: 'BUY',
                quantityOrAmountCents: 5,
                targetWeightPercent: 20,
              },
            ],
          },
          eventId: eventIdB1,
        });
        await trapB.waitForEvent({ timeoutMs: 90_000 });

        await new Promise((r) => setTimeout(r, 10_000));
        const countB =
          (await countItemsForEventId(tableB, ctxB.tenantId, eventIdB2)) +
          (await countItemsForEventId(tableB, ctxB.tenantId, eventIdB1));

        // Both runs should produce the same number of records regardless of order
        expect(countA).toBeGreaterThanOrEqual(2);
        expect(countB).toBe(countA);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 360_000);
});
