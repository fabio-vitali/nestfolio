import { replayEvents, type LedgerEntry, type EventReducer } from '../src/reducer';

interface CounterState {
  readonly count: number;
}

const counterReducer: EventReducer<CounterState> = (state, entry) => {
  switch (entry.eventType) {
    case 'INCREMENT':
      return { count: state.count + (entry.payload as number) };
    case 'DECREMENT':
      return { count: state.count - (entry.payload as number) };
    default:
      return state;
  }
};

const makeEntry = (
  sequenceNo: number,
  eventType: string,
  payload: unknown,
): LedgerEntry => ({
  eventId: `evt-${sequenceNo}`,
  eventType,
  payload,
  timestamp: new Date(2026, 0, 1, 0, 0, sequenceNo).toISOString(),
  sequenceNo,
});

describe('replayEvents', () => {
  it('should return initial state for empty events array', () => {
    const result = replayEvents({ count: 0 }, [], counterReducer);
    expect(result).toEqual({ count: 0 });
  });

  it('should replay a single event', () => {
    const events = [makeEntry(1, 'INCREMENT', 5)];
    const result = replayEvents({ count: 0 }, events, counterReducer);
    expect(result).toEqual({ count: 5 });
  });

  it('should replay multiple events in sequence order', () => {
    const events = [
      makeEntry(1, 'INCREMENT', 10),
      makeEntry(2, 'INCREMENT', 5),
      makeEntry(3, 'DECREMENT', 3),
    ];
    const result = replayEvents({ count: 0 }, events, counterReducer);
    expect(result).toEqual({ count: 12 });
  });

  it('should sort events by sequenceNo regardless of input order', () => {
    const events = [
      makeEntry(3, 'DECREMENT', 3),
      makeEntry(1, 'INCREMENT', 10),
      makeEntry(2, 'INCREMENT', 5),
    ];
    const result = replayEvents({ count: 0 }, events, counterReducer);
    expect(result).toEqual({ count: 12 });
  });

  it('should ignore unknown event types (reducer returns state)', () => {
    const events = [
      makeEntry(1, 'INCREMENT', 10),
      makeEntry(2, 'UNKNOWN_EVENT', 999),
      makeEntry(3, 'INCREMENT', 5),
    ];
    const result = replayEvents({ count: 0 }, events, counterReducer);
    expect(result).toEqual({ count: 15 });
  });

  it('should not mutate the original events array', () => {
    const events = [
      makeEntry(3, 'INCREMENT', 1),
      makeEntry(1, 'INCREMENT', 2),
      makeEntry(2, 'INCREMENT', 3),
    ];
    const originalOrder = events.map((e) => e.sequenceNo);
    replayEvents({ count: 0 }, events, counterReducer);
    expect(events.map((e) => e.sequenceNo)).toEqual(originalOrder);
  });
});
