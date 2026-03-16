import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger, getUUID, getTime } from '../internal';

export class ErrorEventPublisher {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    private readonly serviceName: string,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({});
  }

  async publishErrors(
    errors: Array<{ error: Error; causedBy: unknown; groupKey?: string }>,
    errorEventType: string,
  ): Promise<void> {
    for (const { error, causedBy, groupKey } of errors) {
      try {
        const detail = {
          id: getUUID(),
          type: errorEventType,
          timestamp: getTime(),
          subject: {
            error: error.message,
            stack: error.stack,
            causedBy,
            ...(groupKey && { groupKey }),
          },
          context: { serviceName: this.serviceName },
        };

        await this.client.send(new PutEventsCommand({
          Entries: [{
            EventBusName: this.busName,
            Source: `${this.busName}@${this.serviceName}`,
            DetailType: errorEventType,
            Detail: JSON.stringify(detail),
          }],
        }));
      } catch (pubErr) {
        logger.warn('Failed to publish error event', {
          pubErr: pubErr instanceof Error ? pubErr.message : String(pubErr),
          originalError: error.message,
        });
      }
    }
  }
}
