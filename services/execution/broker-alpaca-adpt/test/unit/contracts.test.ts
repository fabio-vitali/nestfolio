import {
  AlpacaOrderResultSchema,
  AlpacaAccountSnapshotSchema,
  BrokerCircuitEventSchema,
  CircuitBreakerSchema,
} from '../../src/domain/contracts';

describe('broker-alpaca-adpt contracts', () => {
  it('AlpacaOrderResultSchema parses a PLACED order subject (dry)', () => {
    const parsed = AlpacaOrderResultSchema.parse({
      pk: 'OrderMapping#t#o1', sk: 'OrderMapping', __typename: 'AlpacaOrderResult', tenantId: 't',
      nestfolioOrderId: 'o1', alpacaOrderId: 'a1', status: 'PLACED',
      symbol: 'VTI', side: 'buy', requestedQty: 10, timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('PLACED');
  });

  it('AlpacaOrderResultSchema parses a minimal CANCEL_FAILED subject (no symbol/side/qty)', () => {
    expect(AlpacaOrderResultSchema.parse({
      nestfolioOrderId: 'o1', alpacaOrderId: '', status: 'CANCEL_FAILED',
      rejectionReason: 'BROKER_UNAVAILABLE', timestamp: '2026-06-10T00:00:00.000Z',
    }).status).toBe('CANCEL_FAILED');
  });

  it('AlpacaOrderResultSchema rejects an invalid status', () => {
    expect(() => AlpacaOrderResultSchema.parse({
      nestfolioOrderId: 'o1', alpacaOrderId: 'a1', status: 'DONE', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('AlpacaOrderResultSchema parses the event-listener emission shape (no timestamp, no alpacaOrderId)', () => {
    // The CDC event-listener rejection/cancel emissions do NOT set timestamp/alpacaOrderId;
    // only order-mapping.repository.createMapping writes them. Both are optional on the aggregate.
    const parsed = AlpacaOrderResultSchema.parse({
      nestfolioOrderId: 'o1', status: 'CANCEL_FAILED', rejectionReason: 'Order not found',
    });
    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.alpacaOrderId).toBeUndefined();
  });

  it('AlpacaAccountSnapshotSchema parses success + failure shapes', () => {
    // equity/buyingPower are raw Alpaca API strings on success (NOT Number()-converted) — see contract comment.
    expect(AlpacaAccountSnapshotSchema.parse({
      equity: '10000.00', buyingPower: '5000.00', positions: [{ symbol: 'VTI', qty: 5, marketValue: 1000 }],
    }).equity).toBe('10000.00');
    const failed = AlpacaAccountSnapshotSchema.parse({
      equity: null, buyingPower: null, positions: [], status: 'FAILED', failureReason: 'timeout',
    });
    expect(failed.status).toBe('FAILED');
  });

  it('BrokerCircuitEventSchema parses the circuit event subject (dry)', () => {
    const parsed = BrokerCircuitEventSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1', adapter: 'alpaca', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.adapter).toBe('alpaca');
  });

  it('CircuitBreakerSchema parses the state row (dry)', () => {
    expect(CircuitBreakerSchema.parse({
      state: 'OPEN', adapter: 'alpaca', openedAt: '2026', reason: 'health check down',
    }).state).toBe('OPEN');
  });
});
