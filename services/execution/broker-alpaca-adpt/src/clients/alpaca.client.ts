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
  client_order_id?: string;
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

const PAPER_BASE_URLS = new Set(['https://paper-api.alpaca.markets']);
const LIVE_ALLOWED_PREFIXES = new Set(['prod']);

function assertAlpacaSafe(baseUrl: string, prefix: string | undefined): void {
  if (PAPER_BASE_URLS.has(baseUrl)) return;
  if (prefix && LIVE_ALLOWED_PREFIXES.has(prefix)) return;
  throw new Error(
    `broker-alpaca-adpt refuses to start: non-paper baseUrl '${baseUrl}' ` +
    `is not allowed in prefix '${prefix ?? '<unset>'}'. Only 'prod' may use live Alpaca.`,
  );
}

export class AlpacaClient {
  private baseUrl?: string;
  private apiKeyId?: string;
  private apiKeySecret?: string;
  private readonly staticConfig: boolean;

  constructor(config?: { baseUrl?: string; apiKeyId?: string; apiKeySecret?: string }) {
    // Direct config injection for unit tests — bypasses resolve()
    if (config?.baseUrl) {
      assertAlpacaSafe(config.baseUrl, process.env.NESTFOLIO_PREFIX);
      this.baseUrl = config.baseUrl;
      this.apiKeyId = config.apiKeyId;
      this.apiKeySecret = config.apiKeySecret;
      this.staticConfig = true;
    } else {
      this.staticConfig = false;
    }
  }

  private async resolve(): Promise<void> {
    if (this.staticConfig) return;

    const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
    const token = process.env.AWS_SESSION_TOKEN!;
    const headers = { 'X-Aws-Parameters-Secrets-Token': token };

    // SSM param (extension caches with parameterStoreTtl)
    const paramName = process.env.ALPACA_BASE_URL_PARAM!;
    const paramRes = await fetch(
      `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
      { headers },
    );
    const paramData = await paramRes.json() as { Parameter: { Value: string } };
    this.baseUrl = paramData.Parameter.Value;
    assertAlpacaSafe(this.baseUrl, process.env.NESTFOLIO_PREFIX);

    // Secrets Manager (only resolve once — secrets don't change between invocations)
    if (!this.apiKeyId) {
      const secretId = process.env.ALPACA_SECRET_ID!;
      const secretRes = await fetch(
        `http://localhost:${port}/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
        { headers },
      );
      const secretData = await secretRes.json() as { SecretString: string };
      const keys = JSON.parse(secretData.SecretString) as { apiKeyId: string; apiKeySecret: string };
      this.apiKeyId = keys.apiKeyId;
      this.apiKeySecret = keys.apiKeySecret;
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<AlpacaResponse<T>> {
    await this.resolve();
    const url = `${this.baseUrl}${path}`;
    logger.info('Alpaca API request', { method, path });

    const response = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': this.apiKeyId!,
        'APCA-API-SECRET-KEY': this.apiKeySecret!,
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

  async getOrder(orderId: string): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('GET', `/v2/orders/${orderId}`);
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
