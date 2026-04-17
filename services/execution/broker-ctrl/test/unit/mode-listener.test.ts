jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  // No need to mock TableRepository here - materializeToTable is tested via test harness
}));

import { createTestHarness, fakeSqsRecord, record } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes } from '../../src/domain/events';

describe('mode-listener handler', () => {
  const handlers = {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload, ctx) => {
      const mode = payload.subject.mode;
      return record('ExecutionMode', {
        __typename: 'ExecutionMode',
        tenantId: ctx.tenantId,
        mode,
        updatedAt: ctx.timestamp,
      }, {
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
    },
  };

  const harness = createTestHarness({ serviceName: 'broker-ctrl', handlers });

  it('should write ExecutionMode record on EXECUTION_MODE_CHANGED', async () => {
    const sqsRecord = fakeSqsRecord('EXECUTION_MODE_CHANGED', {
      mode: 'live',
    }, { eventId: 'evt-mode', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'ExecutionMode',
      fields: {
        __typename: 'ExecutionMode',
        tenantId: 't-1',
        mode: 'live',
      },
      overrides: {
        pk: 'ExecutionMode#t-1',
        sk: 'ExecutionMode',
      },
    });
  });

  it('should handle simulation mode', async () => {
    const sqsRecord = fakeSqsRecord('EXECUTION_MODE_CHANGED', {
      mode: 'simulation',
    }, { eventId: 'evt-mode-sim', tenantId: 't-2' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'ExecutionMode',
      fields: {
        __typename: 'ExecutionMode',
        tenantId: 't-2',
        mode: 'simulation',
      },
    });
  });
});
