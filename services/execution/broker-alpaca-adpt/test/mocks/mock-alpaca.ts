import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

const orders = new Map<string, Record<string, unknown>>();
const transfers = new Map<string, Record<string, unknown>>();
const pollCounts = new Map<string, number>();
let brokerDown = false;

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function getScenario(identifier: string): string {
  if (identifier.startsWith('integ-fill-')) return 'fill';
  if (identifier.startsWith('integ-partial-')) return 'partial';
  if (identifier.startsWith('integ-reject-')) return 'reject';
  if (identifier.startsWith('integ-cancel-')) return 'cancel';
  if (identifier.startsWith('integ-broker-down-')) return 'broker-down';
  if (identifier.startsWith('integ-transfer-ok-')) return 'transfer-ok';
  if (identifier.startsWith('integ-transfer-fail-')) return 'transfer-fail';
  return 'fill'; // safe default
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // POST /v2/orders — submit order
  if (method === 'POST' && path === '/v2/orders') {
    const body = JSON.parse(event.body ?? '{}');
    const clientOrderId = body.client_order_id ?? body.symbol ?? '';
    const scenario = getScenario(clientOrderId);

    if (scenario === 'reject') {
      return json(422, { message: 'insufficient buying power' });
    }

    if (scenario === 'broker-down') {
      brokerDown = true;
      return json(503, { message: 'service unavailable' });
    }

    const id = `mock-${randomUUID()}`;
    const order = {
      id, client_order_id: clientOrderId, symbol: body.symbol,
      qty: body.qty, side: body.side, type: body.type,
      status: 'accepted', filled_qty: '0', filled_avg_price: '0',
    };
    orders.set(id, order);
    return json(200, order);
  }

  // DELETE /v2/orders/{orderId} — cancel order
  const cancelMatch = path.match(/^\/v2\/orders\/(.+)$/);
  if (method === 'DELETE' && cancelMatch) {
    const orderId = cancelMatch[1];
    const order = orders.get(orderId);
    if (order) order['status'] = 'canceled';
    return { statusCode: 204, body: '' };
  }

  // GET /v2/orders/{orderId} — poll order status
  const getOrderMatch = path.match(/^\/v2\/orders\/(.+)$/);
  if (method === 'GET' && getOrderMatch) {
    const orderId = getOrderMatch[1];
    const order = orders.get(orderId);
    if (!order) return json(404, { message: 'order not found' });

    const clientOrderId = (order['client_order_id'] as string) ?? '';
    const scenario = getScenario(clientOrderId);
    const count = (pollCounts.get(orderId) ?? 0) + 1;
    pollCounts.set(orderId, count);

    if (scenario === 'fill' || scenario === 'cancel') {
      return json(200, { ...order, status: scenario === 'cancel' ? 'canceled' : 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
    }
    if (scenario === 'partial') {
      if (count <= 1) {
        return json(200, { ...order, status: 'partially_filled', filled_qty: '1', filled_avg_price: '150.00' });
      }
      return json(200, { ...order, status: 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
    }
    return json(200, { ...order, status: 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
  }

  // POST /v2/ach/transfers — initiate transfer
  if (method === 'POST' && path === '/v2/ach/transfers') {
    const body = JSON.parse(event.body ?? '{}');
    const id = `mock-${randomUUID()}`;
    const transfer = { id, status: 'QUEUED', direction: body.direction, amount: body.amount };
    transfers.set(id, transfer);
    return json(200, transfer);
  }

  // GET /v2/ach/transfers/{transferId} — poll transfer status
  const getTransferMatch = path.match(/^\/v2\/ach\/transfers\/(.+)$/);
  if (method === 'GET' && getTransferMatch) {
    const transferId = getTransferMatch[1];
    const transfer = transfers.get(transferId);
    if (!transfer) return json(404, { message: 'transfer not found' });
    return json(200, { ...transfer, status: 'COMPLETE' });
  }

  // GET /v2/account
  if (method === 'GET' && path === '/v2/account') {
    if (brokerDown) {
      return json(503, { message: 'service unavailable' });
    }
    return json(200, {
      id: 'mock-account',
      equity: '125000.00',
      buying_power: '50000.00',
      cash: '50000.00',
      portfolio_value: '75000.00',
    });
  }

  // GET /v2/positions
  if (method === 'GET' && path === '/v2/positions') {
    return json(200, [
      { symbol: 'AAPL', qty: '10', market_value: '1750.00', avg_entry_price: '150.00' },
    ]);
  }

  return json(404, { message: `Unknown route: ${method} ${path}` });
}
