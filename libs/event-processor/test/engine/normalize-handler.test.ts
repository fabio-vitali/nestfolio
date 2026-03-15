import { normalizeHandler } from '../../src/engine/normalize-handler';
import { record } from '../../src/intents/record';
import { accumulate } from '../../src/intents/accumulate';
import type { EventPayload } from '../../src/types/handler-config';
import type { EventContext } from '../../src/types/event-context';

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
});
