import type { KinesisStreamEvent, KinesisStreamBatchResponse } from 'aws-lambda';
import type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
import { parseKinesisRecord } from './parse-kinesis-record';

export class KinesisIngestionAdapter
  implements IngestionAdapter<KinesisStreamEvent, KinesisStreamBatchResponse>
{
  toRecords(event: KinesisStreamEvent): IngestionRecord[] {
    return event.Records.map((record) => parseKinesisRecord(record));
  }

  toResponse(result: IngestionResult): KinesisStreamBatchResponse {
    return {
      batchItemFailures: result.failures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
