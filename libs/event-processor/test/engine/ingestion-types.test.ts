import type { IngestionRecord, IngestionResult } from '../../src/engine/ingestion-types';

describe('ingestion-types', () => {
  it('IngestionRecord satisfies its shape', () => {
    const record: IngestionRecord = {
      id: 'msg-1',
      event: { id: 'evt-1', type: 'TEST', timestamp: '2026-01-01T00:00:00Z', subject: {}, context: { tenantId: 't1', userId: 'test-user', region: 'us-east-1' } },
      metadata: { receiveCount: 1 },
    };
    expect(record.id).toBe('msg-1');
  });

  it('IngestionRecord metadata.receiveCount is optional', () => {
    const record: IngestionRecord = {
      id: 'seq-1',
      event: { id: 'evt-1', type: 'TEST', timestamp: '2026-01-01T00:00:00Z', subject: {}, context: { tenantId: 't1', userId: 'test-user', region: 'us-east-1' } },
      metadata: {},
    };
    expect(record.metadata.receiveCount).toBeUndefined();
  });

  it('IngestionResult satisfies its shape', () => {
    const result: IngestionResult = {
      failures: ['msg-1'],
      metrics: { EventProcessed: 1 },
      droppedErrors: [],
    };
    expect(result.failures).toHaveLength(1);
  });
});
