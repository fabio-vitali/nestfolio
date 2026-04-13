/**
 * Tests for ledger-ctrl reducer handler (replayAndReduce config).
 *
 * Strategy: mock replayAndReduce to capture the config, then test the
 * config callbacks (filter, groupBy.key, reducer, queryEvents, requestContext, saveSnapshot).
 */

let capturedConfig: any;

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    replayAndReduce: jest.fn().mockImplementation((config) => {
      capturedConfig = config;
      return jest.fn(); // handler function
    }),
    requireEnv: jest.fn(() => 'test-table'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

jest.mock('../../src/repositories/ledger.repository', () => ({
  LedgerRepository: jest.fn().mockImplementation(() => ({
    getLatestSnapshot: jest.fn(),
    queryEntriesSince: jest.fn().mockResolvedValue([]),
    saveSnapshot: jest.fn().mockResolvedValue(undefined),
    saveSnapshotWithEvents: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

process.env['TABLE_NAME'] = 'test-table';

import { replayAndReduce } from '@nestfolio/event-processor';
import { LedgerRepository } from '../../src/repositories/ledger.repository';
import { handler } from '../../src/handlers/reducer';
import { INITIAL_ACCOUNT_STATE } from '../../src/domain';

describe('ledger-ctrl reducer handler', () => {
  it('should call replayAndReduce with correct config', () => {
    expect(replayAndReduce).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.groupBy?.key).toBeDefined();
    expect(capturedConfig.reducer).toBeDefined();
    expect(capturedConfig.queryEvents).toBeDefined();
    expect(capturedConfig.requestContext).toBeDefined();
    expect(capturedConfig.saveSnapshot).toBeDefined();
  });

  it('handler should be a function', () => {
    expect(typeof handler).toBe('function');
  });

  describe('filter', () => {
    it('should accept records with __typename LedgerEntry', () => {
      expect(capturedConfig.filter({ __typename: 'LedgerEntry' })).toBe(true);
    });

    it('should reject records with other __typename', () => {
      expect(capturedConfig.filter({ __typename: 'AccountSnapshot' })).toBe(false);
    });

    it('should reject records with no __typename', () => {
      expect(capturedConfig.filter({})).toBe(false);
    });
  });

  describe('groupBy.key', () => {
    it('should group by tenantId#streamType', () => {
      expect(capturedConfig.groupBy.key({ tenantId: 'tenant-1', streamType: 'actual' }))
        .toBe('tenant-1#actual');
    });

    it('should produce distinct keys for different tenants', () => {
      const k1 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'actual' });
      const k2 = capturedConfig.groupBy.key({ tenantId: 'b', streamType: 'actual' });
      expect(k1).not.toBe(k2);
    });

    it('should produce distinct keys for different stream types', () => {
      const k1 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'actual' });
      const k2 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'simulated' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('snapshot.key', () => {
    it('should return correct pk/sk', () => {
      const key = capturedConfig.snapshot.key('tenant-1#actual');
      expect(key).toEqual({ pk: 'Account#tenant-1#actual', sk: 'Snapshot#latest' });
    });
  });

  describe('requestContext', () => {
    it('should extract tenantId from groupKey and userId/region from records', () => {
      const ctx = capturedConfig.requestContext('tenant-1#actual', [
        { userId: 'user-1', region: 'us-west-2' },
      ]);
      expect(ctx.tenantId).toBe('tenant-1');
      expect(ctx.userId).toBe('user-1');
      expect(ctx.region).toBe('us-west-2');
    });

    it('should default userId and region when not in records', () => {
      const ctx = capturedConfig.requestContext('tenant-1#actual', [{}]);
      expect(ctx.userId).toBe('system');
      expect(ctx.region).toBe('us-east-1');
    });
  });

  describe('reducer', () => {
    it('should apply accountReducer to state and event', () => {
      const result = capturedConfig.reducer(INITIAL_ACCOUNT_STATE, {
        eventId: 'e1',
        eventType: 'ORDER_FILLED',
        payload: {
          orderId: 'o1', symbol: 'AAPL', side: 'BUY',
          quantity: 10, fillPrice: 150.0, filledAt: '2025-01-01T00:00:00.000Z',
        },
        sequenceNo: 1,
      });
      expect(result.positions['AAPL']).toBeDefined();
      expect(result.positions['AAPL'].quantity).toBe(10);
    });
  });

  describe('saveSnapshot', () => {
    const mockRepo = (LedgerRepository as unknown as jest.Mock).mock.results[0].value;

    it('should delegate to repository.saveSnapshot', async () => {
      await capturedConfig.saveSnapshot({
        snapshotKey: { pk: 'Account#t1#actual', sk: 'Snapshot#latest' },
        state: INITIAL_ACCOUNT_STATE,
        lastEventSequence: 5,
        version: 2,
        requestContext: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
        clients: {},
      });

      expect(mockRepo.saveSnapshot).toHaveBeenCalledWith(
        'actual',
        INITIAL_ACCOUNT_STATE,
        5,
        2,
        { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      );
    });
  });
});
