import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { materializeToTable, requireEnv, logger, getUUID, getTime, pickRequestContext, parseSubject, type EventPayload, type EventContext, type WriteIntent } from '@nestfolio/event-processor';
import { ExecutionModeRepository } from '../repositories/execution-mode.repository';
import { BrokerCtrlRoutedEventTypes, BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier } from '../domain/funding';
import { DepositInitiatedSchema, WithdrawalInitiatedSchema } from '@nestfolio/investor-adpt/domain';

const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = 'broker-ctrl';

const eb = new EventBridgeClient({});

type ModeDeps = { getMode: ExecutionModeRepository['getMode'] };

async function emitToEventBridge(detailType: string, subject: Record<string, unknown>, ctx: EventContext) {
  const detail = { id: getUUID(), type: detailType, timestamp: getTime(), subject, context: pickRequestContext(ctx) };
  await eb.send(new PutEventsCommand({
    Entries: [{ EventBusName: BUS_NAME, Source: `${BUS_NAME}@${SERVICE_NAME}`, DetailType: detailType, Detail: JSON.stringify(detail) }],
  }));
}

function routeDeposit(deps: ModeDeps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const subject = parseSubject(payload, DepositInitiatedSchema);
    const mode = await deps.getMode(ctx.tenantId);
    const executionMode = mode === 'live' ? 'live' : 'simulation';
    const detailType = mode === 'live'
      ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
      : BrokerCtrlRoutedEventTypes.SIM_DEPOSIT_INITIATED;
    await emitToEventBridge(detailType, { ...subject, direction: 'INCOMING' }, ctx);
    const transferId = subject.depositId ?? ctx.eventId;
    const now = ctx.timestamp;
    logger.info('Deposit routed', { tenantId: ctx.tenantId, mode, detailType });
    return fundingCarrier({
      eventName: BrokerCtrlEventTypes.DEPOSIT_REQUESTED,
      direction: 'DEPOSIT',
      status: 'requested',
      transferId,
      tenantId: ctx.tenantId,
      userId: subject.userId ?? ctx.userId,
      region: ctx.region,
      amountCents: subject.amountCents,
      currency: subject.currency ?? 'USD',
      executionMode,
      initiatedAt: now,
      timestamp: now,
    });
  };
}

function routeWithdrawal(deps: ModeDeps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const subject = parseSubject(payload, WithdrawalInitiatedSchema);
    const mode = await deps.getMode(ctx.tenantId);
    const executionMode = mode === 'live' ? 'live' : 'simulation';
    const detailType = mode === 'live'
      ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
      : BrokerCtrlRoutedEventTypes.SIM_WITHDRAWAL_REQUESTED;
    await emitToEventBridge(detailType, { ...subject, direction: 'OUTGOING' }, ctx);
    const transferId = subject.withdrawalId ?? ctx.eventId;
    const now = ctx.timestamp;
    logger.info('Withdrawal routed', { tenantId: ctx.tenantId, mode, detailType });
    return fundingCarrier({
      eventName: BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED,
      direction: 'WITHDRAWAL',
      status: 'requested',
      transferId,
      tenantId: ctx.tenantId,
      userId: subject.userId ?? ctx.userId,
      region: ctx.region,
      amountCents: subject.amountCents,
      currency: subject.currency ?? 'USD',
      executionMode,
      initiatedAt: now,
      timestamp: now,
    });
  };
}

export function createRouterHandlers(modeRepo: Pick<ExecutionModeRepository, 'getMode'>) {
  const deps: ModeDeps = { getMode: modeRepo.getMode.bind(modeRepo) };
  return {
    [BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED]: routeDeposit(deps),
    [BrokerCtrlInboundEventTypes.WITHDRAWAL_INITIATED]: routeWithdrawal(deps),
  };
}

const modeRepo = new ExecutionModeRepository(requireEnv('TABLE_NAME'));

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: createRouterHandlers(modeRepo),
});
