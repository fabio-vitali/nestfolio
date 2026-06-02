import { normalizeHandler } from '../../src/engine/normalize-handler';
import { record } from '../../src/intents/record';
import { accumulate } from '../../src/intents/accumulate';
import type { EventPayload, HandlerFn } from '../../src/types/handler-config';
import type { EventContext } from '../../src/types/event-context';
import type { WriteIntent } from '../../src/types/write-intent';

const fakePayload: EventPayload = { subject: { amount: 100 } };
const fakeCtx = { eventId: 'e1', eventType: 'TEST', tenantId: 't1', timestamp: '2026-01-01T00:00:00Z', receiveCount: 1, serviceName: 'test' } as EventContext;

describe('normalizeHandler()', () => {
  it('normalizes a HandlerFn (mapper mode record)', async () => {
    const handler = record('Entry', ({ subject }) => ({ amount: subject.amount }));
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toEqual([{ _tag: 'record', typename: 'Entry', fields: { amount: 100 }, overrides: undefined }]);
  });

  it('normalizes an async HandlerFn returning array', async () => {
    const handler = async ({ subject }: EventPayload) => [
      record('Entry', { amount: subject.amount }),
      accumulate('Stats', { field: 'count', increment: 1 }),
    ];
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(2);
    expect(result[0]._tag).toBe('record');
    expect(result[1]._tag).toBe('accumulate');
  });

  it('normalizes a HandlerEntry array (mixed HandlerFn + WriteIntent)', async () => {
    const entry = [
      record('Activity', ({ subject }) => ({ desc: String(subject.amount) })),
      accumulate('Stats', { field: 'count', increment: 1 }),
    ];
    const fn = normalizeHandler(entry);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ _tag: 'record', typename: 'Activity' }));
    expect(result[1]).toEqual(expect.objectContaining({ _tag: 'accumulate', typename: 'Stats' }));
  });

  it('wraps a single WriteIntent in an array', async () => {
    const handler = async () => record('Entry', { x: 1 });
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toEqual([{ _tag: 'record', typename: 'Entry', fields: { x: 1 }, overrides: undefined }]);
  });

  // The "drop, don't write" path. Real drop-path transforms (e.g. dashboard-bff
  // investorSnapshot / advisoryStatus / portfolioSummary on RECONCILIATION_COMPLETED)
  // are declared to return a WriteIntent but return `undefined` at runtime to signal
  // "skip this event". normalizeHandler must yield zero intents — NOT a `[undefined]`
  // array, which throws downstream in ingestion-engine's `intents.map(i => i._tag)`
  // (retryable → SQS redrive → DLQ instead of a clean drop).
  // `undefined as unknown as WriteIntent` reproduces that exact production type-lie.
  // NB: assert toHaveLength(0), NOT toEqual([]) — Jest's toEqual ignores undefined
  // array items, so [undefined] toEqual [] is a false green. Length is the real check.
  it('drops an undefined result from a single HandlerFn (no [undefined] leak)', async () => {
    const droppingHandler: HandlerFn = () => undefined as unknown as WriteIntent;
    const fn = normalizeHandler(droppingHandler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(0);
    expect(result.map((i) => i._tag)).toEqual([]); // would throw on a leaked undefined
  });

  it('drops an undefined result from an async single HandlerFn', async () => {
    const droppingHandler: HandlerFn = async () => undefined as unknown as WriteIntent;
    const fn = normalizeHandler(droppingHandler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(0);
  });

  it('drops an undefined result from a HandlerFn inside a HandlerEntry array, keeping siblings', async () => {
    const droppingHandler: HandlerFn = () => undefined as unknown as WriteIntent;
    const entry = [
      droppingHandler,
      accumulate('Stats', { field: 'count', increment: 1 }),
    ];
    const fn = normalizeHandler(entry);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ _tag: 'accumulate', typename: 'Stats' }));
  });
});
