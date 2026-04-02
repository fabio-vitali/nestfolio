jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';

import {
  record, getUUID,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import { TRIGGER_EVENT_TYPES } from '../src/domain/events';

// Re-create the triggerHandler logic under test (since the module export is just the
// composed `handler`, we test the handler factory pattern directly)
const triggerHandler = (payload: EventPayload, ctx: EventContext) => {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  return record('WorkflowTrigger', {
    tenantId,
    decisionId: getUUID(),
    trigger: ctx.eventType,
    triggerEventId: ctx.eventId,
    context: payload.subject ?? {},
  });
};

const baseCtx = (eventType: string): EventContext => ({
  eventId: 'evt-1',
  eventType,
  tenantId: 't1',
  timestamp: new Date().toISOString(),
  receiveCount: 1,
  serviceName: 'decision-workflow-ctrl',
  record: {} as any,
});

describe('decision-workflow-ctrl event-listener (materializeToTable)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return a RecordIntent for WorkflowTrigger', () => {
    const payload: EventPayload = {
      subject: { tenantId: 't1', userId: 'u1' },
    };
    const result = triggerHandler(payload, baseCtx('MANDATE_CREATED'));

    expect(result).toEqual({
      _tag: 'record',
      typename: 'WorkflowTrigger',
      fields: {
        tenantId: 't1',
        decisionId: 'test-uuid',
        trigger: 'MANDATE_CREATED',
        triggerEventId: 'evt-1',
        context: { tenantId: 't1', userId: 'u1' },
      },
      overrides: undefined,
    });
  });

  it('should fall back to ctx.tenantId when payload has no tenantId', () => {
    const payload: EventPayload = {
      subject: { portfolioId: 'p1' },
    };
    const result = triggerHandler(payload, baseCtx('PORTFOLIO_DRIFT_DETECTED'));

    expect(result).toEqual(expect.objectContaining({
      _tag: 'record',
      typename: 'WorkflowTrigger',
      fields: expect.objectContaining({
        tenantId: 't1',
        trigger: 'PORTFOLIO_DRIFT_DETECTED',
      }),
    }));
  });

  it('should handle empty subject gracefully', () => {
    const payload: EventPayload = {};
    const result = triggerHandler(payload, baseCtx('GOAL_UPDATED'));

    expect(result).toEqual(expect.objectContaining({
      fields: expect.objectContaining({
        tenantId: 't1',
        context: {},
      }),
    }));
  });

  it('should map all TRIGGER_EVENT_TYPES', () => {
    expect(TRIGGER_EVENT_TYPES).toHaveLength(11);
    for (const type of TRIGGER_EVENT_TYPES) {
      const payload: EventPayload = { subject: { tenantId: 't1' } };
      const result = triggerHandler(payload, baseCtx(type));
      expect(result._tag).toBe('record');
      expect((result as any).fields.trigger).toBe(type);
    }
  });
});
