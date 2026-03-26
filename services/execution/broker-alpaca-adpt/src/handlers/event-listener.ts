import { materializeToTable, requireEnv, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { OrderMappingRepository } from '../repositories/order-mapping.repository';
import { PollingStateRepository } from '../repositories/polling-state.repository';
import { AlpacaOrdersService } from '../services/alpaca-orders.service';
import { AlpacaAdptEventTypes } from '../domain/events';

const TABLE_NAME = requireEnv('TABLE_NAME');
const orderRepo = new OrderMappingRepository(TABLE_NAME);
const pollingRepo = new PollingStateRepository(TABLE_NAME);
const client = new AlpacaClient();
const ordersService = new AlpacaOrdersService(client, orderRepo, pollingRepo);

async function processOrderRequested(payload: EventPayload, ctx: EventContext) {
  const s = payload.subject;
  const result = await ordersService.submitOrder(
    ctx.tenantId, s.orderId as string, s.symbol as string, s.side as string, s.quantity as number,
  );
  return record('AlpacaOrderResult', result, {
    pk: result.pk,
    sk: result.sk,
  });
}

async function processCancelRequested(payload: EventPayload, ctx: EventContext) {
  const s = payload.subject;
  const mapping = await orderRepo.getByNestfolioOrderId(ctx.tenantId, s.orderId as string);
  if (!mapping) {
    return record('AlpacaOrderResult', {
      __typename: 'AlpacaOrderResult',
      tenantId: ctx.tenantId,
      nestfolioOrderId: s.orderId,
      status: 'CANCEL_FAILED',
      rejectionReason: 'Order not found',
    }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId}`, sk: 'CancelResult' });
  }

  const result = await client.cancelOrder(mapping.alpacaOrderId as string);
  const status = result.status < 300 ? 'CANCELLED' : 'CANCEL_FAILED';
  return record('AlpacaOrderResult', {
    __typename: 'AlpacaOrderResult',
    tenantId: ctx.tenantId,
    nestfolioOrderId: s.orderId,
    alpacaOrderId: mapping.alpacaOrderId,
    status,
    rejectionReason: status === 'CANCEL_FAILED' ? JSON.stringify(result.data) : undefined,
  }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId}`, sk: 'CancelResult' });
}

async function processTransferRequested(payload: EventPayload, ctx: EventContext) {
  const s = payload.subject;
  const result = await client.initiateTransfer({
    transfer_type: 'ach',
    direction: s.direction as 'INCOMING' | 'OUTGOING',
    amount: String(s.amount),
    relationship_id: (s.relationshipId as string) ?? '',
  });

  const alpacaTransferId = result.status < 300 ? (result.data as any).id : '';
  const status = result.status < 300 ? 'INITIATED' : 'FAILED';

  return record('AlpacaTransferResult', {
    __typename: 'AlpacaTransferResult',
    tenantId: ctx.tenantId,
    nestfolioTransferId: s.transferId ?? ctx.eventId,
    alpacaTransferId,
    direction: s.direction,
    amount: s.amount,
    status,
    failureReason: status === 'FAILED' ? JSON.stringify(result.data) : undefined,
  }, {
    pk: `TransferMapping#${ctx.tenantId}#${(s.transferId ?? ctx.eventId) as string}`,
    sk: 'TransferMapping',
  });
}

async function processAccountCheck(payload: EventPayload, ctx: EventContext) {
  const [account, positions] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
  ]);

  return record('AlpacaAccountSnapshot', {
    __typename: 'AlpacaAccountSnapshot',
    tenantId: ctx.tenantId,
    equity: (account.data as any).equity,
    buyingPower: (account.data as any).buying_power,
    positions: ((positions.data as any[]) ?? []).map((p: any) => ({
      symbol: p.symbol, qty: Number(p.qty), marketValue: Number(p.market_value),
    })),
  }, {
    pk: `AccountSnapshot#${ctx.tenantId}`,
    sk: `Snapshot#${ctx.timestamp}`,
  });
}

export const handler = materializeToTable({
  serviceName: 'broker-alpaca-adpt',
  handlers: {
    [AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED]: processOrderRequested,
    [AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED]: processCancelRequested,
    [AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED]: processTransferRequested,
    [AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK]: processAccountCheck,
  },
});
