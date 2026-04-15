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

  describe('retry logic', () => {
    beforeEach(() => {
      // Replace setTimeout with an immediate version so retries complete without wall-clock delay
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
        if (typeof fn === 'function') fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns immediately on first success without retrying', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200, json: async () => ({ id: 'ok' }) });

      const result = await client.getAccount();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(200);
    });

    it('retries on fetch failure and returns on eventual success', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ status: 200, json: async () => ({ id: 'recovered' }) });

      const result = await client.getAccount();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    });

    it('throws after exhausting all retries', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('persistent failure'))
        .mockRejectedValueOnce(new Error('persistent failure'))
        .mockRejectedValueOnce(new Error('persistent failure'));

      await expect(client.getAccount()).rejects.toThrow('persistent failure');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('healthCheck', () => {
    it('returns true when request succeeds', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200, json: async () => ({}) });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns false when request throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('unreachable'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry — only calls fetch once on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('down'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('live Alpaca safety guard', () => {
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

    it('allows live Alpaca URL only when NESTFOLIO_PREFIX is prod', () => {
      process.env.NESTFOLIO_PREFIX = 'prod';
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).not.toThrow();
    });

    it('blocks live Alpaca URL in a non-prod prefix', () => {
      process.env.NESTFOLIO_PREFIX = 'dev';
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).toThrow(/refuses to call live Alpaca/);
    });

    it('blocks live Alpaca URL when NESTFOLIO_PREFIX is unset', () => {
      delete process.env.NESTFOLIO_PREFIX;
      expect(() => new AlpacaClient({
        baseUrl: 'https://api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).toThrow(/refuses to call live Alpaca/);
    });

    it('blocks broker-api.alpaca.markets in non-prod', () => {
      process.env.NESTFOLIO_PREFIX = 'dev';
      expect(() => new AlpacaClient({
        baseUrl: 'https://broker-api.alpaca.markets',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).toThrow(/refuses to call live Alpaca/);
    });

    it('allows non-Alpaca URLs in non-prod (mock APIs, Lambda URLs)', () => {
      process.env.NESTFOLIO_PREFIX = 'dev';
      expect(() => new AlpacaClient({
        baseUrl: 'https://abc123.lambda-url.us-east-1.on.aws',
        apiKeyId: 'k',
        apiKeySecret: 's',
      })).not.toThrow();
    });
  });
});
