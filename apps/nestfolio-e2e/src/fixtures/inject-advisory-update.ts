import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

/**
 * Emit a real DEPOSIT_DETECTED event on the investor EventBridge bus so that
 * the full advisory pipeline fires: advisory-adpt forwards the event to the
 * advisory bus, decision-workflow-ctrl starts the SF orchestration, the agent
 * pipeline runs, and both advisory-bff and dashboard-bff project the in-flight
 * and completed states via CDC.
 *
 * Source is `integration-test:nestfolio-e2e` so advisory-adpt's `$or` Ingress
 * filter (non-integration-test OR integration-test:<consumer>) passes it
 * through. The `detailType` DEPOSIT_DETECTED is the production trigger that
 * starts the decision workflow via investor-adpt → advisory bus.
 */
export async function injectAdvisoryTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<void> {
  const busArn = await ctx.ssm.busArn('investor');
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: `integration-test:nestfolio-e2e`,
          DetailType: 'DEPOSIT_DETECTED',
          Detail: JSON.stringify({
            id: eventId,
            type: 'DEPOSIT_DETECTED',
            timestamp: now,
            subject: {
              tenantId: tenant.tenantId,
              amountCents: 100_000,
            },
            context: {
              tenantId: tenant.tenantId,
              userId: tenant.userId,
              region: ctx.region,
            },
          }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `injectAdvisoryTriggerEvent: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
}

/**
 * Emit DEPOSIT_DETECTED directly on the advisory EventBridge bus, scoped to
 * advisory-bff only (source `integration-test:advisory-bff`).
 *
 * Use when a test needs advisory-bff to increment `inFlightCount` without
 * starting the full agent pipeline. The advisory-bff Ingress `$or` rule passes
 * events whose source matches the prefix `integration-test:advisory-bff`.
 *
 * NOTE: This bypasses advisory-adpt, decision-workflow-ctrl, and dashboard-bff —
 * advisory-bff increments AdvisoryStatus.inFlightCount and emits
 * ADVISORY_STATUS_UPDATED, but no Step Functions execution starts and
 * dashboard-bff is not notified.
 */
export async function injectAdvisoryBffTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<void> {
  const busArn = await ctx.ssm.busArn('advisory');
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: `integration-test:advisory-bff`,
          DetailType: 'DEPOSIT_DETECTED',
          Detail: JSON.stringify({
            id: eventId,
            type: 'DEPOSIT_DETECTED',
            timestamp: now,
            subject: {
              tenantId: tenant.tenantId,
              amountCents: 100_000,
            },
            context: {
              tenantId: tenant.tenantId,
              userId: tenant.userId,
              region: ctx.region,
            },
          }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `injectAdvisoryBffTriggerEvent: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
}

/**
 * Emit DEPOSIT_DETECTED on the investor EventBridge bus, scoped to dashboard-bff
 * only (source `integration-test:dashboard-bff`).
 *
 * Use when a test needs dashboard-bff to increment `pendingDecisionsCount` (and
 * therefore trigger `hasAdvisoryAlerts()` → advisory-alert-bar visible) without
 * starting the full advisory pipeline. The dashboard-bff Ingress `$or` rule
 * passes events whose source matches the prefix `integration-test:dashboard-bff`.
 *
 * NOTE: This bypasses advisory-adpt and advisory-bff — only dashboard-bff is
 * notified. The dashboard WSS subscription (`onDashboardUpdate`) receives the
 * broadcast when dashboard-bff's CDC publisher fires after the DDB write.
 */
export async function injectDashboardBffTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<void> {
  const busArn = await ctx.ssm.busArn('investor');
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: `integration-test:dashboard-bff`,
          DetailType: 'DEPOSIT_DETECTED',
          Detail: JSON.stringify({
            id: eventId,
            type: 'DEPOSIT_DETECTED',
            timestamp: now,
            subject: {
              tenantId: tenant.tenantId,
              amountCents: 100_000,
            },
            context: {
              tenantId: tenant.tenantId,
              userId: tenant.userId,
              region: ctx.region,
            },
          }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `injectDashboardBffTriggerEvent: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
}
