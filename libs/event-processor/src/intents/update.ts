import type { UpdateIntent, KeyOverrides } from '../types/write-intent';

export function update(
  typename: string,
  updates: Record<string, unknown>,
  options?: { removes?: string[]; condition?: string; overrides?: KeyOverrides },
): UpdateIntent {
  return {
    _tag: 'update',
    typename,
    updates,
    ...(options?.removes ? { removes: options.removes } : {}),
    ...(options?.condition ? { condition: options.condition } : {}),
    ...(options?.overrides ? { overrides: options.overrides } : {}),
  };
}
