/** Minimal structural view of an event-processor IntentResult (no cross-lib import). */
export interface VersionedResult {
  readonly _tag: string;
  readonly success: boolean;
  readonly deduplicated?: boolean;
}

/** Assert a projectVersioned write was dropped because the event was stale/duplicate. */
export function expectStaleDrop(result: VersionedResult): void {
  if (!(result.success && result.deduplicated === true)) {
    throw new Error(`expected a stale drop (success + deduplicated), got ${JSON.stringify(result)}`);
  }
}

/** Assert a projectVersioned write was applied (fresh, not dropped). */
export function expectVersionedWrite(result: VersionedResult): void {
  if (!(result.success && !result.deduplicated)) {
    throw new Error(`expected a versioned write (success, not deduplicated), got ${JSON.stringify(result)}`);
  }
}
