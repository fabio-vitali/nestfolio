import { record } from '../../src/intents/record';
import { project } from '../../src/intents/project';
import { accumulate } from '../../src/intents/accumulate';
import { store } from '../../src/intents/store';
import { skip } from '../../src/intents/skip';
import { update } from '../../src/intents/update';
import { updateOrRetry } from '../../src/intents/update-or-retry';
import type { EventPayload } from '../../src/types/handler-config';
import type { EventContext } from '../../src/types/event-context';

const fakeCtx = { eventId: 'e1', eventType: 'TEST', tenantId: 't1', timestamp: '2026-01-01T00:00:00Z', receiveCount: 1, serviceName: 'test' } as EventContext;

describe('record()', () => {
  it('inline mode returns RecordIntent data', () => {
    const intent = record('LedgerEntry', { amount: 100 });
    expect(intent).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 }, overrides: undefined });
  });

  it('inline mode with overrides', () => {
    const intent = record('LedgerEntry', { amount: 100 }, { pk: 'custom' });
    expect(intent).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 }, overrides: { pk: 'custom' } });
  });

  it('mapper mode returns HandlerFn', () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }));
    expect(typeof fn).toBe('function');
  });

  it('mapper mode HandlerFn returns RecordIntent when called', async () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }));
    const payload: EventPayload = { subject: { amount: 500 } };
    const result = await (fn as (...args: unknown[]) => unknown)(payload, fakeCtx);
    expect(result).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 500 }, overrides: undefined });
  });

  it('mapper mode with overrides', async () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }), { sk: 'custom-sk' });
    const payload: EventPayload = { subject: { amount: 500 } };
    const result = await (fn as (...args: unknown[]) => unknown)(payload, fakeCtx);
    expect(result).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 500 }, overrides: { sk: 'custom-sk' } });
  });
});

describe('project()', () => {
  it('inline mode returns ProjectIntent data', () => {
    const intent = project('Summary', { total: 42 });
    expect(intent).toEqual({ _tag: 'project', typename: 'Summary', fields: { total: 42 }, overrides: undefined });
  });

  it('mapper mode returns HandlerFn that produces ProjectIntent', async () => {
    const fn = project('Summary', ({ subject }) => ({ total: subject.total }));
    const result = await (fn as (...args: unknown[]) => unknown)({ subject: { total: 42 } }, fakeCtx);
    expect(result).toEqual({ _tag: 'project', typename: 'Summary', fields: { total: 42 }, overrides: undefined });
  });
});

describe('accumulate()', () => {
  it('returns AccumulateIntent data', () => {
    const intent = accumulate('Stats', { field: 'count', increment: 1 });
    expect(intent).toEqual({ _tag: 'accumulate', typename: 'Stats', field: 'count', increment: 1, ttl: undefined, overrides: undefined });
  });

  it('with ttl and overrides', () => {
    const intent = accumulate('Balance', { field: 'amount', increment: -50, ttl: 604800, overrides: { pk: 'A#1' } });
    expect(intent).toEqual({ _tag: 'accumulate', typename: 'Balance', field: 'amount', increment: -50, ttl: 604800, overrides: { pk: 'A#1' } });
  });
});

describe('store()', () => {
  it('returns StoreIntent with defaults', () => {
    const intent = store({ data: 1 });
    expect(intent).toEqual({ _tag: 'store', body: { data: 1 }, format: 'json', key: undefined });
  });

  it('with format and key override', () => {
    const intent = store([{ a: 1 }], { format: 'csv', key: 'exports/data.csv' });
    expect(intent).toEqual({ _tag: 'store', body: [{ a: 1 }], format: 'csv', key: 'exports/data.csv' });
  });
});

describe('skip()', () => {
  it('returns SkipIntent', () => {
    expect(skip()).toEqual({ _tag: 'skip' });
  });
});

describe('update()', () => {
  it('should create UpdateIntent with updates only', () => {
    const intent = update('DecisionPacket', { status: 'APPROVED' });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionPacket',
      updates: { status: 'APPROVED' },
    });
  });

  it('should create UpdateIntent with removes and condition', () => {
    const intent = update('DecisionPacket', { status: 'BLOCKED' }, {
      removes: ['tempField'],
      condition: 'attribute_exists(pk)',
      overrides: { pk: 'custom-pk', sk: 'custom-sk' },
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionPacket',
      updates: { status: 'BLOCKED' },
      removes: ['tempField'],
      condition: 'attribute_exists(pk)',
      overrides: { pk: 'custom-pk', sk: 'custom-sk' },
    });
  });
});

describe('updateOrRetry()', () => {
  it('should create an UpdateIntent with onConditionFail: retry', () => {
    const intent = updateOrRetry('DecisionReadModel', { status: 'BLOCKED' }, {
      condition: 'attribute_exists(pk)',
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionReadModel',
      updates: { status: 'BLOCKED' },
      condition: 'attribute_exists(pk)',
      onConditionFail: 'retry',
    });
  });

  it('should preserve removes, overrides, conditionNames, conditionValues', () => {
    const intent = updateOrRetry('DecisionReadModel', { status: 'APPROVED' }, {
      condition: 'attribute_exists(pk) AND #v = :v',
      conditionNames: { '#v': 'version' },
      conditionValues: { ':v': 1 },
      removes: ['tempField'],
      overrides: { pk: 'Decision#t#d', sk: 'DecisionReadModel' },
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionReadModel',
      updates: { status: 'APPROVED' },
      condition: 'attribute_exists(pk) AND #v = :v',
      conditionNames: { '#v': 'version' },
      conditionValues: { ':v': 1 },
      removes: ['tempField'],
      overrides: { pk: 'Decision#t#d', sk: 'DecisionReadModel' },
      onConditionFail: 'retry',
    });
  });
});
