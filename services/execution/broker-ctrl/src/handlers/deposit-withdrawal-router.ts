import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createIngestionHandler, skip, requireEnv, logger, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { ExecutionModeRepository } from '../repositories/execution-mode.repository';
import { BrokerCtrlRoutedEventTypes, BrokerCtrlInboundEventTypes } from '../domain/events';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');

const modeRepo = new ExecutionModeRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

async function emitToEventBridge(detailType: string, detail: Record<string, unknown>) {
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: 'broker-ctrl',
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

  await emitToEventBridge(detailType, {
    tenantId: ctx.tenantId,
    subject: { ...payload.subject, direction: 'INCOMING' },
  });

  logger.info('Deposit routed', { tenantId: ctx.tenantId, mode, detailType });
  return skip();
}

async function routeWithdrawal(payload: EventPayload, ctx: EventContext) {
  const mode = await modeRepo.getMode(ctx.tenantId);
  const detailType = mode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_WITHDRAWAL_REQUESTED;

  await emitToEventBridge(detailType, {
    tenantId: ctx.tenantId,
    subject: { ...payload.subject, direction: 'OUTGOING' },
  });

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
