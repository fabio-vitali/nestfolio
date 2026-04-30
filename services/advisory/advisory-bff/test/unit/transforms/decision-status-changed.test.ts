import { update } from '@nestfolio/event-processor';
import { decisionStatusChanged } from '../../../src/transforms/decision-status-changed';

describe('decisionStatusChanged transform', () => {
  const makeUow = (eventType: string, extraSubject: Record<string, unknown> = {}) => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { tenantId: 't1', decisionId: 'd1', ...extraSubject },
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should map DECISION_PACKET_UPDATED to COMPLIANCE_REVIEW status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_PACKET_UPDATED') as any)).toEqual(
      update('DecisionReadModel', { status: 'COMPLIANCE_REVIEW' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should map DECISION_APPROVED to APPROVED status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_APPROVED') as any)).toEqual(
      update('DecisionReadModel', { status: 'APPROVED' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should map DECISION_BLOCKED to BLOCKED status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_BLOCKED') as any)).toEqual(
      update('DecisionReadModel', { status: 'BLOCKED' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should map USER_CONFIRMATION_REQUESTED to AWAITING_CONFIRMATION status', () => {
    expect(decisionStatusChanged(makeUow('USER_CONFIRMATION_REQUESTED') as any)).toEqual(
      update('DecisionReadModel', { status: 'AWAITING_CONFIRMATION' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should persist taskToken on DecisionReadModel when USER_CONFIRMATION_REQUESTED carries one', () => {
    expect(
      decisionStatusChanged(makeUow('USER_CONFIRMATION_REQUESTED', { taskToken: 'tok-123' }) as any),
    ).toEqual(
      update('DecisionReadModel', { status: 'AWAITING_CONFIRMATION', taskToken: 'tok-123' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should not write taskToken on transitions that do not carry one (DECISION_APPROVED)', () => {
    const result = decisionStatusChanged(makeUow('DECISION_APPROVED') as any) as ReturnType<typeof update>;
    expect(result.updates).not.toHaveProperty('taskToken');
  });

  it('should return undefined for unmapped event types', () => {
    expect(decisionStatusChanged(makeUow('UNKNOWN_EVENT') as any)).toBeUndefined();
  });

  it('should copy explanation + proposedTrades from DECISION_PACKET_UPDATED subject (advisory-ctrl agent pipeline output)', () => {
    const explanation = 'detailed reasoning behind the recommendation';
    const proposedTrades = [{ symbol: 'AAPL', side: 'BUY' }];
    const result = decisionStatusChanged(
      makeUow('DECISION_PACKET_UPDATED', { explanation, proposedTrades }) as any,
    ) as ReturnType<typeof update>;
    expect(result.updates).toMatchObject({
      status: 'COMPLIANCE_REVIEW',
      explanation,
      proposedTrades,
    });
  });

  it('should not copy explanation when missing from subject (e.g. DECISION_APPROVED from compliance-ctrl)', () => {
    const result = decisionStatusChanged(makeUow('DECISION_APPROVED') as any) as ReturnType<typeof update>;
    expect(result.updates).not.toHaveProperty('explanation');
    expect(result.updates).not.toHaveProperty('proposedTrades');
  });
});
