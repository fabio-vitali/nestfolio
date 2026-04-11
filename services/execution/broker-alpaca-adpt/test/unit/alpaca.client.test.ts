jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { AlpacaClient, type AlpacaOrderParams } from '../../src/clients/alpaca.client';

const mockFetch = jest.fn() as jest.Mock & typeof fetch;
global.fetch = mockFetch;

describe('AlpacaClient', () => {
  const client = new AlpacaClient({
    baseUrl: 'https://paper-api.alpaca.markets',
    apiKeyId: 'test-key-id',
    apiKeySecret: 'test-key-secret',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'alpaca-123' }),
    });
  });

  it('submitOrder calls POST /v2/orders with correct headers and body', async () => {
    const params: AlpacaOrderParams = {
      symbol: 'AAPL',
      qty: 10,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    };

    const result = await client.submitOrder(params);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'APCA-API-KEY-ID': 'test-key-id',
          'APCA-API-SECRET-KEY': 'test-key-secret',
        }),
        body: JSON.stringify(params),
      }),
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 'alpaca-123' });
  });

  it('cancelOrder calls DELETE /v2/orders/{id}', async () => {
    await client.cancelOrder('order-456');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders/order-456',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getTradeEvents calls GET /v2/events/trades with since and until', async () => {
    await client.getTradeEvents('2025-01-01', '2025-01-02');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v2/events/trades?since=2025-01-01&until=2025-01-02'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getAccount calls GET /v2/account', async () => {
    await client.getAccount();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/account',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getPositions calls GET /v2/positions', async () => {
    await client.getPositions();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/positions',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('initiateTransfer calls POST /v2/ach/transfers', async () => {
    const params = {
      transfer_type: 'ach' as const,
      direction: 'INCOMING' as const,
      amount: '10000',
      relationship_id: 'rel-123',
    };

    await client.initiateTransfer(params);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/ach/transfers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(params),
      }),
    );
  });

  it('getTransfer calls GET /v2/ach/transfers/{id}', async () => {
    await client.getTransfer('transfer-789');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/ach/transfers/transfer-789',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('includes auth headers in all requests', async () => {
    await client.getAccount();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['APCA-API-KEY-ID']).toBe('test-key-id');
    expect(headers['APCA-API-SECRET-KEY']).toBe('test-key-secret');
  });

  describe('getOrder', () => {
    it('calls GET /v2/orders/{id} and returns response', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 'alpaca-order-abc', status: 'filled', filled_qty: '10', filled_avg_price: '150.25' }),
        status: 200,
      });

      const result = await client.getOrder('alpaca-order-abc');

      expect(result.status).toBe(200);
      expect(result.data.id).toBe('alpaca-order-abc');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://paper-api.alpaca.markets/v2/orders/alpaca-order-abc',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('cold-start paper-only safety guard', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('allows paper baseUrl in any prefix', () => {
      process.env.NESTFOLIO_PREFIX = 'dev';
      expect(() => new AlpacaClient({
        baseUrl: 'https://paper-api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).not.toThrow();
    });

    it('allows non-paper baseUrl only when NESTFOLIO_PREFIX is prod', () => {
      process.env.NESTFOLIO_PREFIX = 'prod';
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).not.toThrow();
    });

    it('refuses non-paper baseUrl in a non-prod prefix', () => {
      process.env.NESTFOLIO_PREFIX = 'dev';
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).toThrow(/refuses to start: non-paper baseUrl/);
    });

    it('refuses non-paper baseUrl when NESTFOLIO_PREFIX is unset', () => {
      delete process.env.NESTFOLIO_PREFIX;
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).toThrow(/refuses to start: non-paper baseUrl/);
    });
  });
});
