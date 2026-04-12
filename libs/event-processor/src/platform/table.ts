import type { RequestContext } from '../domain/schemas';

export type TableEntry<T extends object = object, S = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  ttl?: number;
} & S;
