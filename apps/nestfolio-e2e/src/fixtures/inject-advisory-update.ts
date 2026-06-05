import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

/**
 * Emit a single standard-envelope event onto a domain EventBridge bus, scoped to
 * one consumer via `source: integration-test:<service>` so it passes that
 * consumer's Ingress `$or` filter. Shared by the advisory cycle-event injectors.
 */
async function putScopedEvent(
  ctx: TestContext,
  busDomain: 'advisory' | 'investor',
  source: string,
  detailType: string,
  subject: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ eventId: string }> {
  const busArn = await ctx.ssm.busArn(busDomain);
  const eb = new EventBridgeClient({ region: ctx.region });
  const eventId = `e2e-${randomUUID()}`;
  const now = new Date().toISOString();

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busArn,
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify({ id: eventId, type: detailType, timestamp: now, subject, context }),
        },
      ],
    }),
  );

  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error(
      `putScopedEvent(${detailType}): PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
    );
  }
  return { eventId };
}

const ADVISORY_BFF_SOURCE = 'integration-test:advisory-bff';

function advisoryContext(ctx: TestContext, tenant: FreshTenant): Record<string, unknown> {
  return { tenantId: tenant.tenantId, userId: tenant.userId, region: ctx.region };
}

/**
 * Emit DECISION_CYCLE_STARTED (a decision-workflow-ctrl SF-direct event) scoped
 * to advisory-bff. advisory-bff projects status=GENERATING (v0) onto the
 * DecisionReadModel row before any DecisionPacket exists.
 */
export async function injectDecisionCycleStarted(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_CYCLE_STARTED',
    { decisionId, tenantId: tenant.tenantId, status: 'GENERATING', __version: 0 },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit DECISION_CYCLE_FAILED (same decisionId) scoped to advisory-bff. advisory-bff
 * projects status=FAILED (v1), overwriting the GENERATING (v0) row via the version
 * guard.
 */
export async function injectDecisionCycleFailed(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_CYCLE_FAILED',
    { decisionId, tenantId: tenant.tenantId, status: 'FAILED', __version: 1 },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit a content DECISION_PACKET_CREATED (v1) scoped to advisory-bff. advisory-bff's
 * decision-snapshot transform projects the full packet onto the DecisionReadModel
 * row (AWAITING_CONFIRMATION), overwriting a prior GENERATING (v0). The subject
 * carries a non-empty explanation + one proposedTrade so the transform's
 * degraded-drop guard does not skip it; the proposedTrade matches ProposedTradeInput
 * so the publishDecisionUpdate broadcast does not silently drop.
 */
export async function injectDecisionPacketCreated(
  ctx: TestContext,
  tenant: FreshTenant,
  decisionId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await putScopedEvent(
    ctx,
    'advisory',
    ADVISORY_BFF_SOURCE,
    'DECISION_PACKET_CREATED',
    {
      decisionId,
      tenantId: tenant.tenantId,
      trigger: 'DEPOSIT_DETECTED',
      status: 'AWAITING_CONFIRMATION',
      proposedTrades: [
        {
          symbol: 'VOO',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 100_000,
          targetWeightPercent: 60,
          rationale: 'e2e generating-state scenario',
        },
      ],
      explanation: 'Test recommendation for the e2e generating-state scenario.',
      confirmationRequired: true,
      __version: 1,
      createdAt: now,
      updatedAt: now,
    },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit DEPOSIT_DETECTED on the investor bus, scoped to dashboard-bff. Used by the
 * happy-path journey to prove the `onActivityUpdate` WSS subscription broadcasts
 * an activity row without driving the real agent pipeline (investor-adpt drops the
 * integration-test source, so no Bedrock cost). Keyed by `eventId` so the
 * `waitForActivityByEventId` assertion is unambiguous.
 */
export async function injectDepositDetected(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<{ eventId: string }> {
  return putScopedEvent(
    ctx,
    'investor',
    'integration-test:dashboard-bff',
    'DEPOSIT_DETECTED',
    { tenantId: tenant.tenantId, amountCents: 100_000 },
    advisoryContext(ctx, tenant),
  );
}

/**
 * Emit ADVISORY_STATUS_UPDATED on the investor bus, scoped to dashboard-bff (the
 * same event advisory-bff's aggregate announces, forwarded by investor-adpt). This
 * drives dashboard-bff's P3 projection directly — the dashboard generating/failed +
 * alert-bar UI under test. `pendingDecisionsCount` maps to the producer's
 * `inFlightCount` subject field; `version` must strictly increase per tenant.
 */
export async function injectAdvisoryStatusUpdated(
  ctx: TestContext,
  tenant: FreshTenant,
  fields: {
    pendingDecisionsCount?: number;
    generatingCount?: number;
    failedCount?: number;
    oldestGeneratingAt?: string | null;
    version: number;
  },
): Promise<{ eventId: string }> {
  return putScopedEvent(
    ctx,
    'investor',
    'integration-test:dashboard-bff',
    'ADVISORY_STATUS_UPDATED',
    {
      tenantId: tenant.tenantId,
      inFlightCount: fields.pendingDecisionsCount ?? 0,
      generatingCount: fields.generatingCount ?? 0,
      failedCount: fields.failedCount ?? 0,
      oldestGeneratingAt: fields.oldestGeneratingAt ?? null,
      __version: fields.version,
    },
    advisoryContext(ctx, tenant),
  );
}
