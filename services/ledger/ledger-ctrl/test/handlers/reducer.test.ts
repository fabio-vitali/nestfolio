/**
 * Tests for ledger-ctrl reducer handler.
 *
 * Strategy: mock replayAndReduce and capture the config passed to it,
 * then test the config callbacks (filter, groupBy.key, reducer, snapshot.key)
 * and verify that handler = the return value of replayAndReduce(config).
 */

let capturedConfig: any;
const mockHandler = jest.fn();

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  replayAndReduce: jest.fn((config) => {
    capturedConfig = config;
    return mockHandler;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env['TABLE_NAME'] = 'test-table';

import { replayAndReduce } from '@nestfolio/event-processor';
import { handler } from '../../src/handlers/reducer';
import { INITIAL_ACCOUNT_STATE } from '../../src/domain';

describe('ledger-ctrl reducer handler (replayAndReduce)', () => {
  it('should call replayAndReduce with correct config', () => {
    expect(replayAndReduce).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.groupBy?.key).toBeDefined();
    expect(capturedConfig.reducer).toBeDefined();
    expect(capturedConfig.initialState).toEqual(INITIAL_ACCOUNT_STATE);
    expect(capturedConfig.snapshot?.key).toBeDefined();
    expect(capturedConfig.snapshot?.daily).toBe(true);
  });

  it('handler should be the result of replayAndReduce', () => {
    expect(handler).toBe(mockHandler);
  });

  describe('filter', () => {
    it('should accept records with __typename LedgerEntry', () => {
      const record = { __typename: 'LedgerEntry', tenantId: 't1', streamType: 'actual' };
      expect(capturedConfig.filter(record)).toBe(true);
    });

    it('should reject records with other __typename', () => {
      const record = { __typename: 'AccountSnapshot', tenantId: 't1', streamType: 'actual' };
      expect(capturedConfig.filter(record)).toBe(false);
    });

    it('should reject records with no __typename', () => {
      const record = { tenantId: 't1', streamType: 'actual' };
      expect(capturedConfig.filter(record)).toBe(false);
    });
  });

  describe('groupBy.key', () => {
    it('should group by tenantId#streamType', () => {
      const record = { __typename: 'LedgerEntry', tenantId: 'tenant-1', streamType: 'actual' };
      expect(capturedConfig.groupBy.key(record)).toBe('tenant-1#actual');
    });

    it('should produce distinct keys for different tenants', () => {
      const r1 = { tenantId: 'a', streamType: 'actual' };
      const r2 = { tenantId: 'b', streamType: 'actual' };
      expect(capturedConfig.groupBy.key(r1)).not.toBe(capturedConfig.groupBy.key(r2));
    });

    it('should produce distinct keys for different stream types', () => {
      const r1 = { tenantId: 'a', streamType: 'actual' };
      const r2 = { tenantId: 'a', streamType: 'simulated' };
      expect(capturedConfig.groupBy.key(r1)).not.toBe(capturedConfig.groupBy.key(r2));
    });
  });

  describe('snapshot.key', () => {
    it('should produce pk=Account#tenantId#streamType, sk=Snapshot#latest', () => {
      const key = capturedConfig.snapshot.key('tenant-1#actual');
      expect(key).toEqual({ pk: 'Account#tenant-1#actual', sk: 'Snapshot#latest' });
    });

    it('should handle different stream types', () => {
      const key = capturedConfig.snapshot.key('tenant-2#simulated');
      expect(key).toEqual({ pk: 'Account#tenant-2#simulated', sk: 'Snapshot#latest' });
    });
  });

  describe('reducer', () => {
    it('should return initial state for unknown event types', () => {
      const state = INITIAL_ACCOUNT_STATE;
      const event = {
        eventId: 'e1', eventType: 'UNKNOWN_EVENT',
        payload: {}, timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 1,
      };
      const next = capturedConfig.reducer(state, event);
      expect(next).toEqual(state);
    });

    it('should apply DEPOSIT_DETECTED to increase cash balance', () => {
      const state = INITIAL_ACCOUNT_STATE;
      const event = {
        eventId: 'e1', eventType: 'DEPOSIT_DETECTED',
        payload: { depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z' },
        timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 1,
      };
      const next = capturedConfig.reducer(state, event);
      // DEPOSIT_DETECTED increases cashBalanceCents
      expect(next.cashBalanceCents).toBeGreaterThan(state.cashBalanceCents);
    });

    it('should apply ORDER_FILLED to update positions', () => {
      const state = INITIAL_ACCOUNT_STATE;
      const event = {
        eventId: 'e1', eventType: 'ORDER_FILLED',
        payload: {
          orderId: 'o1', symbol: 'VTI', side: 'BUY',
          quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z',
        },
        timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 1,
      };
      const next = capturedConfig.reducer(state, event);
      // BUY order should create a position for VTI
      expect(next.positions['VTI']).toBeDefined();
      expect(next.positions['VTI'].quantity).toBe(10);
    });

    it('should return unchanged state for ORDER_REJECTED', () => {
      const state = INITIAL_ACCOUNT_STATE;
      const event = {
        eventId: 'e1', eventType: 'ORDER_REJECTED',
        payload: { orderId: 'o1' },
        timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 1,
      };
      const next = capturedConfig.reducer(state, event);
      expect(next).toEqual(state);
    });
  });
});
