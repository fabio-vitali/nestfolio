import type { StoreIntent } from '../types/write-intent';

export function store(body: unknown, opts?: { format?: 'json' | 'csv'; key?: string }): StoreIntent {
  return {
    _tag: 'store',
    body,
    format: opts?.format ?? 'json',
    key: opts?.key,
  };
}
