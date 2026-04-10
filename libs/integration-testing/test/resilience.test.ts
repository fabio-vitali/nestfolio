import { stripDynamicFields, sortSnapshot, assertEquivalentState } from '../src/resilience';

describe('resilience helpers', () => {
  describe('stripDynamicFields', () => {
    it('removes pk, sk, tenantId, userId, timestamps, eventId, sequenceNo, ttl', () => {
      const item = {
        pk: 'Account#tenant-1#actual',
        sk: 'Event#abc-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        timestamp: '2026-04-10T00:00:00Z',
        ttl: 1712793600,
        eventId: 'abc-123',
        sourceEventId: 'abc-123',
        sequenceNo: 1,
        __typename: 'LedgerEntry',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'AAPL', quantity: 10 },
      };

      const result = stripDynamicFields(item);

      expect(result).toEqual({
        __typename: 'LedgerEntry',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'AAPL', quantity: 10 },
      });
    });

    it('preserves fields not in the dynamic set', () => {
      const item = { pk: 'x', sk: 'y', customField: 'keep', status: 'active' };
      const result = stripDynamicFields(item);
      expect(result).toEqual({ customField: 'keep', status: 'active' });
    });
  });

  describe('sortSnapshot', () => {
    it('sorts items by __typename then eventType', () => {
      const items = [
        { __typename: 'LedgerEntry', eventType: 'ORDER_FILLED', payload: {} },
        { __typename: 'AccountSnapshot', cashBalanceCents: 1000 },
        { __typename: 'LedgerEntry', eventType: 'DEPOSIT_DETECTED', payload: {} },
      ];

      const sorted = sortSnapshot(items);

      expect(sorted[0].__typename).toBe('AccountSnapshot');
      expect(sorted[1].eventType).toBe('DEPOSIT_DETECTED');
      expect(sorted[2].eventType).toBe('ORDER_FILLED');
    });
  });

  describe('assertEquivalentState', () => {
    it('passes for identical snapshots', () => {
      const a = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      const b = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      expect(() => assertEquivalentState(a, b)).not.toThrow();
    });

    it('fails for different snapshots', () => {
      const a = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      const b = [{ __typename: 'LedgerEntry', eventType: 'DEPOSIT_DETECTED' }];
      expect(() => assertEquivalentState(a, b)).toThrow();
    });

    it('fails for different item counts', () => {
      const a = [{ __typename: 'LedgerEntry' }];
      const b = [{ __typename: 'LedgerEntry' }, { __typename: 'LedgerEntry' }];
      expect(() => assertEquivalentState(a, b)).toThrow();
    });
  });
});
