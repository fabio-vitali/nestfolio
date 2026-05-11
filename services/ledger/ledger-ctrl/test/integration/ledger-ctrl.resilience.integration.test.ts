import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  snapshotState,
  assertEquivalentState,
  countItems,
} from '@nestfolio/integration-testing';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Poll until at least `minCount` LedgerEntry items exist under the pk. */
async function waitForEntryCount(
  table: TableAssertions,
  tenantId: string,
  streamType: string,
  minCount: number,
  timeoutMs = 60_000,
): Promise<void> {
  const pk = `Account#${tenantId}#${streamType}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await countItems(table, 'ledger-ctrl', pk, 'Event#');
    if (count >= minCount) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitForEntryCount: timeout waiting for ${minCount} entries`);
}

/** Poll until AccountSnapshot exists. */
async function waitForSnapshot(
  table: TableAssertions,
  tenantId: string,
  streamType: string,
  timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
  return table.waitForItem({
    table: 'ledger-ctrl',
    pk: `Account#${tenantId}#${streamType}`,
    sk: 'Snapshot#latest',
    timeoutMs,
  });
}

/**
 * Poll until the Snapshot#latest row's lastEventSequence reaches at least
 * `minSequence`. The reducer stores this field directly from AccountState,
 * so it increments once per processed LedgerEntry.
 */
async function waitForSnapshotWithCount(
  table: TableAssertions,
  tenantId: string,
  streamType: string,
  minSequence: number,
  timeoutMs = 30_000,
): Promise<void> {
  await table.waitForItem({
    table: 'ledger-ctrl',
    pk: `Account#${tenantId}#${streamType}`,
    sk: 'Snapshot#latest',
    timeoutMs,
    predicate: (item) => Number(item['lastEventSequence']) >= minSequence,
    description: `snapshot lastEventSequence >= ${minSequence}`,
  });
}

// ── Idempotency ──────────────────────────────────────────────────────────
// Each test gets a fresh context (fresh tenant) to prevent cross-test
// contamination. LedgerEntry counts are per-tenant, and races between
// the prior test's in-flight writes and the new test's `countBefore`
// sampling would produce false positives.

describe('ledger-ctrl resilience: idempotency', () => {
  it('duplicate ORDER_FILLED does not create duplicate LedgerEntry', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-fill-${randomUUID()}`;
      const payload = {
        orderId: `order-idemp-${randomUUID()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      };

      // First publish
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });
      await waitForEntryCount(table, ctx.tenantId, 'actual', 1);

      const countBefore = await countItems(
        table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
      );

      // Duplicate publish (same eventId)
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });

      // Wait for duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      const countAfter = await countItems(
        table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
      );

      expect(countAfter).toBe(countBefore);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate DEPOSIT_DETECTED does not create duplicate LedgerEntry', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-dep-${randomUUID()}`;
      const payload = {
        depositId: `dep-idemp-${randomUUID()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      };

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'DEPOSIT_DETECTED',
        detail: payload,
        eventId,
      });
      await waitForEntryCount(table, ctx.tenantId, 'actual', 1);

      const countBefore = await countItems(
        table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
      );

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'DEPOSIT_DETECTED',
        detail: payload,
        eventId,
      });

      await new Promise((r) => setTimeout(r, 15_000));

      const countAfter = await countItems(
        table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
      );

      expect(countAfter).toBe(countBefore);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate ORDER_FILLED does not emit duplicate BALANCE_UPDATED CDC', async () => {
    // Separate context to isolate CDC events
    const cdcCtx = await createIntegrationTestContext();
    try {
      const cdcEb = new EventBridgeClient(cdcCtx);
      const trap = new EventBusTrap(cdcCtx);
      await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });

      const eventId = `idemp-cdc-${randomUUID()}`;
      const payload = {
        orderId: `order-cdc-idemp-${randomUUID()}`,
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 5,
        fillPrice: 300.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      };

      // First publish — should produce one BALANCE_UPDATED
      await cdcEb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });

      await trap.waitForEvent({
        detailType: 'BALANCE_UPDATED',
        timeoutMs: 120_000,
      });

      // Duplicate publish
      await cdcEb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });

      // Wait for any duplicate CDC event — match the first-event timeout
      // so a late duplicate can't produce a false negative.
      await new Promise((r) => setTimeout(r, 60_000));

      // Drain remaining events — should be empty. The trap's auto-delete
      // + in-memory dedup ensures we never see the first emission again.
      const remaining = await trap.drain();
      const balanceEvents = remaining.filter((e) => e.detailType === 'BALANCE_UPDATED');
      expect(balanceEvents).toHaveLength(0);
    } finally {
      await cdcCtx.cleanup.runAll();
    }
  }, 360_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('ledger-ctrl resilience: order-agnostic pairwise', () => {
  it('DEPOSIT_DETECTED then ORDER_FILLED vs reverse → same final snapshot', async () => {
    // ── Run A: ordered (deposit first) ──
    const ctxA = await createIntegrationTestContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();

      await ebA.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'DEPOSIT_DETECTED',
        detail: {
          depositId: `dep-pair-A-${randomUUID()}`,
          amountCents: 500_000,
          depositedAt: new Date().toISOString(),
        },
      });
      await waitForSnapshot(tableA, ctxA.tenantId, 'actual');

      await ebA.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: {
          orderId: `fill-pair-A-${randomUUID()}`,
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 10,
          fillPrice: 150.0,
          filledAt: new Date().toISOString(),
          executionMode: 'paper',
        },
      });

      // Poll until snapshot has processed both events (lastEventSequence >= 2)
      await waitForSnapshotWithCount(tableA, ctxA.tenantId, 'actual', 2);
      const snapshotA = await snapshotState(
        tableA, 'ledger-ctrl', `Account#${ctxA.tenantId}#actual`, 'Snapshot#',
      );

      // ── Run B: reversed (fill first) ──
      const ctxB = await createIntegrationTestContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();

        await ebB.putEvent({
          bus: 'ledger',
          targetService: 'ledger-ctrl',
          detailType: 'ORDER_FILLED',
          detail: {
            orderId: `fill-pair-B-${randomUUID()}`,
            symbol: 'AAPL',
            side: 'BUY',
            quantity: 10,
            fillPrice: 150.0,
            filledAt: new Date().toISOString(),
            executionMode: 'paper',
          },
        });
        await waitForSnapshot(tableB, ctxB.tenantId, 'actual');

        await ebB.putEvent({
          bus: 'ledger',
          targetService: 'ledger-ctrl',
          detailType: 'DEPOSIT_DETECTED',
          detail: {
            depositId: `dep-pair-B-${randomUUID()}`,
            amountCents: 500_000,
            depositedAt: new Date().toISOString(),
          },
        });

        // Poll until snapshot has processed both events (lastEventSequence >= 2)
        await waitForSnapshotWithCount(tableB, ctxB.tenantId, 'actual', 2);
        const snapshotB = await snapshotState(
          tableB, 'ledger-ctrl', `Account#${ctxB.tenantId}#actual`, 'Snapshot#',
        );

        // ── Compare ──
        assertEquivalentState(snapshotA, snapshotB);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 300_000);
});

