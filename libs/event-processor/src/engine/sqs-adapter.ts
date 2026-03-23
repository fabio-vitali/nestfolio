import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
import { parseSqsRecord } from './parse-sqs-record';

const DEFAULT_POISON_PILL_MAX = 5;

export interface SqsAdapterOptions {
  poisonPillMaxReceiveCount?: number;
}

export class SqsIngestionAdapter implements IngestionAdapter<SQSEvent, SQSBatchResponse> {
  private readonly maxReceive: number;

  constructor(options?: SqsAdapterOptions) {
    this.maxReceive = options?.poisonPillMaxReceiveCount ?? DEFAULT_POISON_PILL_MAX;
  }

  toRecords(event: SQSEvent): IngestionRecord[] {
    const records: IngestionRecord[] = [];
    for (const sqsRecord of event.Records) {
      const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);
      if (receiveCount > this.maxReceive) {
        continue; // poison pill — skip
      }
      records.push(parseSqsRecord(sqsRecord));
    }
    return records;
  }

  countPoisonPills(event: SQSEvent): number {
    let count = 0;
    for (const sqsRecord of event.Records) {
      const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);
      if (receiveCount > this.maxReceive) count++;
    }
    return count;
  }

  toResponse(result: IngestionResult): SQSBatchResponse {
    return {
      batchItemFailures: result.failures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
