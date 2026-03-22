import { update } from '@nestfolio/event-processor';
import { decisionStatusChanged } from '../../src/transforms/decision-status-changed';

describe('decisionStatusChanged transform', () => {
  const makeUow = (eventType: string) => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { tenantId: 't1', decisionId: 'd1' },
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should map DECISION_PACKET_ENRICHED to COMPLIANCE_REVIEW status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_PACKET_ENRICHED') as any)).toEqual(
      update('DecisionSummary', { status: 'COMPLIANCE_REVIEW' }, {
        overrides: { pk: 'T#t1', sk: 'DecisionSummary#d1' },
      }),
    );
  });

  it('should map DECISION_APPROVED to APPROVED status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_APPROVED') as any)).toEqual(
      update('DecisionSummary', { status: 'APPROVED' }, {
        overrides: { pk: 'T#t1', sk: 'DecisionSummary#d1' },
      }),
    );
  });

  it('should map DECISION_BLOCKED to BLOCKED status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_BLOCKED') as any)).toEqual(
      update('DecisionSummary', { status: 'BLOCKED' }, {
        overrides: { pk: 'T#t1', sk: 'DecisionSummary#d1' },
      }),
    );
  });

  it('should map USER_CONFIRMATION_REQUESTED to AWAITING_CONFIRMATION status', () => {
    expect(decisionStatusChanged(makeUow('USER_CONFIRMATION_REQUESTED') as any)).toEqual(
      update('DecisionSummary', { status: 'AWAITING_CONFIRMATION' }, {
        overrides: { pk: 'T#t1', sk: 'DecisionSummary#d1' },
      }),
    );
  });

  it('should return undefined for unmapped event types', () => {
    expect(decisionStatusChanged(makeUow('UNKNOWN_EVENT') as any)).toBeUndefined();
  });
});
