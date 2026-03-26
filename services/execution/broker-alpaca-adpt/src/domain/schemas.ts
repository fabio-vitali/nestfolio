import { z } from 'zod';

// ── Alpaca REST API response shapes ──────────────────────────────────

/** Shape returned by POST /v2/orders and GET /v2/orders/{id} */
export interface AlpacaOrderApiResponse {
  id: string;
  client_order_id: string;
  status: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  filled_qty: string;
  filled_avg_price: string;
}

/** Shape returned by GET /v2/account */
export interface AlpacaAccountApiResponse {
  equity: string;
  buying_power: string;
  cash: string;
}

/** Single item returned by GET /v2/positions */
export interface AlpacaPositionApiResponse {
  symbol: string;
  qty: string;
  market_value: string;
}

/** Shape returned by POST /v2/ach/transfers and GET /v2/ach/transfers/{id} */
export interface AlpacaTransferApiResponse {
  id: string;
  status: string;
  amount: string;
  direction: string;
}

/** Single trade event item from GET /v2/events/trades */
export interface AlpacaTradeEvent {
  event: string;
  order: { id: string };
  qty: string;
  price: string;
  reason?: string;
}

export const AlpacaOrderResultSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaOrderResult'),
  tenantId: z.string(),
  nestfolioOrderId: z.string(),
  alpacaOrderId: z.string(),
  status: z.enum(['PLACED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'CANCEL_FAILED']),
  filledQuantity: z.number().optional(),
  averageFillPrice: z.number().optional(),
  rejectionReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaOrderResult = z.infer<typeof AlpacaOrderResultSchema>;

export const AlpacaTransferResultSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaTransferResult'),
  tenantId: z.string(),
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;

export const AlpacaAccountSnapshotSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaAccountSnapshot'),
  tenantId: z.string(),
  equity: z.number(),
  buyingPower: z.number(),
  positions: z.array(z.object({
    symbol: z.string(),
    qty: z.number(),
    marketValue: z.number(),
  })),
  timestamp: z.string(),
});
export type AlpacaAccountSnapshot = z.infer<typeof AlpacaAccountSnapshotSchema>;
