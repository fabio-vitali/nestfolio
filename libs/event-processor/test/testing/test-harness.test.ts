import { createTestHarness } from '../../src/testing/test-harness';
import { fakeSqsRecord } from '../../src/testing/fake-records';
import { record } from '../../src/intents/record';
import { project } from '../../src/intents/project';
import { accumulate } from '../../src/intents/accumulate';

describe('createTestHarness()', () => {
  it('collects intents from handler config', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => ({ amount: subject.amount })),
      },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', { amount: 100 }),
    ]);

    expect(result.intents).toEqual([
      expect.objectContaining({ _tag: 'record', typename: 'Entry', fields: { amount: 100 } }),
    ]);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('reports unknown event types as skipped', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', () => ({})) },
    });

    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_TYPE', {}),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.intents).toEqual([]);
  });

  it('handles multi-intent handlers', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: [
          record('Activity', ({ subject }) => ({ desc: subject.desc })),
          accumulate('Stats', { field: 'count', increment: 1 }),
        ],
      },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', { desc: 'test' }),
    ]);

    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]._tag).toBe('record');
    expect(result.intents[1]._tag).toBe('accumulate');
  });

  it('catches handler errors and reports them', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        BAD_EVENT: async () => { throw new Error('handler boom'); },
      },
    });

    const result = await harness.process([
      fakeSqsRecord('BAD_EVENT', {}),
    ]);

    expect(result.metrics.EventFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toBe('handler boom');
  });

  it('detects poison pills', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', () => ({})) },
      poisonPill: { maxReceiveCount: 3 },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', {}, { receiveCount: 5 }),
    ]);

    expect(result.poisonPills).toBe(1);
    expect(result.batchItemFailures).toHaveLength(0);
  });
});

describe('fakeSqsRecord()', () => {
  it('creates a valid SQS record', () => {
    const rec = fakeSqsRecord('ORDER_FILLED', { amount: 100 });
    expect(rec.messageId).toBeDefined();
    expect(rec.body).toBeDefined();

    const body = JSON.parse(rec.body);
    expect(body.detail.type).toBe('ORDER_FILLED');
    expect(body.detail.subject.amount).toBe(100);
  });

  it('supports custom eventId and tenantId', () => {
    const rec = fakeSqsRecord('TEST', {}, { eventId: 'custom-evt', tenantId: 'custom-t' });
    const body = JSON.parse(rec.body);
    expect(body.detail.id).toBe('custom-evt');
    expect(body.detail.context.tenantId).toBe('custom-t');
  });

  it('supports custom receiveCount', () => {
    const rec = fakeSqsRecord('TEST', {}, { receiveCount: 7 });
    expect(rec.attributes.ApproximateReceiveCount).toBe('7');
  });
});
