import type { KinesisStreamEvent } from 'aws-lambda';
import { KinesisIngestionAdapter } from '../../src/engine/kinesis-adapter';
import { fakeKinesisRecord } from '../../src/testing/fake-records';
import type { IngestionResult } from '../../src/engine/ingestion-types';
import type { BusEvent } from '../../src/platform';

function makeKinesisEvent(
  ...records: ReturnType<typeof fakeKinesisRecord>[]
): KinesisStreamEvent {
  return { Records: records };
}

describe('KinesisIngestionAdapter', () => {
  describe('toRecords()', () => {
    it('decodes Kinesis records via parseKinesisRecord', () => {
      const adapter = new KinesisIngestionAdapter();
      const r = fakeKinesisRecord('ORDER_FILLED', { amount: 100 }, { tenantId: 'tenant-1' });
      const event = makeKinesisEvent(r);

      const records = adapter.toRecords(event);

      expect(records).toHaveLength(1);
      expect(records[0].event.type).toBe('ORDER_FILLED');
      expect((records[0].event as BusEvent<Record<string, unknown>>).subject).toEqual({ amount: 100 });
      expect((records[0].event.context as Record<string, unknown>).tenantId).toBe('tenant-1');
    });

    it('handles multiple records', () => {
      const adapter = new KinesisIngestionAdapter();
      const r1 = fakeKinesisRecord('ORDER_FILLED', { amount: 100 }, { tenantId: 'tenant-1' });
      const r2 = fakeKinesisRecord('DEPOSIT_INITIATED', { currency: 'USD' }, { tenantId: 'tenant-2' });
      const event = makeKinesisEvent(r1, r2);

      const records = adapter.toRecords(event);

      expect(records).toHaveLength(2);
      expect(records[0].event.type).toBe('ORDER_FILLED');
      expect(records[1].event.type).toBe('DEPOSIT_INITIATED');
    });

    it('sets id to sequenceNumber', () => {
      const adapter = new KinesisIngestionAdapter();
      const seqNo = 'seq-abc-123';
      const r = fakeKinesisRecord('TEST_EVENT', {}, { sequenceNumber: seqNo });
      const event = makeKinesisEvent(r);

      const records = adapter.toRecords(event);

      expect(records[0].id).toBe(seqNo);
    });

    it('does NOT filter poison pills (no receiveCount concept)', () => {
      const adapter = new KinesisIngestionAdapter();
      const r1 = fakeKinesisRecord('A', {});
      const r2 = fakeKinesisRecord('B', {});
      const r3 = fakeKinesisRecord('C', {});
      const event = makeKinesisEvent(r1, r2, r3);

      const records = adapter.toRecords(event);

      expect(records).toHaveLength(3);
    });
  });

  describe('toResponse()', () => {
    it('maps failures to KinesisStreamBatchResponse.batchItemFailures', () => {
      const adapter = new KinesisIngestionAdapter();
      const result: IngestionResult = {
        failures: ['seq-1', 'seq-2'],
        metrics: {},
        droppedErrors: [],
      };

      const response = adapter.toResponse(result);

      expect(response.batchItemFailures).toEqual([
        { itemIdentifier: 'seq-1' },
        { itemIdentifier: 'seq-2' },
      ]);
    });

    it('returns empty batchItemFailures when no failures', () => {
      const adapter = new KinesisIngestionAdapter();
      const result: IngestionResult = {
        failures: [],
        metrics: {},
        droppedErrors: [],
      };

      const response = adapter.toResponse(result);

      expect(response.batchItemFailures).toEqual([]);
    });
  });
});
