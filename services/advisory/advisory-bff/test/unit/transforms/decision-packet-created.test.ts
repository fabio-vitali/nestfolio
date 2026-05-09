import { record, accumulate } from '@nestfolio/event-processor';
import { decisionPacketCreated } from '../../../src/transforms/decision-packet-created';

describe('decisionPacketCreated transform', () => {
  it('returns [record, accumulate(-1)] for populated packet', () => {
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

    const intents = decisionPacketCreated(uow as any);
    expect(intents).toEqual([
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
      accumulate('AdvisoryStatus', {
        field: 'inFlightCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    ]);
  });

  it('returns undefined when both explanation and trades are empty (defence-in-depth against degraded-path producers)', () => {
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

  it('returns [record, accumulate(-1)] when explanation is present even if trades are empty (decision-workflow-ctrl placeholder path)', () => {
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
    expect(Array.isArray(result)).toBe(true);
    const intents = result as any[];
    expect(intents[0].fields.explanation).toBe('Decision pending — narrative placeholder.');
    expect(intents[1]).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'inFlightCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });
});
