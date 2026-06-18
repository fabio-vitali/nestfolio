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
// broker-ctrl stores entities under:
//   ExecutionMode  → pk: `ExecutionMode#${tenantId}`                  sk: 'ExecutionMode'
//   FundingEvent   → pk: `Funding#${tenantId}#${transferId}`          sk: '<lifecycle event name>'
//                    (DEPOSIT_REQUESTED | DEPOSIT_DETECTED | DEPOSIT_SETTLED |
//                     DEPOSIT_FAILED | WITHDRAWAL_REQUESTED | WITHDRAWAL_SETTLED |
//                     WITHDRAWAL_FAILED). One immutable carrier row per transition;
//                    CDC `field:'sk', passthrough` re-emits sk as the bus event.
//
// ExecutionMode idempotency: duplicate EXECUTION_MODE_CHANGED events must not
// produce multiple DDB items. Because the PK is tenant-scoped (no eventId in
// the key), a successful duplicate ALWAYS overwrites via record(). What we
// verify is that exactly ONE row lives under that PK regardless of how many
// duplicate events we publish.
//
// FundingEvent idempotency: the PK is keyed on the deposit/withdrawal ID from
// the event payload (not eventId) and the SK on the lifecycle event name.
// Duplicates from the same payload therefore share pk+sk and the second write
// overwrites instead of inserting. A SIM_DEPOSIT_COMPLETED produces two carrier
// rows (DEPOSIT_DETECTED + DEPOSIT_SETTLED) under the same pk.

// ── Idempotency: ExecutionMode ───────────────────────────────────────────