// ── Order-Agnostic: Full Shuffle (Financial-Critical) ────────────────────

describe('ledger-ctrl resilience: order-agnostic full shuffle', () => {
  it('3 events in shuffled order produce same final snapshot as sequential', async () => {
    const events = [
      {
        detailType: 'DEPOSIT_DETECTED',
        detail: (suffix: string) => ({
          depositId: `dep-shuffle-${suffix}-${randomUUID()}`,
          amountCents: 1_000_000,
          depositedAt: new Date().toISOString(),
        }),
      },
      {
        detailType: 'ORDER_FILLED',
        detail: (suffix: string) => ({
          orderId: `fill1-shuffle-${suffix}-${randomUUID()}`,
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 5,
          fillPrice: 180.0,
          filledAt: new Date().toISOString(),
          executionMode: 'paper',
        }),
      },
      {
        detailType: 'ORDER_FILLED',
        detail: (suffix: string) => ({
          orderId: `fill2-shuffle-${suffix}-${randomUUID()}`,
          symbol: 'MSFT',
          side: 'BUY',
          quantity: 3,
          fillPrice: 420.0,
          filledAt: new Date().toISOString(),
          executionMode: 'paper',
        }),
      },
    ];

    // ── Run A: sequential order ──
    const ctxA = await createIntegrationTestContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();

      for (let i = 0; i < events.length; i++) {
        await ebA.putEvent({
          bus: 'ledger',
          targetService: 'ledger-ctrl',
          detailType: events[i].detailType,
          detail: events[i].detail('A'),
        });
        // Poll until this event is ingested before sending the next
        await waitForEntryCount(tableA, ctxA.tenantId, 'actual', i + 1);
      }
      // Poll until snapshot has incorporated all 3 entries (lastEventSequence >= 3)
      await waitForSnapshotWithCount(tableA, ctxA.tenantId, 'actual', 3);
      const snapshotA = await snapshotState(
        tableA, 'ledger-ctrl', `Account#${ctxA.tenantId}#actual`, 'Snapshot#',
      );

      // ── Run B: shuffled order [2, 0, 1] → MSFT fill, deposit, AAPL fill ──
      const shuffled = [events[2], events[0], events[1]];
      const ctxB = await createIntegrationTestContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();

        for (let i = 0; i < shuffled.length; i++) {
          await ebB.putEvent({
            bus: 'ledger',
            targetService: 'ledger-ctrl',
            detailType: shuffled[i].detailType,
            detail: shuffled[i].detail('B'),
          });
          // Poll until this event is ingested before sending the next
          await waitForEntryCount(tableB, ctxB.tenantId, 'actual', i + 1);
        }
        // Poll until snapshot has incorporated all 3 entries (lastEventSequence >= 3)
        await waitForSnapshotWithCount(tableB, ctxB.tenantId, 'actual', 3);
        const snapshotB = await snapshotState(
          tableB, 'ledger-ctrl', `Account#${ctxB.tenantId}#actual`, 'Snapshot#',
        );

        // ── Compare ──
        assertEquivalentState(snapshotA, snapshotB);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 360_000);
});
