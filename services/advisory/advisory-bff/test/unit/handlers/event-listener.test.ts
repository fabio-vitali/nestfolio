import { createHandlers } from '../../../src/handlers/event-listener';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';

describe('advisory-bff event-listener', () => {
  it('subscribes to ONLY the two DecisionPacket snapshot events', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(2);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_CREATED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED);
  });

  it('both CREATED and UPDATED dispatch the decisionSnapshot transform', () => {
    const handlers = createHandlers();
    const subject = {
      tenantId: 't1', decisionId: 'd1', trigger: 'rebalance', status: 'PENDING',
      proposedTrades: [{ symbol: 'VTI', side: 'BUY' }], explanation: 'why',
      confirmationRequired: true, __version: 2,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };

    for (const eventType of [
      DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
      DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
    ]) {
      const ctx = { tenantId: 't1', eventId: 'e1', eventType, timestamp: '2026-01-01T00:00:00.000Z' };
      const intent = handlers[eventType]({ subject } as never, ctx as never) as {
        _tag: string; typename: string; version: number;
      };
      expect(intent._tag).toBe('projectVersioned');
      expect(intent.typename).toBe('DecisionReadModel');
      expect(intent.version).toBe(2);
    }
  });

  it('coerces a degraded snapshot (no explanation, no trades) to a skip intent', () => {
    const handlers = createHandlers();
    const subject = { tenantId: 't1', decisionId: 'd1', explanation: '', proposedTrades: [], __version: 1 };
    const ctx = {
      tenantId: 't1', eventId: 'e1',
      eventType: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    const intent = handlers[DecisionWorkflowEventTypes.DECISION_PACKET_CREATED](
      { subject } as never, ctx as never,
    ) as { _tag: string };
    expect(intent._tag).toBe('skip');
  });
});
