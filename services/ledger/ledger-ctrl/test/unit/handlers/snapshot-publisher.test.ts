let capturedConfig: any;

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    deriveFromStream: jest.fn().mockImplementation((config) => {
      capturedConfig = config;
      return jest.fn(); // handler function
    }),
    requireEnv: jest.fn(() => 'test-table'),
  };
});

process.env['TABLE_NAME'] = 'test-table';

import { deriveFromStream } from '@nestfolio/event-processor';
import { handler } from '../../../src/handlers/snapshot-publisher';

describe('ledger-ctrl snapshot-publisher handler', () => {
  it('should call deriveFromStream with correct config', () => {
    expect(deriveFromStream).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.transform).toBeDefined();
    expect(capturedConfig.errorEventType).toBe('LEDGER_SNAPSHOT_PUBLISHER_FAILED');
  });

  it('handler should be a function', () => {
    expect(typeof handler).toBe('function');
  });

  describe('filter', () => {
    it('should accept AccountSnapshot records', () => {
      expect(capturedConfig.filter({ __typename: 'AccountSnapshot' })).toBe(true);
    });

    it('should reject non-AccountSnapshot records', () => {
      expect(capturedConfig.filter({ __typename: 'LedgerEntry' })).toBe(false);
    });
  });

  describe('transform', () => {
    it('should delegate to snapshotToEvents and return intents', () => {
      const current = {
        pk: 'Account#t1#actual', sk: 'Snapshot#latest', __typename: 'AccountSnapshot',
        tenantId: 't1', streamType: 'actual', timestamp: '2025-01-01T00:00:00.000Z',
        positions: {}, cashBalanceCents: 5_000_000, totalValueCents: 5_000_000,
        lastEventSequence: 1, version: 1, snapshotAt: '2025-01-01T00:00:00.000Z',
      };
      const intents = capturedConfig.transform(current, undefined, {});
      expect(intents.length).toBeGreaterThan(0);
      expect(intents.some((i: any) => i.typename === 'BalanceEvent')).toBe(true);
    });
  });
});
