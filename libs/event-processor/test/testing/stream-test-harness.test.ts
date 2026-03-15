import { createStreamTestHarness, createCdcTestHarness, createReducerTestHarness } from '../../src/testing/test-harness';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

describe('createStreamTestHarness', () => {
  it('processes records through processRecord', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const harness = createStreamTestHarness({
      serviceName: 'test',
      processRecord,
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]);
    expect(result.processed).toBe(1);
    expect(result.thrown).toBe(false);
  });

  it('collects errors and sets thrown flag', async () => {
    const harness = createStreamTestHarness({
      serviceName: 'test',
      processRecord: jest.fn().mockRejectedValue(new Error('fail')),
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.thrown).toBe(true);
  });

  it('applies filter', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const harness = createStreamTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Order',
      processRecord,
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'O#1', __typename: 'Order', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'G#1', __typename: 'Guard', tenantId: 't1' }),
    ]);
    expect(result.processed).toBe(1);
    expect(result.filtered).toBe(1);
  });
});

describe('createCdcTestHarness', () => {
  it('captures published events', async () => {
    const harness = createCdcTestHarness({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_CREATED');
  });

  it('captures no events for unmatched types', async () => {
    const harness = createCdcTestHarness({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toHaveLength(0);
  });
});

describe('createReducerTestHarness', () => {
  const reducer = (state: { total: number }, event: Record<string, unknown>) => ({
    total: state.total + ((event.amount as number) ?? 0),
  });

  it('reduces from initial state', async () => {
    const harness = createReducerTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Event',
      groupBy: { key: (r) => r.tenantId },
      reducer,
      initialState: { total: 0 },
      snapshot: { key: (gk) => ({ pk: `T#${gk}`, sk: 'Snapshot#current' }) },
    });
    harness.seedEvents('t1', [{ amount: 100, sequenceNo: 1 }, { amount: 200, sequenceNo: 2 }]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Event', tenantId: 't1', sequenceNo: 1 }),
    ]);
    expect(result.snapshots.get('t1')?.state).toEqual({ total: 300 });
    expect(result.snapshots.get('t1')?.version).toBe(1);
  });

  it('reduces from seeded snapshot', async () => {
    const harness = createReducerTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Event',
      groupBy: { key: (r) => r.tenantId },
      reducer,
      initialState: { total: 0 },
      snapshot: { key: (gk) => ({ pk: `T#${gk}`, sk: 'Snapshot#current' }) },
    });
    harness.seedSnapshot('t1', { total: 500 }, 3, 10);
    harness.seedEvents('t1', [{ amount: 50, sequenceNo: 11 }]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Event', tenantId: 't1', sequenceNo: 11 }),
    ]);
    expect(result.snapshots.get('t1')?.state).toEqual({ total: 550 });
    expect(result.snapshots.get('t1')?.version).toBe(4);
  });
});
