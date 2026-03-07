import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

/**
 * Abstract base class for EventBridge repositories.
 * Extended by EventBridgeBus for event publishing.
 */
export abstract class EventRepository {
  protected readonly client: EventBridgeClient;

  constructor(
    protected readonly busName: string,
    protected readonly serviceName: string,
  ) {
    this.client = new EventBridgeClient({});
  }
}
