import { randomUUID } from 'node:crypto';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  countItems,
} from '@nestfolio/integration-testing';

// ── Helpers ──────────────────────────────────────────────────────────────
//
// broker-ctrl stores entities under:
//   ExecutionMode    → pk: `ExecutionMode#${tenantId}`                       sk: 'ExecutionMode'
//   NormalizedEvent  → pk: `NormalizedEvent#${tenantId}#${transferId}`       sk: 'DEPOSIT_DETECTED' | 'WITHDRAWAL_COMPLETED' | 'TRANSFER_FAILED'
//
// ExecutionMode idempotency: duplicate EXECUTION_MODE_CHANGED events must not
// produce multiple DDB items. Because the PK is tenant-scoped (no eventId in
// the key), a successful duplicate ALWAYS overwrites via record(). What we
// verify is that exactly ONE row lives under that PK regardless of how many
// duplicate events we publish.
//
// NormalizedEvent idempotency: the PK is keyed on the deposit/withdrawal ID
// from the event payload (not eventId). Duplicates from the same payload
// therefore share a PK and the second write overwrites instead of inserting.

// ── Idempotency: ExecutionMode ───────────────────────────────────────────

describe('broker-ctrl resilience: idempotency', () => {
  it('duplicate EXECUTION_MODE_CHANGED does not create duplicate ExecutionMode record', async () => {
    const ctx = await createIntegrationContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-mode-${randomUUID()}`;
      const payload = { mode: 'live' };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: payload,
        eventId,
      });

      // Wait for the ExecutionMode row to land
      const firstItem = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 90_000,
      });
      expect(firstItem['__typename']).toBe('ExecutionMode');
      expect(firstItem['mode']).toBe('live');

      // Duplicate publish (same eventId, same payload)
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      // Assert: still exactly one ExecutionMode row for this tenant
      const count = await countItems(
        table,
        'broker-ctrl',
        `ExecutionMode#${ctx.tenantId}`,
      );
      expect(count).toBe(1);

      const finalItem = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 30_000,
      });
      expect(finalItem['mode']).toBe('live');
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate SIM_DEPOSIT_COMPLETED does not create duplicate NormalizedEvent', async () => {
    const ctx = await createIntegrationContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'execution',
        detailType: ['DEPOSIT_DETECTED', 'WITHDRAWAL_COMPLETED', 'TRANSFER_FAILED'],
      });

      const eventId = `idemp-deposit-${randomUUID()}`;
      const depositId = `dep-idemp-${randomUUID()}`;
      const payload = {
        depositId,
        amountCents: 100000,
        currency: 'USD',
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        detail: payload,
        eventId,
      });

      // Wait for NormalizedEvent row to land
      const firstItem = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `NormalizedEvent#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_DETECTED',
        timeoutMs: 90_000,
      });
      expect(firstItem['__typename']).toBe('NormalizedEvent');
      expect(firstItem['amount']).toBe(100000);

      // Wait for the first DEPOSIT_DETECTED CDC event
      await trap.waitForEvent({
        detailType: 'DEPOSIT_DETECTED',
        timeoutMs: 60_000,
      });

      // Drain any residual buffered events so the trap starts clean
      await trap.drain();

      // Duplicate publish (same eventId + payload)
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        detail: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 20_000));

      // Assert: still exactly one NormalizedEvent row for this depositId
      const count = await countItems(
        table,
        'broker-ctrl',
        `NormalizedEvent#${ctx.tenantId}#${depositId}`,
      );
      expect(count).toBe(1);

      // Assert: no additional DEPOSIT_DETECTED CDC events emitted after drain.
      // A duplicate row write would trigger another CDC event; the trap would
      // then capture it and drain would return it.
      const residual = await trap.drain();
      const extraDeposit = residual.filter(
        (e) => e.detailType === 'DEPOSIT_DETECTED',
      );
      expect(extraDeposit.length).toBe(0);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 240_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('broker-ctrl resilience: order-agnostic pairwise', () => {
  it('SIM_DEPOSIT_COMPLETED then SIM_WITHDRAWAL_COMPLETED vs reverse produces same record set', async () => {
    // ── Run A: deposit then withdrawal ──
    const ctxA = await createIntegrationContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();
      const trapA = new EventBusTrap(ctxA);
      await trapA.deploy({
        bus: 'execution',
        detailType: ['DEPOSIT_DETECTED', 'WITHDRAWAL_COMPLETED', 'TRANSFER_FAILED'],
      });

      const depositIdA = `pair-A-dep-${randomUUID()}`;
      const withdrawalIdA = `pair-A-wd-${randomUUID()}`;

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        detail: {
          depositId: depositIdA,
          amountCents: 100000,
          currency: 'USD',
        },
        eventId: `pair-A-dep-evt-${randomUUID()}`,
      });
      await trapA.waitForEvent({
        detailType: 'DEPOSIT_DETECTED',
        timeoutMs: 90_000,
      });

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_WITHDRAWAL_COMPLETED',
        detail: {
          withdrawalId: withdrawalIdA,
          amount: 50000,
          currency: 'USD',
        },
        eventId: `pair-A-wd-evt-${randomUUID()}`,
      });
      await trapA.waitForEvent({
        detailType: 'WITHDRAWAL_COMPLETED',
        timeoutMs: 90_000,
      });

      await new Promise((r) => setTimeout(r, 10_000));

      const depCountA = await countItems(
        tableA,
        'broker-ctrl',
        `NormalizedEvent#${ctxA.tenantId}#${depositIdA}`,
      );
      const wdCountA = await countItems(
        tableA,
        'broker-ctrl',
        `NormalizedEvent#${ctxA.tenantId}#${withdrawalIdA}`,
      );
      const countA = depCountA + wdCountA;

      // ── Run B: withdrawal then deposit ──
      const ctxB = await createIntegrationContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();
        const trapB = new EventBusTrap(ctxB);
        await trapB.deploy({
          bus: 'execution',
          detailType: ['DEPOSIT_DETECTED', 'WITHDRAWAL_COMPLETED', 'TRANSFER_FAILED'],
        });

        const depositIdB = `pair-B-dep-${randomUUID()}`;
        const withdrawalIdB = `pair-B-wd-${randomUUID()}`;

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'SIM_WITHDRAWAL_COMPLETED',
          detail: {
            withdrawalId: withdrawalIdB,
            amount: 50000,
            currency: 'USD',
          },
          eventId: `pair-B-wd-evt-${randomUUID()}`,
        });
        await trapB.waitForEvent({
          detailType: 'WITHDRAWAL_COMPLETED',
          timeoutMs: 90_000,
        });

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'SIM_DEPOSIT_COMPLETED',
          detail: {
            depositId: depositIdB,
            amountCents: 100000,
            currency: 'USD',
          },
          eventId: `pair-B-dep-evt-${randomUUID()}`,
        });
        await trapB.waitForEvent({
          detailType: 'DEPOSIT_DETECTED',
          timeoutMs: 90_000,
        });

        await new Promise((r) => setTimeout(r, 10_000));

        const depCountB = await countItems(
          tableB,
          'broker-ctrl',
          `NormalizedEvent#${ctxB.tenantId}#${depositIdB}`,
        );
        const wdCountB = await countItems(
          tableB,
          'broker-ctrl',
          `NormalizedEvent#${ctxB.tenantId}#${withdrawalIdB}`,
        );
        const countB = depCountB + wdCountB;

        // Both runs should yield exactly 2 NormalizedEvent rows (1 deposit + 1 withdrawal)
        expect(countA).toBe(2);
        expect(countB).toBe(2);
        expect(depCountA).toBe(1);
        expect(wdCountA).toBe(1);
        expect(depCountB).toBe(1);
        expect(wdCountB).toBe(1);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 420_000);
});
