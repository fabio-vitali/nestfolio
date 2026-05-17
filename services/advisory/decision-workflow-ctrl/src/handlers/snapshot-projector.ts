import {
  materializeToTable,
  record,
  update,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorProfileEventTypes } from '@nestfolio/investor-profile-ctrl/events';
import { MarketIntelligenceEventTypes } from '@nestfolio/market-intelligence-ctrl/events';
import {
  PROJECTED_IP_SNAPSHOT_SK,
  PROJECTED_MARKET_SNAPSHOT_SK,
  projectedIpSnapshotPk,
  projectedMarketSnapshotPk,
} from '../repositories/projected-snapshot.repository';

function projectIpSnapshot(
  payload: EventPayload,
  ctx: EventContext,
  mode: 'insert' | 'update',
): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.agentOutput for tenant=${tenantId} user=${userId}`,
    );
  }
  const attrs = {
    tenantId,
    userId,
    agentOutput,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  const key = { pk: projectedIpSnapshotPk(tenantId, userId), sk: PROJECTED_IP_SNAPSHOT_SK };
  return mode === 'insert'
    ? record('InvestorProfileSnapshot', attrs, key)
    : update('InvestorProfileSnapshot', attrs, { overrides: key });
}

function projectMarketSnapshot(payload: EventPayload): WriteIntent {
  const subject = payload.subject ?? {};
  const region = (subject.region as string) ?? 'us-east-1';
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(
      `MARKET_SNAPSHOT_UPDATED missing subject.agentOutput for region=${region}`,
    );
  }
  return record(
    'MarketSnapshot',
    {
      region,
      agentOutput,
      updatedAt: new Date().toISOString(),
    },
    { pk: projectedMarketSnapshotPk(region), sk: PROJECTED_MARKET_SNAPSHOT_SK },
  );
}

export const createHandlers = () => ({
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c, 'insert'),
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c, 'update'),
  [MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED]: async (
    p: EventPayload,
    _c: EventContext,
  ) => projectMarketSnapshot(p),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'SNAPSHOT_PROJECTION_FAILED',
});
