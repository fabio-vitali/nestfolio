import { randomUUID } from 'node:crypto';

/**
 * Base event type — all events in the system extend this.
 */
export type Event = {
  id: string;
  type: string;
  timestamp: string;
};

/**
 * Pipe interface — processes a single unit of work asynchronously.
 * Each pipe represents a single processing step in a pipeline.
 */
export type Pipe<T, O = void> = {
  process(uow: T): Promise<O>;
};

/**
 * UnitOfWork — wraps an event with its parsed payload and raw record for pipeline processing.
 * T = event type, R = raw record type (e.g., SQSRecord, DynamoDBRecord)
 */
export type UnitOfWork<T = Event, R = unknown> = {
  event: T;
  payload: Record<string, unknown>;
  record: R;
  batch?: UnitOfWork<T, R>[];
};

/**
 * Returns the value of a required environment variable.
 * Throws if the variable is not set.
 */
export function envVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Returns the current time as an ISO 8601 string.
 */
export function getTime(): string {
  return new Date().toISOString();
}

/**
 * Generates a new UUID v4 string.
 */
export function getUUID(): string {
  return randomUUID();
}
