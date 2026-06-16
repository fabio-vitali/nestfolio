import { projectVersioned } from '@nestfolio/event-processor';
import { decisionSnapshot } from '../../../src/transforms/decision-snapshot';

// The CDC subject is DRY: identity (tenantId/userId/region) is EXCLUDED from the
// DecisionPacket subject (decision-workflow-ctrl/domain/contracts.ts) and travels
// in the event CONTEXT. Fixtures must mirror that — a tenantId in the subject is
// the co-wrong-fixture trap that let Decision#undefined#… ship (the bug this guards).
const makeUow = (type: string, subject: Record<string, unknown>, tenantId = 't1') => ({
  event: { id: 'e1', type, timestamp: '2026-01-01T00:00:00.000Z', subject, context: { tenantId } },
  payload: {}, record: {},
});

describe('decisionSnapshot transform', () => {
  const base = {
    decisionId: 'd1', trigger: 'rebalance', status: 'PENDING',
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
    expect(decisionSnapshot(makeUow('DECISION_PACKET_CREATED', { decisionId: 'd1', explanation: '', proposedTrades: [], __version: 1 }) as any)).toBeUndefined();
  });

  // Regression (2026-06-16): the DRY CDC subject carries NO tenantId — identity is in
  // context. The row key MUST be sourced from context, never from subject.tenantId
  // (which is undefined), or the row lands at Decision#undefined#<id> and the real
  // DecisionReadModel never advances past the GENERATING stub → pendingDecisions stays 0.
  it('derives the row key from context.tenantId, never Decision#undefined (subject is DRY)', () => {
    const intent = decisionSnapshot(
      makeUow('DECISION_PACKET_CREATED', { ...base, status: 'AWAITING_CONFIRMATION', __version: 3 }, 'tenant-xyz') as any,
    ) as { overrides: { pk: string }; fields: Record<string, unknown> };
    expect(intent.overrides.pk).toBe('Decision#tenant-xyz#d1');
    expect(intent.overrides.pk).not.toContain('undefined');
    expect(intent.fields['tenantId']).toBe('tenant-xyz');
  });
});
