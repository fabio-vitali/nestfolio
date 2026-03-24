import type { RequestContext } from '../domain/schemas';

export type TableEntry<T = Record<string, unknown>, S = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  timestamp: string;
  ttl?: number;
} & S;
