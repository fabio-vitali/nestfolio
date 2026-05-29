import type { UpdateIntent, KeyOverrides } from '../types/write-intent';
import type { RejectProjection } from '../types/ownership';

/**
 * @remarks Ownership enforcement requires a string-literal `typename`; a widened `string` bypasses it. See types/ownership.ts.
 */
export function update<K extends string>(
  typename: RejectProjection<K>,
  updates: Record<string, unknown>,
  options?: {
    removes?: string[];
    condition?: string;
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    overrides?: KeyOverrides;
  },
): UpdateIntent {
  const name = typename as string;
  return {
    _tag: 'update',
    typename: name,
    updates,
    ...(options?.removes ? { removes: options.removes } : {}),
    ...(options?.condition ? { condition: options.condition } : {}),
    ...(options?.conditionNames ? { conditionNames: options.conditionNames } : {}),
    ...(options?.conditionValues ? { conditionValues: options.conditionValues } : {}),
    ...(options?.overrides ? { overrides: options.overrides } : {}),
  };
}
