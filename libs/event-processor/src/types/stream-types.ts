import type { DynamoDBRecord } from 'aws-lambda';

export interface StreamRecord {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: string;
  readonly tenantId: string;
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  readonly sequenceNo?: number;
  readonly [key: string]: unknown;
}

export interface StreamContext {
  readonly serviceName: string;
  readonly record: DynamoDBRecord;
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  readonly keys: { pk: string; sk: string };
  readonly typename: string;
  readonly tenantId: string;
  readonly newImage?: Record<string, unknown>;
  readonly oldImage?: Record<string, unknown>;
}
