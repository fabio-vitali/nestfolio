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
    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: `${this.busName}@${this.serviceName}`,
            DetailType: event.type,
            Detail: JSON.stringify(event),
          },
        ],
      }),
    );

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failedEntry = result.Entries?.[0];
      throw new NotRetryableError(
        `EventBridge publish failed: ${failedEntry?.ErrorMessage ?? 'unknown error'}`,
        {
          errorCode: failedEntry?.ErrorCode,
          eventType: event.type,
          eventId: event.id,
        },
      );
    }
  }
}
