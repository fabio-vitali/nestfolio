import { projectVersioned } from '@nestfolio/event-processor';
import { decisionSnapshot } from '../../../src/transforms/decision-snapshot';

const makeUow = (type: string, subject: Record<string, unknown>) => ({
  event: { id: 'e1', type, timestamp: '2026-01-01T00:00:00.000Z', subject, context: { tenantId: 't1' } },
  payload: {}, record: {},
});

describe('decisionSnapshot transform', () => {
  const base = {
    decisionId: 'd1', tenantId: 't1', trigger: 'rebalance', status: 'PENDING',
    proposedTrades: [{ symbol: 'VTI', side: 'BUY' }], explanation: 'why',
    confirmationRequired: true, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', __version: 4,
  };

  it('projects a versioned full DecisionReadModel row from a DECISION_PACKET_UPDATED snapshot', () => {
    expect(decisionSnapshot(makeUow('DECISION_PACKET_UPDATED', { ...base, status: 'AWAITING_CONFIRMATION', taskToken: 'tok-1', __version: 6 }) as any)).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', trigger: 'rebalance', status: 'AWAITING_CONFIRMATION',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY' }], explanation: 'why', confirmationRequired: true,
        confirmedAt: undefined, rejectedAt: undefined, rejectionReason: undefined,
        complianceChecks: [], agentInvocations: [], version: 6, taskToken: 'tok-1',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }, { version: 6, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('drops a CREATE snapshot with neither explanation nor trades (degraded path)', () => {
    expect(decisionSnapshot(makeUow('DECISION_PACKET_CREATED', { decisionId: 'd1', tenantId: 't1', explanation: '', proposedTrades: [], __version: 1 }) as any)).toBeUndefined();
  });
});
