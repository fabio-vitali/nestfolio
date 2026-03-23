import type { SQSEvent } from 'aws-lambda';
import { SqsIngestionAdapter } from '../../src/engine/sqs-adapter';
import { fakeSqsRecord } from '../../src/testing/fake-records';
import type { IngestionResult } from '../../src/engine/ingestion-types';

function makeSqsEvent(...records: ReturnType<typeof fakeSqsRecord>[]): SQSEvent {
  return { Records: records };
}

describe('SqsIngestionAdapter', () => {
  describe('toRecords()', () => {
    it('converts SQSEvent.Records to IngestionRecord[] via parseSqsRecord', () => {
      const adapter = new SqsIngestionAdapter();
      const r1 = fakeSqsRecord('ORDER_FILLED', { amount: 100 }, { tenantId: 'tenant-1' });
      const r2 = fakeSqsRecord('DEPOSIT_INITIATED', { currency: 'USD' }, { tenantId: 'tenant-2' });
      const event = makeSqsEvent(r1, r2);

      const records = adapter.toRecords(event);

      expect(records).toHaveLength(2);
      expect(records[0].id).toBe(r1.messageId);
      expect(records[0].event.type).toBe('ORDER_FILLED');
      expect(records[1].id).toBe(r2.messageId);
      expect(records[1].event.type).toBe('DEPOSIT_INITIATED');
    });

    it('filters out poison pills (receiveCount > max)', () => {
      const adapter = new SqsIngestionAdapter({ poisonPillMaxReceiveCount: 3 });
      const normal = fakeSqsRecord('ORDER_FILLED', { amount: 50 }, { receiveCount: 3 });
      const poison = fakeSqsRecord('ORDER_FILLED', { amount: 99 }, { receiveCount: 4 });
      const event = makeSqsEvent(normal, poison);

      const records = adapter.toRecords(event);

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(normal.messageId);
    });

    it('returns empty array when all records are poison pills', () => {
      const adapter = new SqsIngestionAdapter({ poisonPillMaxReceiveCount: 2 });
      const p1 = fakeSqsRecord('A', {}, { receiveCount: 3 });
      const p2 = fakeSqsRecord('B', {}, { receiveCount: 10 });

      const records = adapter.toRecords(makeSqsEvent(p1, p2));

      expect(records).toHaveLength(0);
    });

    it('uses default max receive count of 5 when no options provided', () => {
      const adapter = new SqsIngestionAdapter();
      const borderline = fakeSqsRecord('X', {}, { receiveCount: 5 });
      const overLimit = fakeSqsRecord('X', {}, { receiveCount: 6 });

      const records = adapter.toRecords(makeSqsEvent(borderline, overLimit));

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(borderline.messageId);
    });

    it('propagates parse errors (throws NotRetryableError) for malformed records', () => {
      const adapter = new SqsIngestionAdapter();
      const malformed = fakeSqsRecord('TEST', {});
      malformed.body = 'not json';

      expect(() => adapter.toRecords(makeSqsEvent(malformed))).toThrow('Malformed SQS message body');
    });
  });

  describe('countPoisonPills()', () => {
    it('counts records exceeding maxReceiveCount', () => {
      const adapter = new SqsIngestionAdapter({ poisonPillMaxReceiveCount: 3 });
      const r1 = fakeSqsRecord('A', {}, { receiveCount: 1 });
      const r2 = fakeSqsRecord('B', {}, { receiveCount: 4 });
      const r3 = fakeSqsRecord('C', {}, { receiveCount: 5 });

      const count = adapter.countPoisonPills(makeSqsEvent(r1, r2, r3));

      expect(count).toBe(2);
    });

    it('returns 0 when no poison pills exist', () => {
      const adapter = new SqsIngestionAdapter({ poisonPillMaxReceiveCount: 5 });
      const r1 = fakeSqsRecord('A', {}, { receiveCount: 1 });
      const r2 = fakeSqsRecord('B', {}, { receiveCount: 5 });

      expect(adapter.countPoisonPills(makeSqsEvent(r1, r2))).toBe(0);
    });
  });

  describe('toResponse()', () => {
    it('maps IngestionResult.failures to SQSBatchResponse.batchItemFailures', () => {
      const adapter = new SqsIngestionAdapter();
      const result: IngestionResult = {
        failures: ['msg-1', 'msg-2'],
        metrics: {},
        droppedErrors: [],
      };

      const response = adapter.toResponse(result);

      expect(response.batchItemFailures).toEqual([
        { itemIdentifier: 'msg-1' },
        { itemIdentifier: 'msg-2' },
      ]);
    });

    it('returns empty batchItemFailures when no failures', () => {
      const adapter = new SqsIngestionAdapter();
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
