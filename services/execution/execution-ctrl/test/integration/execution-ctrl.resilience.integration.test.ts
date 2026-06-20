import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
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
// Since WS-2 the handler expands each authorizing event into one Order row per
// ProposedTrade, with `orderId = `${eventId}#${index}``. These fixtures inject
// exactly ONE trade per event, so the deterministic orderId is `${eventId}#0`.
// Duplicate-eventId redelivery reproduces the same orderId ⇒ same pk ⇒ the
// record() `attribute_not_exists(pk)` guard dedups it (the idempotency property
// under test). The `T#${tenantId}` partition does not exist here.

/**
 * Count all Order/StagedOrder items written for a given eventId.
 * Queries both possible partitions (Order + StagedOrder) and sums.
 */
async function countItemsForEventId(
  table: TableAssertions,
  tenantId: string,
  eventId: string,
): Promise<number> {
  // WS-2 per-trade expansion: one trade per event ⇒ orderId `${eventId}#0`.
  const orderId = `${eventId}#0`;
  const orderCount = await countItems(
    table,
    'execution-ctrl',
    `Order#${tenantId}#${orderId}`,
  );
  const stagedCount = await countItems(
    table,
    'execution-ctrl',
    `StagedOrder#${tenantId}#${orderId}`,
  );
  return orderCount + stagedCount;
}

// ── Idempotency ──────────────────────────────────────────────────────────
// Each test gets a fresh context (fresh tenant) to prevent cross-test
// contamination. See ledger-ctrl.resilience for the rationale.

describe('execution-ctrl resilience: idempotency', () => {
  it('duplicate DECISION_APPROVED does not create duplicate Order/StagedOrder', async () => {
    const ctx = await createIntegrationTestContext();
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
      const subject = {
        ccId: `idemp-cc-${randomUUID()}`,
        decisionPacketId: `dp-idemp-${randomUUID()}`,
        decisionId: `idemp-dec-${randomUUID()}`,
        taskToken: `fake-task-token-${randomUUID()}`,
        mandateSnapshot: { level: 'ADVISORY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-01T00:00:00.000Z' },
        status: 'COMPLETED' as const,
        result: 'APPROVED' as const,
        violations: [],
        authorityLevel: 'L1' as const,
        // WS-2: an authorizing event must carry proposedTrades or the handler
        // skip()s (nothing to execute). One trade ⇒ one Order row at `${eventId}#0`.
        proposedTrades: [{ symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: 50000, targetWeightPercent: 50, rationale: 'idemp' }],
        sourceEventId: `idemp-src-${randomUUID()}`,
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'execution-ctrl',
        detailType: 'DECISION_APPROVED',
        subject,
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
        subject,
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
  const ctx = await createIntegrationTestContext();
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
      subject: {
        ccId: `pair-${label}-${i}-cc-${randomUUID()}`,
        decisionPacketId: `dp-pair-${label}-${i}-${randomUUID()}`,
        decisionId: `dec-pair-${label}-${i}-${randomUUID()}`,
        taskToken: `fake-task-token-${randomUUID()}`,
        mandateSnapshot: { level: 'ADVISORY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-01T00:00:00.000Z' },
        status: 'COMPLETED' as const,
        result: 'APPROVED' as const,
        violations: [],
        authorityLevel: 'L1' as const,
        // WS-2: carry the trade so the handler expands it into one Order row
        // (`${eventId}#0`) rather than skip()-ing the trade-less event.
        proposedTrades: [{ symbol: order[i].symbol, assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: order[i].quantityOrAmountCents, targetWeightPercent: order[i].targetWeightPercent, rationale: 'pair' }],
        sourceEventId: `pair-${label}-${i}-src-${randomUUID()}`,
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
