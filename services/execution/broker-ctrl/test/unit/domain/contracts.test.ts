import {
  NormalizedOrderEventSchema,
  BrokerOrderSchema,
  ExecutionModeSchema,
} from '../../../src/domain/contracts';

describe('broker-ctrl contracts', () => {
  it('NormalizedOrderEventSchema parses a FILLED order subject (dry — identity stripped)', () => {
    const row = {
      pk: 'NormalizedEvent#t#o1', sk: 'ORDER_FILLED#2026', __typename: 'NormalizedEvent',
      tenantId: 't', userId: 'u', region: 'us-east-1',
      orderId: 'o1', executionMode: 'simulation', filledQty: 10, averageFillPrice: 200,
      timestamp: '2026-06-10T00:00:00.000Z',
    };
    const parsed = NormalizedOrderEventSchema.parse(row);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.orderId).toBe('o1');
    expect(parsed.filledQty).toBe(10);
  });

  it('NormalizedOrderEventSchema parses a REJECTED order subject (failureReason, no fill)', () => {
    expect(NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'live', failureReason: 'insufficient buying power',
      timestamp: '2026-06-10T00:00:00.000Z',
    }).failureReason).toBe('insufficient buying power');
  });

  it('NormalizedOrderEventSchema rejects an unknown executionMode', () => {
    expect(() => NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'paper', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('BrokerOrderSchema parses the internal state row (dry)', () => {
    const parsed = BrokerOrderSchema.parse({
      tenantId: 't', pk: 'BrokerOrder#t#o1', sk: 'BrokerOrder', __typename: 'BrokerOrder',
      orderId: 'o1', executionMode: 'live', state: 'AWAITING_FILL', routedTo: 'alpaca',
      requestedQty: 10, filledQty: 0, remainingQty: 10, retryCount: 0,
      instrumentId: 'VTI', routedAt: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.state).toBe('AWAITING_FILL');
  });

  it('ExecutionModeSchema parses the cache row (dry)', () => {
    expect(ExecutionModeSchema.parse({ mode: 'live', updatedAt: '2026-06-10T00:00:00.000Z' }).mode).toBe('live');
  });
});
