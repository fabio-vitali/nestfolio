import { logger } from '@nestfolio/event-processor';
import type {
  AlpacaOrderApiResponse,
  AlpacaAccountApiResponse,
  AlpacaPositionApiResponse,
  AlpacaTransferApiResponse,
  AlpacaTradeEvent,
} from '../domain/schemas';

export interface AlpacaOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
}

export interface AlpacaTransferParams {
  transfer_type: 'ach';
  direction: 'INCOMING' | 'OUTGOING';
  amount: string;
  relationship_id: string;
}

export interface AlpacaResponse<T = unknown> {
  status: number;
  data: T;
}

export class AlpacaClient {
  private readonly baseUrl: string;
  private readonly apiKeyId: string;
  private readonly apiKeySecret: string;

  constructor(config?: { baseUrl?: string; apiKeyId?: string; apiKeySecret?: string }) {
    this.baseUrl = config?.baseUrl ?? process.env.ALPACA_BASE_URL!;
    this.apiKeyId = config?.apiKeyId ?? process.env.ALPACA_API_KEY_ID!;
    this.apiKeySecret = config?.apiKeySecret ?? process.env.ALPACA_API_KEY_SECRET!;
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<AlpacaResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    logger.info('Alpaca API request', { method, path });

    const response = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': this.apiKeyId,
        'APCA-API-SECRET-KEY': this.apiKeySecret,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as T;
    logger.info('Alpaca API response', { method, path, status: response.status });

    return { status: response.status, data };
  }

  async submitOrder(params: AlpacaOrderParams): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('POST', '/v2/orders', params);
  }

  async cancelOrder(alpacaOrderId: string): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('DELETE', `/v2/orders/${alpacaOrderId}`);
  }

  async getTradeEvents(since: string, until: string): Promise<AlpacaResponse<AlpacaTradeEvent[]>> {
    return this.request<AlpacaTradeEvent[]>('GET', `/v2/events/trades?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
  }

  async getAccount(): Promise<AlpacaResponse<AlpacaAccountApiResponse>> {
    return this.request<AlpacaAccountApiResponse>('GET', '/v2/account');
  }

  async getPositions(): Promise<AlpacaResponse<AlpacaPositionApiResponse[]>> {
    return this.request<AlpacaPositionApiResponse[]>('GET', '/v2/positions');
  }

  async initiateTransfer(params: AlpacaTransferParams): Promise<AlpacaResponse<AlpacaTransferApiResponse>> {
    return this.request<AlpacaTransferApiResponse>('POST', '/v2/ach/transfers', params);
  }

  async getTransfer(transferId: string): Promise<AlpacaResponse<AlpacaTransferApiResponse>> {
    return this.request<AlpacaTransferApiResponse>('GET', `/v2/ach/transfers/${transferId}`);
  }
}
