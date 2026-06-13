import { materializeToTable, requireEnv, parseSubject, type EventPayload, type EventContext, type WriteIntent } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier, type FundingDirection } from '../domain/funding';
import { FundingRepository } from '../repositories/funding.repository';
import { SimDepositCompletedSchema, SimWithdrawalCompletedSchema } from '@nestfolio/broker-sim-adpt/contracts';
import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';

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

function depositSettleCarriers(
  transferId: string,
  executionMode: 'simulation' | 'live',
  cf: { amountCents: number; currency: string; userId: string; initiatedAt: string },
  ctx: EventContext,
): WriteIntent[] {
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
}

function withdrawalSettleCarrier(
  transferId: string,
  executionMode: 'simulation' | 'live',
  cf: { amountCents: number; currency: string; userId: string; initiatedAt: string },
  ctx: EventContext,
): WriteIntent {
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
}

function simDepositCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
    const s = parseSubject(payload, SimDepositCompletedSchema);
    const cf = await carryForward(deps, ctx.tenantId, s.depositId, BrokerCtrlEventTypes.DEPOSIT_REQUESTED, {
      amountCents: s.amountCents,
      currency: s.currency,
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    return depositSettleCarriers(s.depositId, 'simulation', cf, ctx);
  };
}

function simWithdrawalCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = parseSubject(payload, SimWithdrawalCompletedSchema);
    const cf = await carryForward(deps, ctx.tenantId, s.withdrawalId, BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED, {
      amountCents: Math.round(s.amount * 100),
      currency: 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    return withdrawalSettleCarrier(s.withdrawalId, 'simulation', cf, ctx);
  };
}

function alpacaTransferCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
    const s = parseSubject(payload, AlpacaTransferResultSchema);
    const isDeposit = s.direction === 'INCOMING';
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, s.nestfolioTransferId, requestedName, {
      amountCents: Math.round(s.amount * 100),
      currency: 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    return isDeposit
      ? depositSettleCarriers(s.nestfolioTransferId, 'live', cf, ctx)
      : withdrawalSettleCarrier(s.nestfolioTransferId, 'live', cf, ctx);
  };
}

function alpacaTransferFailed(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = parseSubject(payload, AlpacaTransferResultSchema);
    const isDeposit = s.direction === 'INCOMING';
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, s.nestfolioTransferId, requestedName, {
      amountCents: Math.round(s.amount * 100),
      currency: 'USD',
      userId: ctx.userId,
      initiatedAt: ctx.timestamp,
    });
    return fundingCarrier({
      eventName: isDeposit ? BrokerCtrlEventTypes.DEPOSIT_FAILED : BrokerCtrlEventTypes.WITHDRAWAL_FAILED,
      direction: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
      status: 'failed',
      transferId: s.nestfolioTransferId,
      tenantId: ctx.tenantId,
      userId: cf.userId,
      region: ctx.region,
      amountCents: cf.amountCents,
      currency: cf.currency,
      executionMode: 'live',
      initiatedAt: cf.initiatedAt,
      failedAt: ctx.timestamp,
      reason: s.failureReason ?? 'Transfer failed',
      timestamp: ctx.timestamp,
    });
  };
}

export function createNormalizerHandlers(repo: Pick<FundingRepository, 'getRequested'>) {
  const deps: Deps = { getRequested: repo.getRequested.bind(repo) };
  return {
    [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: simDepositCompletion(deps),
    [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: simWithdrawalCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: alpacaTransferCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: alpacaTransferFailed(deps),
  };
}

const repo = new FundingRepository(requireEnv('TABLE_NAME'));

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: createNormalizerHandlers(repo),
});
