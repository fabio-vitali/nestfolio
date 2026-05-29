import type { UpdateIntent, KeyOverrides } from '../types/write-intent';
import type { RejectProjection } from '../types/ownership';

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
  return {
    _tag: 'update',
    typename: typename as string,
    updates,
    ...(options?.removes ? { removes: options.removes } : {}),
    ...(options?.condition ? { condition: options.condition } : {}),
    ...(options?.conditionNames ? { conditionNames: options.conditionNames } : {}),
    ...(options?.conditionValues ? { conditionValues: options.conditionValues } : {}),
    ...(options?.overrides ? { overrides: options.overrides } : {}),
  };
}
