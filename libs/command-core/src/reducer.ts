export interface LedgerEntry<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: T;
  readonly timestamp: string;
  readonly sequenceNo: number;
}

export type EventReducer<S, T = unknown> = (state: S, entry: LedgerEntry<T>) => S;

export function replayEvents<S>(
  initialState: S,
  events: readonly LedgerEntry[],
  reducer: EventReducer<S>,
): S {
  return [...events]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .reduce((state, entry) => reducer(state, entry), initialState);
}
