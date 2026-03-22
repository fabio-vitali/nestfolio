import { record } from '@nestfolio/event-processor';
import { decisionPacketCreated } from '../../src/transforms/decision-packet-created';

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
      record('DecisionSummary', {
        tenantId: 't1',
        decisionId: 'd1',
        trigger: 'rebalance',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantity: 10 }],
        explanation: 'Portfolio drifted',
        confirmationRequired: true,
        complianceChecks: [],
        agentInvocations: [],
        sourceEventId: 'e1',
      }),
    );
  });
});
