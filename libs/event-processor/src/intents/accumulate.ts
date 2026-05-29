import type { AccumulateIntent, KeyOverrides } from '../types/write-intent';
import type { RejectProjection } from '../types/ownership';

interface AccumulateConfig {
  field: string;
  increment: number;
  ttl?: number;
  overrides?: KeyOverrides;
}

/**
 * @remarks Ownership enforcement requires a string-literal `typename`; a widened `string` bypasses it. See types/ownership.ts.
 */
export function accumulate<K extends string>(typename: RejectProjection<K>, config: AccumulateConfig): AccumulateIntent {
  const name = typename as string;
  return {
    _tag: 'accumulate',
    typename: name,
    field: config.field,
    increment: config.increment,
    ttl: config.ttl,
    overrides: config.overrides,
  };
}
