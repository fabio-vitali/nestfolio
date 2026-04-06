/**
 * Tests for ledger-ctrl reducer handler.
 *
 * Strategy: mock EgestionEngine to capture config, then test the config
 * callbacks (filter, groupBy.key) and the processGroup logic which loads
 * snapshots, queries events, reduces, and calls saveSnapshotWithEvents.
 */

let capturedConfig: any;

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    EgestionEngine: jest.fn().mockImplementation((config) => {
      capturedConfig = config;
      return { process: jest.fn() };
    }),
    requireEnv: jest.fn(() => 'test-table'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

jest.mock('../../src/repositories/ledger.repository', () => ({
  LedgerRepository: jest.fn().mockImplementation(() => ({
    getLatestSnapshot: jest.fn(),
    queryEntriesSince: jest.fn(),
    saveSnapshotWithEvents: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

process.env['TABLE_NAME'] = 'test-table';

import { EgestionEngine } from '@nestfolio/event-processor';
import { LedgerRepository } from '../../src/repositories/ledger.repository';
import { handler } from '../../src/handlers/reducer';

describe('ledger-ctrl reducer handler', () => {
  it('should construct EgestionEngine with correct config', () => {
    expect(EgestionEngine).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.groupBy?.key).toBeDefined();
    expect(capturedConfig.processGroup).toBeDefined();
  });

  it('handler should be a function', () => {
    expect(typeof handler).toBe('function');
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

  describe('processGroup', () => {
    // Capture the repo instance created at module-load time (before clearAllMocks wipes it)
    const mockRepo = (LedgerRepository as unknown as jest.Mock).mock.results[0].value;

    beforeEach(() => {
      mockRepo.getLatestSnapshot.mockReset();
      mockRepo.queryEntriesSince.mockReset();
      mockRepo.saveSnapshotWithEvents.mockReset();
    });

    it('should skip when no new events found', async () => {
      mockRepo.getLatestSnapshot.mockResolvedValue(null);
      mockRepo.queryEntriesSince.mockResolvedValue([]);

      await capturedConfig.processGroup('tenant-1#actual', [{ userId: 'u1', region: 'us-east-1' }]);

      expect(mockRepo.getLatestSnapshot).toHaveBeenCalledWith('tenant-1', 'actual');
      expect(mockRepo.queryEntriesSince).toHaveBeenCalledWith('tenant-1', 'actual', 0);
      expect(mockRepo.saveSnapshotWithEvents).not.toHaveBeenCalled();
    });

    it('should use INITIAL_ACCOUNT_STATE when no snapshot exists', async () => {
      mockRepo.getLatestSnapshot.mockResolvedValue(null);
      mockRepo.queryEntriesSince.mockResolvedValue([{
        eventId: 'e1',
        eventType: 'ORDER_FILLED',
        payload: {
          orderId: 'o1', symbol: 'AAPL', side: 'BUY',
          quantity: 10, fillPrice: 150.0, filledAt: '2025-01-01T00:00:00.000Z',
        },
        sequenceNo: 1,
      }]);
      mockRepo.saveSnapshotWithEvents.mockResolvedValue(undefined);

      await capturedConfig.processGroup('tenant-1#actual', [{ userId: 'u1', region: 'us-east-1' }]);

      expect(mockRepo.saveSnapshotWithEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          streamType: 'actual',
          version: 1,
          lastEventSequence: 1,
          balanceChanged: true,
          positionsChanged: true,
        }),
        expect.objectContaining({ tenantId: 'tenant-1' }),
      );
    });

    it('should detect balance change on ORDER_FILLED', async () => {
      mockRepo.getLatestSnapshot.mockResolvedValue({
        positions: {},
        cashBalanceCents: 10_000_000,
        lastEventSequence: 0,
        version: 1,
      });
      mockRepo.queryEntriesSince.mockResolvedValue([{
        eventId: 'e1',
        eventType: 'ORDER_FILLED',
        payload: {
          orderId: 'o1', symbol: 'VTI', side: 'BUY',
          quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z',
        },
        sequenceNo: 1,
      }]);
      mockRepo.saveSnapshotWithEvents.mockResolvedValue(undefined);

      await capturedConfig.processGroup('tenant-1#actual', [{ userId: 'u1', region: 'us-east-1' }]);

      const savedData = mockRepo.saveSnapshotWithEvents.mock.calls[0][0];
      expect(savedData.balanceChanged).toBe(true);
      expect(savedData.positionsChanged).toBe(true);
      expect(savedData.version).toBe(2);
      expect(savedData.lastEventSequence).toBe(1);

      const state = savedData.state;
      expect(state.positions['VTI']).toBeDefined();
      expect(state.positions['VTI'].quantity).toBe(10);
      // Cash should decrease by 10 * 245.50 * 100 = 245500 cents
      expect(state.cashBalanceCents).toBe(10_000_000 - 245_500);
    });

    it('should not flag balance/position change for ORDER_REJECTED', async () => {
      mockRepo.getLatestSnapshot.mockResolvedValue({
        positions: {},
        cashBalanceCents: 10_000_000,
        lastEventSequence: 0,
        version: 1,
      });
      mockRepo.queryEntriesSince.mockResolvedValue([{
        eventId: 'e1',
        eventType: 'ORDER_REJECTED',
        payload: { orderId: 'o1' },
        sequenceNo: 1,
      }]);
      mockRepo.saveSnapshotWithEvents.mockResolvedValue(undefined);

      await capturedConfig.processGroup('tenant-1#actual', [{ userId: 'u1', region: 'us-east-1' }]);

      const savedData = mockRepo.saveSnapshotWithEvents.mock.calls[0][0];
      expect(savedData.balanceChanged).toBe(false);
      expect(savedData.positionsChanged).toBe(false);
    });
  });
});
