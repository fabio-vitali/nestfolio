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
//
// Runs A and B execute in parallel — each has its own tenant, trap, and
// event sequence. Parallelism halves the wall-clock time and avoids the
// 360s timeout that sequential dual-context deployment caused.

async function runPairwiseSequence(
  order: Array<{ symbol: string; quantityOrAmountCents: number; targetWeightPercent: number }>,
  label: string,
): Promise<{ count: number; cleanup: () => Promise<void> }> {
  const ctx = await createTestContext();
  const eb = new EventBridgeClient(ctx);
  const table = new TableAssertions(ctx);
  table.registerCleanup();
  const trap = new EventBusTrap(ctx);
  await trap.deploy({
    bus: 'execution',
    detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED'],
  });

  const eventIds: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const eventId = `pair-${label}-${i}-${randomUUID()}`;
    eventIds.push(eventId);

    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `dp-pair-${label}-${i}-${randomUUID()}`,
        proposedTrades: [
          {
            symbol: order[i].symbol,
            assetClass: 'equity',
            side: 'BUY',
            quantityOrAmountCents: order[i].quantityOrAmountCents,
            targetWeightPercent: order[i].targetWeightPercent,
          },
        ],
      },
      eventId,
    });
    await trap.waitForEvent({ timeoutMs: 90_000 });
  }

  await new Promise((r) => setTimeout(r, 10_000));

  let count = 0;
  for (const eventId of eventIds) {
    count += await countItemsForEventId(table, ctx.tenantId, eventId);
  }

  return { count, cleanup: () => ctx.cleanup.runAll() };
}

describe('execution-ctrl resilience: order-agnostic pairwise', () => {
  it('two DECISION_APPROVED events in either order produce same record set', async () => {
    const tradeA = { symbol: 'AAPL', quantityOrAmountCents: 5, targetWeightPercent: 20 };
    const tradeB = { symbol: 'MSFT', quantityOrAmountCents: 3, targetWeightPercent: 15 };

    // Run both orderings in parallel — independent tenants, independent traps
    const [resultA, resultB] = await Promise.all([
      runPairwiseSequence([tradeA, tradeB], 'A'),
      runPairwiseSequence([tradeB, tradeA], 'B'),
    ]);

    try {
      // Both runs should produce the same number of records regardless of order
      expect(resultA.count).toBeGreaterThanOrEqual(2);
      expect(resultB.count).toBe(resultA.count);
    } finally {
      await Promise.all([resultA.cleanup(), resultB.cleanup()]);
    }
  }, 360_000);
});
