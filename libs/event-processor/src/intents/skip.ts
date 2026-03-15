import type { SkipIntent } from '../types/write-intent';

export function skip(): SkipIntent {
  return { _tag: 'skip' };
}
