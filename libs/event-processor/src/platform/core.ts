import { randomUUID } from 'node:crypto';

export type Event = {
  id: string;
  type: string;
  timestamp: string;
};

export type Pipe<T, O = void> = {
  process(uow: T): Promise<O>;
};

export type UnitOfWork<T = Event, R = unknown> = {
  event: T;
  payload: Record<string, unknown>;
  record: R;
  batch?: UnitOfWork<T, R>[];
};

export function envVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export function getTime(): string {
  return new Date().toISOString();
}

export function getUUID(): string {
  return randomUUID();
}
