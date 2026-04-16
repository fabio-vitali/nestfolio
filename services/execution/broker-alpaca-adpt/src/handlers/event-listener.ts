import { materializeToTable, requireEnv, record, logger, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { OrderMappingRepository } from '../repositories/order-mapping.repository';
import { CircuitBreakerRepository } from '../repositories/circuit-breaker.repository';
import { AlpacaOrdersService } from '../services/alpaca-orders.service';
import { AlpacaAdptEventTypes } from '../domain/events';

const TABLE_NAME = requireEnv('TABLE_NAME');
const orderRepo = new OrderMappingRepository(TABLE_NAME);
const circuitBreakerRepo = new CircuitBreakerRepository(TABLE_NAME);
const client = new AlpacaClient();
const ordersService = new AlpacaOrdersService(client, orderRepo);

// ---------------------------------------------------------------------------
// Circuit breaker helpers
// ---------------------------------------------------------------------------

async function checkBreaker(): Promise<boolean> {
  return circuitBreakerRepo.isOpen('alpaca');
}

async function handleApiFailure(error: unknown, ctx: EventContext): Promise<boolean> {
  const isHealthy = await client.healthCheck();
  if (!isHealthy) {
    const opened = await circuitBreakerRepo.open('alpaca', (error as Error).message ?? 'API unreachable');
    if (opened) {
      logger.warn('Circuit breaker OPENED for alpaca', { eventId: ctx.eventId });
      await circuitBreakerRepo.writeBreakerOpenEvent(ctx, 'alpaca');
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rejection helpers
// ---------------------------------------------------------------------------

function rejectOrderAsBrokerUnavailable(ctx: EventContext, payload: EventPayload) {
  const s = payload.subject;
  return record('AlpacaOrderResult', {
    __typename: 'AlpacaOrderResult',
    tenantId: ctx.tenantId,
    nestfolioOrderId: s.orderId,
    alpacaOrderId: '',
    status: 'REJECTED',
    rejectionReason: 'BROKER_UNAVAILABLE',
    symbol: s.symbol,
    side: s.side,
    requestedQty: s.quantity,
  }, {
    pk: `OrderMapping#${ctx.tenantId}#${s.orderId as string}`,
    sk: 'OrderMapping',
  });
}

function rejectCancelAsBrokerUnavailable(ctx: EventContext, payload: EventPayload) {
  const s = payload.subject;
  return record('AlpacaOrderResult', {
    __typename: 'AlpacaOrderResult',
    tenantId: ctx.tenantId,
    nestfolioOrderId: s.orderId,
    status: 'CANCEL_FAILED',
    rejectionReason: 'BROKER_UNAVAILABLE',
  }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId as string}`, sk: 'CancelResult' });
}

function rejectTransferAsBrokerUnavailable(ctx: EventContext, payload: EventPayload) {
  const s = payload.subject;
  return record('AlpacaTransferResult', {
    __typename: 'AlpacaTransferResult',
    tenantId: ctx.tenantId,
    nestfolioTransferId: s.transferId ?? ctx.eventId,
    alpacaTransferId: '',
    direction: s.direction,
    amount: s.amount,
    status: 'FAILED',
    failureReason: 'BROKER_UNAVAILABLE',
  }, {
    pk: `TransferMapping#${ctx.tenantId}#${(s.transferId ?? ctx.eventId) as string}`,
    sk: 'TransferMapping',
  });
}

function rejectAccountCheckAsBrokerUnavailable(ctx: EventContext) {
  return record('AlpacaAccountSnapshot', {
    __typename: 'AlpacaAccountSnapshot',
    tenantId: ctx.tenantId,
    equity: null,
    buyingPower: null,
    positions: [],
    status: 'FAILED',
    failureReason: 'BROKER_UNAVAILABLE',
  }, {
    pk: `AccountSnapshot#${ctx.tenantId}`,
    sk: `Snapshot#${ctx.timestamp}`,
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function processOrderRequested(payload: EventPayload, ctx: EventContext) {
  if (await checkBreaker()) {
    return rejectOrderAsBrokerUnavailable(ctx, payload);
  }
  try {
    const s = payload.subject;
    const result = await ordersService.submitOrder(
      ctx.tenantId, s.orderId as string, s.symbol as string, s.side as string, s.quantity as number,
    );
    return record('AlpacaOrderResult', result, {
      pk: result.pk,
      sk: result.sk,
    });
  } catch (error) {
    const brokerDown = await handleApiFailure(error, ctx);
    const reason = brokerDown ? 'BROKER_UNAVAILABLE' : (error as Error).message;
    const s = payload.subject;
    return record('AlpacaOrderResult', {
      __typename: 'AlpacaOrderResult',
      tenantId: ctx.tenantId,
      nestfolioOrderId: s.orderId,
      alpacaOrderId: '',
      status: 'REJECTED',
      rejectionReason: reason,
      symbol: s.symbol,
      side: s.side,
      requestedQty: s.quantity,
    }, {
      pk: `OrderMapping#${ctx.tenantId}#${s.orderId as string}`,
      sk: 'OrderMapping',
    });
  }
}

async function processCancelRequested(payload: EventPayload, ctx: EventContext) {
  if (await checkBreaker()) {
    return rejectCancelAsBrokerUnavailable(ctx, payload);
  }
  try {
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
  } catch (error) {
    const brokerDown = await handleApiFailure(error, ctx);
    const reason = brokerDown ? 'BROKER_UNAVAILABLE' : (error as Error).message;
    const s = payload.subject;
    return record('AlpacaOrderResult', {
      __typename: 'AlpacaOrderResult',
      tenantId: ctx.tenantId,
      nestfolioOrderId: s.orderId,
      status: 'CANCEL_FAILED',
      rejectionReason: reason,
    }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId as string}`, sk: 'CancelResult' });
  }
}

async function processTransferRequested(payload: EventPayload, ctx: EventContext) {
  if (await checkBreaker()) {
    return rejectTransferAsBrokerUnavailable(ctx, payload);
  }
  try {
    const s = payload.subject;
    const result = await client.initiateTransfer({
      transfer_type: 'ach',
      direction: s.direction as 'INCOMING' | 'OUTGOING',
      amount: String(s.amount),
      relationship_id: (s.relationshipId as string) ?? '',
    });

    const alpacaTransferId = result.status < 300 ? result.data.id : '';
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
  } catch (error) {
    const brokerDown = await handleApiFailure(error, ctx);
    const reason = brokerDown ? 'BROKER_UNAVAILABLE' : (error as Error).message;
    const s = payload.subject;
    return record('AlpacaTransferResult', {
      __typename: 'AlpacaTransferResult',
      tenantId: ctx.tenantId,
      nestfolioTransferId: s.transferId ?? ctx.eventId,
      alpacaTransferId: '',
      direction: s.direction,
      amount: s.amount,
      status: 'FAILED',
      failureReason: reason,
    }, {
      pk: `TransferMapping#${ctx.tenantId}#${(s.transferId ?? ctx.eventId) as string}`,
      sk: 'TransferMapping',
    });
  }
}

async function processAccountCheck(payload: EventPayload, ctx: EventContext) {
  if (await checkBreaker()) {
    return rejectAccountCheckAsBrokerUnavailable(ctx);
  }
  try {
    const [account, positions] = await Promise.all([
      client.getAccount(),
      client.getPositions(),
    ]);

    return record('AlpacaAccountSnapshot', {
      __typename: 'AlpacaAccountSnapshot',
      tenantId: ctx.tenantId,
      equity: account.data.equity,
      buyingPower: account.data.buying_power,
      positions: (positions.data ?? []).map((p) => ({
        symbol: p.symbol, qty: Number(p.qty), marketValue: Number(p.market_value),
      })),
    }, {
      pk: `AccountSnapshot#${ctx.tenantId}`,
      sk: `Snapshot#${ctx.timestamp}`,
    });
  } catch (error) {
    const brokerDown = await handleApiFailure(error, ctx);
    const reason = brokerDown ? 'BROKER_UNAVAILABLE' : (error as Error).message;
    return record('AlpacaAccountSnapshot', {
      __typename: 'AlpacaAccountSnapshot',
      tenantId: ctx.tenantId,
      equity: null,
      buyingPower: null,
      positions: [],
      status: 'FAILED',
      failureReason: reason,
    }, {
      pk: `AccountSnapshot#${ctx.tenantId}`,
      sk: `Snapshot#${ctx.timestamp}`,
    });
  }
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
