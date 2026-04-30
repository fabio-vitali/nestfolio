import { record } from '@nestfolio/event-processor';
import { decisionPacketCreated } from '../../../src/transforms/decision-packet-created';

describe('decisionPacketCreated transform', () => {
  it('should return record intent for DecisionSummary', () => {
    const uow = {
      event: {
        id: 'e1',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          trigger: 'rebalance',
          proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantity: 10 }],
          explanation: 'Portfolio drifted',
          confirmationRequired: true,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(decisionPacketCreated(uow as any)).toEqual(
      record('DecisionReadModel', {
        tenantId: 't1',
        decisionId: 'd1',
        trigger: 'rebalance',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantity: 10 }],
        explanation: 'Portfolio drifted',
        confirmationRequired: true,
        complianceChecks: [],
        agentInvocations: [],
        status: 'PENDING',
        version: 1,
        sourceEventId: 'e1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }, {
        pk: 'Decision#t1#d1',
        sk: 'DecisionReadModel',
      }),
    );
  });

  it('should skip events with empty explanation AND empty trades (defence-in-depth against degraded-path producers)', () => {
    const uow = {
      event: {
        id: 'e2',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          trigger: 'MANDATE_CREATED',
          proposedTrades: [],
          explanation: '',
          confirmationRequired: false,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(decisionPacketCreated(uow as any)).toBeUndefined();
  });

  it('should write when explanation is present even if trades are empty (decision-workflow-ctrl placeholder path)', () => {
    const uow = {
      event: {
        id: 'e3',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          trigger: 'MANDATE_CREATED',
          proposedTrades: [],
          explanation: 'Decision pending — narrative placeholder.',
          confirmationRequired: true,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    const result = decisionPacketCreated(uow as any);
    expect(result).toBeDefined();
    expect((result as { fields: Record<string, unknown> }).fields.explanation).toBe(
      'Decision pending — narrative placeholder.',
    );
  });
});
