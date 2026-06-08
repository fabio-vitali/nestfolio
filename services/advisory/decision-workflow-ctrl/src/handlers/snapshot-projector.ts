import {
  materializeToTable,
  projectVersioned,
  parseSubject,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorProfileEventTypes } from '@nestfolio/investor-profile-ctrl/events';
import { InvestorProfileSnapshotSchema } from '@nestfolio/investor-profile-ctrl/contracts';
import { MarketIntelligenceEventTypes } from '@nestfolio/market-intelligence-ctrl/events';
import { MarketSnapshotSchema } from '@nestfolio/market-intelligence-ctrl/contracts';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { PortfolioUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';
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
): WriteIntent | undefined {
  const subject = parseSubject(payload, InvestorProfileSnapshotSchema);
  // Identity is a RequestContext field — it travels in the event context, not the
  // (now dry) producer subject. EventContext extends RequestContext.
  const tenantId = ctx.tenantId;
  const userId = ctx.userId;
  const agentOutput = subject.agentOutput;
  if (!agentOutput) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.agentOutput for tenant=${tenantId} user=${userId}`,
    );
  }
  const version = subject.__version;
  if (typeof version !== 'number') return undefined;
  const fields = {
    tenantId,
    userId,
    agentOutput: JSON.stringify(agentOutput),
    sourceEventId: subject.sourceEventId ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  return projectVersioned('InvestorProfileSnapshot', fields, {
    version,
    overrides: { pk: projectedIpSnapshotPk(tenantId, userId), sk: PROJECTED_IP_SNAPSHOT_SK },
  });
}

function projectMarketSnapshot(payload: EventPayload): WriteIntent | undefined {
  const subject = parseSubject(payload, MarketSnapshotSchema);
  const region = subject.region;
  const agentOutput = subject.agentOutput;
  if (!agentOutput) {
    throw new NotRetryableError(
      `MARKET_SNAPSHOT_UPDATED missing subject.agentOutput for region=${region}`,
    );
  }
  const version = subject.__version;
  if (typeof version !== 'number') return undefined;
  return projectVersioned(
    'MarketSnapshot',
    {
      region,
      agentOutput: JSON.stringify(agentOutput),
      updatedAt: new Date().toISOString(),
    },
    {
      version,
      overrides: { pk: projectedMarketSnapshotPk(region), sk: PROJECTED_MARKET_SNAPSHOT_SK },
    },
  );
}

function projectLedgerSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent | undefined {
  const subject = parseSubject(payload, PortfolioUpdatedSchema);
  // tenantId is a RequestContext field — it travels in the event context, not the
  // (now dry) PORTFOLIO_UPDATED subject. EventContext extends RequestContext.
  const tenantId = ctx.tenantId;
  const snapshot = subject.snapshot;
  if (!snapshot) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.snapshot for tenant=${tenantId}`,
    );
  }
  const version = snapshot.lastEventSequence;
  if (typeof version !== 'number') return undefined;
  const fields = {
    tenantId,
    state: JSON.stringify({
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
    }),
    lastEventSequence: snapshot.lastEventSequence,
    // DRIFT NOTE: PORTFOLIO_UPDATED subjects do not carry sourceEventId.
    // Use ctx.eventId directly as the canonical source reference.
    sourceEventId: ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  // PORTFOLIO_UPDATED is both create + update. projectVersioned's guard
  // (attribute_not_exists(pk) OR __version < :version) makes the first write
  // a create and later writes version-ordered upserts, dropping stale/replayed
  // emits — keyed on the ledger's monotonic lastEventSequence.
  return projectVersioned('LedgerSnapshot', fields, {
    version,
    overrides: {
      pk: projectedLedgerSnapshotPk(tenantId),
      sk: PROJECTED_LEDGER_SNAPSHOT_SK,
    },
  });
}

export const createHandlers = () => ({
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c),
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c),
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
