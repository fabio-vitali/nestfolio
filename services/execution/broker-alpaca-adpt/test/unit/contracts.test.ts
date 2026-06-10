import {
  AlpacaOrderResultSchema,
  AlpacaTransferResultSchema,
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

  it('AlpacaTransferResultSchema parses an INITIATED transfer subject (dry)', () => {
    expect(AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'tr1', alpacaTransferId: 'at1', direction: 'INCOMING',
      amount: 500, status: 'INITIATED', timestamp: '2026-06-10T00:00:00.000Z',
    }).direction).toBe('INCOMING');
  });

  it('AlpacaAccountSnapshotSchema parses success + failure shapes', () => {
    expect(AlpacaAccountSnapshotSchema.parse({
      equity: 10000, buyingPower: 5000, positions: [{ symbol: 'VTI', qty: 5, marketValue: 1000 }],
    }).equity).toBe(10000);
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