describe('broker-ctrl resilience: idempotency', () => {
  it('duplicate EXECUTION_MODE_CHANGED does not create duplicate ExecutionMode record', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-mode-${randomUUID()}`;
      // ExecutionModeChangedSchema: {changeId, fromMode, toMode, changedAt}.
      // mode-listener caches mode = toMode. Single shared const → both the first
      // publish and the duplicate carry the identical subject (same changeId) so the
      // dedup is exercised on a byte-identical event (dedup is eventId-keyed).
      const payload = {
        changeId: randomUUID(),
        fromMode: 'simulation' as const,
        toMode: 'live' as const,
        changedAt: new Date().toISOString(),
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED' as const,
        subject: payload,
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
        detailType: 'EXECUTION_MODE_CHANGED' as const,
        subject: payload,
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

  it('duplicate SIM_DEPOSIT_COMPLETED does not create duplicate FundingEvent carriers', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'execution',
        detailType: ['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED', 'WITHDRAWAL_SETTLED'],
      });

      const eventId = `idemp-deposit-${randomUUID()}`;
      const depositId = `dep-idemp-${randomUUID()}`;
      const payload = {
        depositId,
        amountCents: 100000,
        currency: 'USD',
        sourceEventId: `src-${randomUUID()}`,
        timestamp: new Date().toISOString(),
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        subject: payload,
        eventId,
      });

      // Wait for both FundingEvent carrier rows to land
      const detected = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_DETECTED',
        timeoutMs: 90_000,
      });
      expect(detected['__typename']).toBe('FundingEvent');
      expect(detected['amountCents']).toBe(100000);
      expect(detected['transferId']).toBe(depositId);
      await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_SETTLED',
        timeoutMs: 90_000,
      });

      // Wait for the first DEPOSIT_SETTLED CDC event
      await trap.waitForEvent({
        detailType: 'DEPOSIT_SETTLED',
        timeoutMs: 60_000,
      });

      // Drain any residual buffered events so the trap starts clean
      await trap.drain();

      // Duplicate publish (same eventId + payload)
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        subject: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 20_000));

      // Assert: still exactly two FundingEvent rows for this depositId
      // (DEPOSIT_DETECTED + DEPOSIT_SETTLED), no extras from the duplicate.
      const count = await countItems(
        table,
        'broker-ctrl',
        `Funding#${ctx.tenantId}#${depositId}`,
      );
      expect(count).toBe(2);

      // Assert: no additional DEPOSIT_SETTLED CDC events emitted after drain.
      // A duplicate row write would trigger another CDC event; the trap would
      // then capture it and drain would return it.
      const residual = await trap.drain();
      const extraSettled = residual.filter(
        (e) => e.detailType === 'DEPOSIT_SETTLED',
      );
      expect(extraSettled.length).toBe(0);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 240_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('broker-ctrl resilience: order-agnostic pairwise', () => {
  it('SIM_DEPOSIT_COMPLETED then SIM_WITHDRAWAL_COMPLETED vs reverse produces same FundingEvent carrier set', async () => {
    // ── Run A: deposit then withdrawal ──
    const ctxA = await createIntegrationTestContext();
    try {
      const ebA = new EventBridgeClient(ctxA);
      const tableA = new TableAssertions(ctxA);
      tableA.registerCleanup();
      const trapA = new EventBusTrap(ctxA);
      await trapA.deploy({
        bus: 'execution',
        detailType: ['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED', 'WITHDRAWAL_SETTLED'],
      });

      const depositIdA = `pair-A-dep-${randomUUID()}`;
      const withdrawalIdA = `pair-A-wd-${randomUUID()}`;

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        subject: {
          depositId: depositIdA,
          amountCents: 100000,
          currency: 'USD',
          sourceEventId: `src-${randomUUID()}`,
          timestamp: new Date().toISOString(),
        },
        eventId: `pair-A-dep-evt-${randomUUID()}`,
      });
      await trapA.waitForEvent({
        detailType: 'DEPOSIT_SETTLED',
        timeoutMs: 90_000,
      });

      await ebA.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_WITHDRAWAL_COMPLETED',
        subject: {
          // SimWithdrawalCompletedSchema carries `amount` (DOLLARS), no amountCents/currency.
          withdrawalId: withdrawalIdA,
          amount: 500,
          sourceEventId: `src-${randomUUID()}`,
          timestamp: new Date().toISOString(),
        },
        eventId: `pair-A-wd-evt-${randomUUID()}`,
      });
      await trapA.waitForEvent({
        detailType: 'WITHDRAWAL_SETTLED',
        timeoutMs: 90_000,
      });

      await new Promise((r) => setTimeout(r, 10_000));

      // A SIM deposit completion writes two carriers (detected + settled); a SIM
      // withdrawal completion writes one (settled).
      const depCountA = await countItems(
        tableA,
        'broker-ctrl',
        `Funding#${ctxA.tenantId}#${depositIdA}`,
      );
      const wdCountA = await countItems(
        tableA,
        'broker-ctrl',
        `Funding#${ctxA.tenantId}#${withdrawalIdA}`,
      );
      const countA = depCountA + wdCountA;

      // ── Run B: withdrawal then deposit ──
      const ctxB = await createIntegrationTestContext();
      try {
        const ebB = new EventBridgeClient(ctxB);
        const tableB = new TableAssertions(ctxB);
        tableB.registerCleanup();
        const trapB = new EventBusTrap(ctxB);
        await trapB.deploy({
          bus: 'execution',
          detailType: ['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED', 'WITHDRAWAL_SETTLED'],
        });

        const depositIdB = `pair-B-dep-${randomUUID()}`;
        const withdrawalIdB = `pair-B-wd-${randomUUID()}`;

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'SIM_WITHDRAWAL_COMPLETED',
          subject: {
            // SimWithdrawalCompletedSchema carries `amount` (DOLLARS), no amountCents/currency.
            withdrawalId: withdrawalIdB,
            amount: 500,
            sourceEventId: `src-${randomUUID()}`,
            timestamp: new Date().toISOString(),
          },
          eventId: `pair-B-wd-evt-${randomUUID()}`,
        });
        await trapB.waitForEvent({
          detailType: 'WITHDRAWAL_SETTLED',
          timeoutMs: 90_000,
        });

        await ebB.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'SIM_DEPOSIT_COMPLETED',
          subject: {
            depositId: depositIdB,
            amountCents: 100000,
            currency: 'USD',
            sourceEventId: `src-${randomUUID()}`,
            timestamp: new Date().toISOString(),
          },
          eventId: `pair-B-dep-evt-${randomUUID()}`,
        });
        await trapB.waitForEvent({
          detailType: 'DEPOSIT_SETTLED',
          timeoutMs: 90_000,
        });

        await new Promise((r) => setTimeout(r, 10_000));

        const depCountB = await countItems(
          tableB,
          'broker-ctrl',
          `Funding#${ctxB.tenantId}#${depositIdB}`,
        );
        const wdCountB = await countItems(
          tableB,
          'broker-ctrl',
          `Funding#${ctxB.tenantId}#${withdrawalIdB}`,
        );
        const countB = depCountB + wdCountB;

        // Both runs should yield the same carrier set regardless of arrival
        // order: 2 deposit carriers (detected + settled) + 1 withdrawal carrier
        // (settled) = 3 total.
        expect(countA).toBe(3);
        expect(countB).toBe(3);
        expect(depCountA).toBe(2);
        expect(wdCountA).toBe(1);
        expect(depCountB).toBe(2);
        expect(wdCountB).toBe(1);
      } finally {
        await ctxB.cleanup.runAll();
      }
    } finally {
      await ctxA.cleanup.runAll();
    }
  }, 420_000);
});
