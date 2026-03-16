import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

export abstract class EventRepository {
  protected readonly client: EventBridgeClient;

  constructor(
    protected readonly busName: string,
    protected readonly serviceName: string,
  ) {
    this.client = new EventBridgeClient({});
  }
}
