import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { log } from './logger';
import { type Event } from './core';
import { type ErrorEvent, NotRetryableError } from './errors';

/**
 * BusEvent — domain event published to EventBridge.
 * T = subject payload type, S = context type (cross-cutting concerns like tenantId)
 */
export type BusEvent<T = object, S = object> = Event & {
  subject: T;
  context: S;
};

/**
 * Bus interface — publishes events to an event bus.
 */
export interface Bus {
  publish(event: BusEvent | ErrorEvent): Promise<void>;
}

/**
 * EventBridgeBus — publishes events to AWS EventBridge.
 * Source format: "{busName}@{serviceName}"
 */
export class EventBridgeBus implements Bus {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    private readonly serviceName: string,
  ) {
    this.client = new EventBridgeClient({});
  }

  @log()
  async publish(event: BusEvent | ErrorEvent): Promise<void> {
    const detail = JSON.stringify(event);
    const detailSizeBytes = Buffer.byteLength(detail, 'utf-8');
    const MAX_EVENT_SIZE = 256 * 1024; // EventBridge 256KB limit
    if (detailSizeBytes > MAX_EVENT_SIZE) {
      throw new NotRetryableError(
        `Event exceeds EventBridge 256KB size limit: ${detailSizeBytes} bytes (type=${event.type}, id=${event.id})`,
        { eventType: event.type, eventId: event.id, sizeBytes: detailSizeBytes },
      );
    }

    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: `${this.busName}@${this.serviceName}`,
            DetailType: event.type,
            Detail: detail,
          },
        ],
      }),
    );

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failedEntries = (result.Entries ?? []).filter(
        (e: { ErrorCode?: string }) => !!e.ErrorCode,
      );

      // Log all failed entries for observability
      for (const entry of failedEntries) {
        // eslint-disable-next-line no-console
        console.error('EventBridge publish failed entry', {
          errorCode: entry.ErrorCode,
          errorMessage: entry.ErrorMessage,
          eventType: event.type,
          eventId: event.id,
        });
      }

      const firstFailed = failedEntries[0];
      const errorCode = firstFailed?.ErrorCode ?? 'UnknownError';
      const errorMessage = firstFailed?.ErrorMessage ?? 'unknown error';

      // Retryable codes: throttling or internal service errors
      const RETRYABLE_CODES = ['ThrottlingException', 'InternalException'];
      if (RETRYABLE_CODES.includes(errorCode)) {
        throw new Error(
          `EventBridge publish failed (retryable): ${errorMessage}`,
        );
      }

      // All other error codes are non-retryable → DLQ
      throw new NotRetryableError(
        `EventBridge publish failed: ${errorMessage}`,
        {
          errorCode,
          eventType: event.type,
          eventId: event.id,
          failedEntryCount: failedEntries.length,
        },
      );
    }
  }
}
