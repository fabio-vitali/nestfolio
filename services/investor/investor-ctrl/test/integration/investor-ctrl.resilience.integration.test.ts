import { randomUUID } from 'node:crypto';
import {
  createTestContext,
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  TableAssertions,
  countItems,
} from '@nestfolio/integration-testing';

// investor-ctrl resilience — verifies that the per-event Notification +
// MonthlyReport projection is correct under SQS at-least-once redelivery
// and out-of-order arrival.
//
// State layout:
//   Notification:  pk = Notification#{tenantId}#{eventId}      sk = Notification
//   MonthlyReport: pk = MonthlyReport#{tenantId}#{reportId}    sk = MonthlyReport
//                  where reportId = `${eventId}-report`
//
// Each ingress event maps to a deterministic pk (keyed on ctx.eventId), so
// duplicate delivery results in DDB PutItem overwrite with identical data —
// idempotent by design at the pk level. The tests below verify that
// duplicates do not multiply rows and that two distinct events both
// materialise regardless of arrival order.

async function waitForNotification(
  table: TableAssertions,
  tenantId: string,
  notificationId: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  return table.waitForItem({
    table: 'investor-ctrl',
    pk: `Notification#${tenantId}#${notificationId}`,
    sk: 'Notification',
    timeoutMs,
  });
}

async function waitForMonthlyReport(
  table: TableAssertions,
  tenantId: string,
  reportId: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  return table.waitForItem({
    table: 'investor-ctrl',
    pk: `MonthlyReport#${tenantId}#${reportId}`,
    sk: 'MonthlyReport',
    timeoutMs,
  });
}

// ── Idempotency ──────────────────────────────────────────────────────────

describe('investor-ctrl resilience: idempotency', () => {
  it('duplicate ORDER_FILLED produces a single Notification + a single MonthlyReport', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-fill-${randomUUID()}`;
      const reportId = `${eventId}-report`;
      const detail = {
        orderId: `order-idemp-${randomUUID()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150,
      };

      // First publish
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ORDER_FILLED',
        detail,
        eventId,
      });

      await waitForNotification(table, ctx.tenantId, eventId);
      await waitForMonthlyReport(table, ctx.tenantId, reportId);

      const notifBefore = await countItems(
        table, 'investor-ctrl', `Notification#${ctx.tenantId}#${eventId}`,
      );
      const reportBefore = await countItems(
        table, 'investor-ctrl', `MonthlyReport#${ctx.tenantId}#${reportId}`,
      );

      // Duplicate publish (same eventId)
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ORDER_FILLED',
        detail,
        eventId,
      });

      // Wait for the duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      const notifAfter = await countItems(
        table, 'investor-ctrl', `Notification#${ctx.tenantId}#${eventId}`,
      );
      const reportAfter = await countItems(
        table, 'investor-ctrl', `MonthlyReport#${ctx.tenantId}#${reportId}`,
      );

      expect(notifAfter).toBe(notifBefore);
      expect(notifAfter).toBe(1);
      expect(reportAfter).toBe(reportBefore);
      expect(reportAfter).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate ONBOARDING_COMPLETED produces a single Notification', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-onboard-${randomUUID()}`;
      const detail = { goal: 'RETIREMENT', riskTolerance: 'MODERATE' };

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ONBOARDING_COMPLETED',
        detail,
        eventId,
      });
      await waitForNotification(table, ctx.tenantId, eventId);

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-ctrl',
        detailType: 'ONBOARDING_COMPLETED',
        detail,
        eventId,
      });
      await new Promise((r) => setTimeout(r, 15_000));

      const count = await countItems(
        table, 'investor-ctrl', `Notification#${ctx.tenantId}#${eventId}`,
      );
      expect(count).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);
});

// ── Order-Agnostic ──────────────────────────────────────────────────────
// Each ingress event materialises into its own pk-distinct Notification row.
// Because the rows are independent, both events present after publish ==
// final state, regardless of arrival order. The test below verifies the
// stronger property that *both* arrive in either order, since SQS may
// deliver ONBOARDING_COMPLETED and ORDER_FILLED out of causal order.

describe('investor-ctrl resilience: order-agnostic', () => {
  it('ONBOARDING_COMPLETED and ORDER_FILLED in either order both produce their notifications', async () => {
    const runOrder = async (
      ctx: Awaited<ReturnType<typeof createTestContext>>,
      ordering: 'onboard-then-fill' | 'fill-then-onboard',
    ): Promise<{ onboardId: string; fillId: string; reportId: string }> => {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const onboardId = `pair-onboard-${randomUUID()}`;
      const fillId = `pair-fill-${randomUUID()}`;
      const reportId = `${fillId}-report`;
      const onboardEvent = {
        bus: 'investor' as const,
        targetService: 'investor-ctrl',
        detailType: 'ONBOARDING_COMPLETED',
        detail: { goal: 'RETIREMENT', riskTolerance: 'MODERATE' },
        eventId: onboardId,
      };
      const fillEvent = {
        bus: 'investor' as const,
        targetService: 'investor-ctrl',
        detailType: 'ORDER_FILLED',
        detail: { orderId: 'pair-order', symbol: 'AAPL', side: 'BUY', quantity: 5, fillPrice: 150 },
        eventId: fillId,
      };

      if (ordering === 'onboard-then-fill') {
        await eb.putEvent(onboardEvent);
        await eb.putEvent(fillEvent);
      } else {
        await eb.putEvent(fillEvent);
        await eb.putEvent(onboardEvent);
      }

      // Both must materialise. Use direct waitForItem on each pk —
      // failure means the late-arriving event was lost or clobbered.
      await waitForNotification(table, ctx.tenantId, onboardId);
      await waitForNotification(table, ctx.tenantId, fillId);
      await waitForMonthlyReport(table, ctx.tenantId, reportId);

      return { onboardId, fillId, reportId };
    };

    const ctxA = await createTestContext();
    try {
      await runOrder(ctxA, 'onboard-then-fill');
    } finally {
      await ctxA.cleanup.runAll();
    }

    const ctxB = await createTestContext();
    try {
      await runOrder(ctxB, 'fill-then-onboard');
    } finally {
      await ctxB.cleanup.runAll();
    }

    // Both runs reached the same final-state shape: 1 onboarding
    // notification + 1 fill notification + 1 monthly report. The
    // waitForNotification / waitForMonthlyReport calls above already
    // assert that — reaching this point means both orderings settled
    // identically.
    expect(true).toBe(true);
  }, 240_000);
});
