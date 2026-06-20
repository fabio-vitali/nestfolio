import { OrderSchema, StagedOrderSchema } from '../../../src/domain/contracts';

describe('execution-ctrl contracts', () => {
  it('OrderSchema parses a SUBMITTED order subject (dry — identity stripped)', () => {
    const parsed = OrderSchema.parse({
      __typename: 'Order', tenantId: 't', pk: 'Order#t#o1', sk: 'Order',
      orderId: 'o1', decisionPacketId: 'dp1',
      symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500000,
      status: 'SUBMITTED', sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('SUBMITTED');
    expect(parsed.symbol).toBe('VTI');
  });

  it('OrderSchema parses a REJECTED order subject (reason present)', () => {
    expect(OrderSchema.parse({
      orderId: 'o1', decisionPacketId: 'dp1',
      symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500000,
      status: 'REJECTED', reason: 'safety check failed', timestamp: '2026-06-10T00:00:00.000Z',
    }).reason).toBe('safety check failed');
  });

  it('OrderSchema rejects an unknown status', () => {
    expect(() => OrderSchema.parse({
      orderId: 'o1', decisionPacketId: 'dp1',
      symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500000,
      status: 'DONE', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('StagedOrderSchema parses a staged order subject (dry)', () => {
    expect(StagedOrderSchema.parse({
      orderId: 'o1', symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500000,
      stagedAt: '2026-06-10T00:00:00.000Z', timestamp: '2026-06-10T00:00:00.000Z',
    }).orderId).toBe('o1');
  });
});
