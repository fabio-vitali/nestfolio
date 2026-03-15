import type { AccumulateIntent, KeyOverrides } from '../types/write-intent';

interface AccumulateConfig {
  field: string;
  increment: number;
  ttl?: number;
  overrides?: KeyOverrides;
}

export function accumulate(typename: string, config: AccumulateConfig): AccumulateIntent {
  return {
    _tag: 'accumulate',
    typename,
    field: config.field,
    increment: config.increment,
    ttl: config.ttl,
    overrides: config.overrides,
  };
}
