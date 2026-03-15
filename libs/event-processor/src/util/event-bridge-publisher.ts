import { EventBridgeClient, PutEventsCommand, type PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { NotRetryableError } from '@nestfolio/lambda-utils';

const BATCH_SIZE = 10;
const MAX_RETRIES = 2;
const RETRYABLE_CODES = new Set(['ThrottlingException', 'InternalException']);

export class EventBridgePublisher {
  private readonly client: EventBridgeClient;

  constructor(
    _busName: string,
    _source: string,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({});
  }

  async publish(entries: PutEventsRequestEntry[]): Promise<void> {
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      let pending = entries.slice(i, i + BATCH_SIZE);

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const result = await this.client.send(new PutEventsCommand({ Entries: pending }));

        if (!result.FailedEntryCount || result.FailedEntryCount === 0) break;

        const resultEntries = result.Entries ?? [];
        const failed = resultEntries
          .map((entry, idx) => ({ ...entry, original: pending[idx] }))
          .filter((entry) => entry.ErrorCode);

        const hasNonRetryable = failed.some((e) => !RETRYABLE_CODES.has(e.ErrorCode!));
        if (hasNonRetryable) {
          throw new NotRetryableError(
            `Non-retryable EventBridge publish failure: ${failed.map((e) => e.ErrorCode).join(', ')}`,
          );
        }

        if (attempt < MAX_RETRIES) {
          pending = failed.map((e) => e.original);
          continue;
        }

        throw new Error(
          `Failed to publish ${result.FailedEntryCount} event(s) to EventBridge after ${MAX_RETRIES} retries`,
        );
      }
    }
  }
}
