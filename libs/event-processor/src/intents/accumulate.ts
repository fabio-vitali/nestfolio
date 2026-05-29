import type { AccumulateIntent, KeyOverrides } from '../types/write-intent';
import type { RejectProjection } from '../types/ownership';

interface AccumulateConfig {
  field: string;
  increment: number;
  ttl?: number;
  overrides?: KeyOverrides;
}

export function accumulate<K extends string>(typename: RejectProjection<K>, config: AccumulateConfig): AccumulateIntent {
  return {
    _tag: 'accumulate',
    typename: typename as string,
    field: config.field,
    increment: config.increment,
    ttl: config.ttl,
    overrides: config.overrides,
  };
}
