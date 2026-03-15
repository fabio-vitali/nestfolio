import type { SQSRecord } from 'aws-lambda';

export interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId?: string;
  readonly timestamp: string;
  readonly receiveCount: number;
  readonly serviceName: string;
  readonly record: SQSRecord;
}
