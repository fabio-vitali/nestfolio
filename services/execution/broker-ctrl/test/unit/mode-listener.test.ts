jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
  };
});

import { createTestHarness, fakeSqsRecord, parseSubject, record } from '@nestfolio/event-processor';
import { ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/domain';
import { BrokerCtrlInboundEventTypes } from '../../src/domain/events';
import type { ExecutionMode } from '../../src/domain/contracts';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';

// Valid ExecutionModeChangedSchema subject fixture — schema has toMode, NOT mode.
function executionModeChangedSubject(toMode: 'live' | 'simulation'): Record<string, unknown> {
  return {
    changeId: 'chg-1',
    fromMode: toMode === 'live' ? 'simulation' : 'live',
    toMode,
    changedAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('mode-listener handler', () => {
  // Inline handler that mirrors mode-listener.ts production logic — tests the parseSubject seam.
  const handlers = {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = parseSubject(payload, ExecutionModeChangedSchema);
      const executionMode: ExecutionMode = {
        mode: subject.toMode,
        updatedAt: ctx.timestamp,
      };
      return record('ExecutionMode', {
        __typename: 'ExecutionMode',
        tenantId: ctx.tenantId,
        ...executionMode,
      }, {
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
    },
  };

  const harness = createTestHarness({ serviceName: 'broker-ctrl', handlers });

  // --- TDD regression: ZodError thrown when subject is missing required toMode field ---
  // Ensures the parseSubject seam rejects the OLD shape (mode: 'live') that lacks toMode.
  it('EXECUTION_MODE_CHANGED with old subject shape (mode field only) → ZodError → batchItemFailure', async () => {
    const sqsRecord = fakeSqsRecord('EXECUTION_MODE_CHANGED', {
      mode: 'live', // OLD shape — not on ExecutionModeChangedSchema
    }, { eventId: 'evt-old-shape', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);
    // parseSubject(ExecutionModeChangedSchema) rejects this — ZodError → batch failure
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('should write ExecutionMode record on EXECUTION_MODE_CHANGED with live mode', async () => {
    const sqsRecord = fakeSqsRecord('EXECUTION_MODE_CHANGED',
      executionModeChangedSubject('live'),
      { eventId: 'evt-mode', tenantId: 't-1' },
    );

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
    const sqsRecord = fakeSqsRecord('EXECUTION_MODE_CHANGED',
      executionModeChangedSubject('simulation'),
      { eventId: 'evt-mode-sim', tenantId: 't-2' },
    );

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
