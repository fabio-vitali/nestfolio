import { materializeToTable, requireEnv, type EventPayload, type EventContext, type WriteIntent } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier, type FundingDirection } from '../domain/funding';
import { FundingRepository } from '../repositories/funding.repository';

type Deps = { getRequested: FundingRepository['getRequested'] };

async function carryForward(
  deps: Deps,
  tenantId: string,
  transferId: string,
  requestedEventName: string,
  fallback: { amountCents: number; currency: string; userId: string; initiatedAt: string },
) {
  const req = await deps.getRequested(tenantId, transferId, requestedEventName);
  return {
    amountCents: req?.amountCents ?? fallback.amountCents,
    currency: req?.currency ?? fallback.currency,
    userId: req?.userId ?? fallback.userId,
    initiatedAt: req?.initiatedAt ?? fallback.initiatedAt,
  };
}

function depositCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
    const s = payload.subject as Record<string, unknown>;
    // SIM completion carries `depositId`; ALPACA completion carries `transferId`.
    const transferId = (s.depositId as string) ?? (s.transferId as string) ?? ctx.eventId;
    const cf = await carryForward(deps, ctx.tenantId, transferId, BrokerCtrlEventTypes.DEPOSIT_REQUESTED, {
      amountCents: s.amountCents as number,
      currency: (s.currency as string) ?? 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    const executionMode = ctx.eventType === BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED ? 'simulation' : 'live';
    const base = {
      direction: 'DEPOSIT' as FundingDirection,
      transferId,
      tenantId: ctx.tenantId,
      userId: cf.userId,
      region: ctx.region,
      amountCents: cf.amountCents,
      currency: cf.currency,
      executionMode,
      initiatedAt: cf.initiatedAt,
      detectedAt: ctx.timestamp,
      timestamp: ctx.timestamp,
    } as const;
    return [
      fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_DETECTED, status: 'detected' }),
      fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_SETTLED, status: 'settled', settledAt: ctx.timestamp }),
    ];
  };
}

function withdrawalCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = payload.subject as Record<string, unknown>;
    // SIM completion carries `withdrawalId`; ALPACA completion carries `transferId`.
    const transferId = (s.withdrawalId as string) ?? (s.transferId as string) ?? ctx.eventId;
    const cf = await carryForward(deps, ctx.tenantId, transferId, BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED, {
      amountCents: s.amountCents as number,
      currency: (s.currency as string) ?? 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    const executionMode = ctx.eventType === BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED ? 'simulation' : 'live';
    return fundingCarrier({
      eventName: BrokerCtrlEventTypes.WITHDRAWAL_SETTLED,
      direction: 'WITHDRAWAL',
      status: 'settled',
      transferId,
      tenantId: ctx.tenantId,
      userId: cf.userId,
      region: ctx.region,
      amountCents: cf.amountCents,
      currency: cf.currency,
      executionMode,
      initiatedAt: cf.initiatedAt,
      settledAt: ctx.timestamp,
      timestamp: ctx.timestamp,
    });
  };
}

function alpacaCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
    const s = payload.subject as Record<string, unknown>;
    const isDeposit = s.direction === 'INCOMING';
    return isDeposit ? depositCompletion(deps)(payload, ctx) : withdrawalCompletion(deps)(payload, ctx);
  };
}

function transferFailed(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = payload.subject as Record<string, unknown>;
    const isDeposit = s.direction === 'INCOMING';
    const transferId = (s.transferId as string) ?? ctx.eventId;
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, transferId, requestedName, {
      amountCents: s.amountCents as number,
      currency: (s.currency as string) ?? 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    return fundingCarrier({
      eventName: isDeposit ? BrokerCtrlEventTypes.DEPOSIT_FAILED : BrokerCtrlEventTypes.WITHDRAWAL_FAILED,
      direction: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
      status: 'failed',
      transferId,
      tenantId: ctx.tenantId,
      userId: cf.userId,
      region: ctx.region,
      amountCents: cf.amountCents,
      currency: cf.currency,
      executionMode: 'live',
      initiatedAt: cf.initiatedAt,
      failedAt: ctx.timestamp,
      reason: (s.failureReason as string) ?? 'Transfer failed',
      timestamp: ctx.timestamp,
    });
  };
}

export function createNormalizerHandlers(repo: Pick<FundingRepository, 'getRequested'>) {
  const deps: Deps = { getRequested: repo.getRequested.bind(repo) };
  return {
    [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: depositCompletion(deps),
    [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: withdrawalCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: alpacaCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: transferFailed(deps),
  };
}

const repo = new FundingRepository(requireEnv('TABLE_NAME'));

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: createNormalizerHandlers(repo),
});
