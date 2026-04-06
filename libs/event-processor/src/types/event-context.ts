import type { RequestContext } from '../domain/schemas';

export interface EventContext extends RequestContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly receiveCount?: number;
  readonly serviceName: string;
  readonly record: unknown;
}
