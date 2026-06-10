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

