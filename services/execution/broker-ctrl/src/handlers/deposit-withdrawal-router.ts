import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createIngestionHandler, skip, requireEnv, logger, getUUID, getTime, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { ExecutionModeRepository } from '../repositories/execution-mode.repository';
import { BrokerCtrlRoutedEventTypes, BrokerCtrlInboundEventTypes } from '../domain/events';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = 'broker-ctrl';

const modeRepo = new ExecutionModeRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

async function emitToEventBridge(detailType: string, subject: Record<string, unknown>, ctx: EventContext) {
  const detail = {
    id: getUUID(),
    type: detailType,
    timestamp: getTime(),
    subject,
    context: pickRequestContext(ctx),
  };
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: `${BUS_NAME}@${SERVICE_NAME}`,
      DetailType: detailType,
      Detail: JSON.stringify(detail),
    }],
  }));
}

async function routeDeposit(payload: EventPayload, ctx: EventContext) {
  const mode = await modeRepo.getMode(ctx.tenantId);
  const detailType = mode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_DEPOSIT_INITIATED;

  await emitToEventBridge(detailType, { ...payload.subject, direction: 'INCOMING' }, ctx);

  logger.info('Deposit routed', { tenantId: ctx.tenantId, mode, detailType });
  return skip();
}

async function routeWithdrawal(payload: EventPayload, ctx: EventContext) {
  const mode = await modeRepo.getMode(ctx.tenantId);
  const detailType = mode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_WITHDRAWAL_REQUESTED;

  await emitToEventBridge(detailType, { ...payload.subject, direction: 'OUTGOING' }, ctx);

  logger.info('Withdrawal routed', { tenantId: ctx.tenantId, mode, detailType });
  return skip();
}

export const handler = createIngestionHandler({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED]: routeDeposit,
    [BrokerCtrlInboundEventTypes.WITHDRAWAL_REQUESTED]: routeWithdrawal,
  },
});
