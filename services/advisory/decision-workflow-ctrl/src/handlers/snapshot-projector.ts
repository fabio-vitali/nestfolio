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
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import {
  PROJECTED_IP_SNAPSHOT_SK,
  PROJECTED_MARKET_SNAPSHOT_SK,
  PROJECTED_LEDGER_SNAPSHOT_SK,
  projectedIpSnapshotPk,
  projectedMarketSnapshotPk,
  projectedLedgerSnapshotPk,
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
    agentOutput: JSON.stringify(agentOutput),
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
      agentOutput: JSON.stringify(agentOutput),
      updatedAt: new Date().toISOString(),
    },
    { pk: projectedMarketSnapshotPk(region), sk: PROJECTED_MARKET_SNAPSHOT_SK },
  );
}

function projectLedgerSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const snapshot = subject.snapshot as
    | { positions: Record<string, unknown>; cashBalanceCents: number; lastEventSequence: number }
    | undefined;
  if (!snapshot) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.snapshot for tenant=${tenantId}`,
    );
  }
  const attrs = {
    tenantId,
    state: JSON.stringify({
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
    }),
    lastEventSequence: snapshot.lastEventSequence,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  // PORTFOLIO_UPDATED represents both create and update semantics in a single
  // event type — use update() (UpdateItem upsert) rather than record() which
  // carries attribute_not_exists(pk) and silently deduplicates the 2nd+ emit.
  return update(
    'LedgerSnapshot',
    attrs,
    {
      overrides: {
        pk: projectedLedgerSnapshotPk(tenantId),
        sk: PROJECTED_LEDGER_SNAPSHOT_SK,
      },
    },
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
  [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectLedgerSnapshot(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'SNAPSHOT_PROJECTION_FAILED',
});
