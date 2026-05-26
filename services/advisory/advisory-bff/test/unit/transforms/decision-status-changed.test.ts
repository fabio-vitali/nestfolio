import { updateOrRetry } from '@nestfolio/event-processor';
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

  // Bug E (2026-05-24): DECISION_PACKET_UPDATED is deliberately NOT mapped.
  // sfn-callback in decision-workflow-ctrl emits UPDATED AFTER compliance's
  // terminal event — if mapped, it would overwrite BLOCKED/APPROVED with an
  // intermediate state. PENDING (set on CREATE) goes directly to the terminal.
  it('should return undefined for DECISION_PACKET_UPDATED (no status transition; preserves terminal state)', () => {
    expect(decisionStatusChanged(makeUow('DECISION_PACKET_UPDATED') as any)).toBeUndefined();
  });

  it('should map DECISION_APPROVED to APPROVED status when authorityLevel=L1 (terminal for autonomous path)', () => {
    expect(decisionStatusChanged(makeUow('DECISION_APPROVED', { authorityLevel: 'L1' }) as any)).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'APPROVED' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  // 2026-05-26 race fix (plan: docs/superpowers/plans/2026-05-26-advisory-bff-approved-to-awaiting-race.md):
  // For L2 decisions, DECISION_APPROVED and USER_CONFIRMATION_REQUESTED both fire
  // in advisory-bff as independent EventBridge → Lambda invocations. No completion-
  // order guarantee → DECISION_APPROVED's write can land last and stick the badge
  // on APPROVED. USER_CONFIRMATION_REQUESTED is the sole owner of the
  // AWAITING_CONFIRMATION transition for L2; DECISION_APPROVED is a no-op.
  it('should return undefined for DECISION_APPROVED when authorityLevel=L2 (USER_CONFIRMATION_REQUESTED owns the L2 transition)', () => {
    expect(decisionStatusChanged(makeUow('DECISION_APPROVED', { authorityLevel: 'L2' }) as any)).toBeUndefined();
  });

  it('should map DECISION_APPROVED to APPROVED when authorityLevel is absent (defensive default for legacy emitters)', () => {
    expect(decisionStatusChanged(makeUow('DECISION_APPROVED') as any)).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'APPROVED' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should map DECISION_BLOCKED to BLOCKED status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_BLOCKED') as any)).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'BLOCKED' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should map USER_CONFIRMATION_REQUESTED to AWAITING_CONFIRMATION status', () => {
    expect(decisionStatusChanged(makeUow('USER_CONFIRMATION_REQUESTED') as any)).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'AWAITING_CONFIRMATION' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should persist taskToken on DecisionReadModel when USER_CONFIRMATION_REQUESTED carries one', () => {
    expect(
      decisionStatusChanged(makeUow('USER_CONFIRMATION_REQUESTED', { taskToken: 'tok-123' }) as any),
    ).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'AWAITING_CONFIRMATION', taskToken: 'tok-123' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });

  it('should not write taskToken on transitions that do not carry one (DECISION_APPROVED, L1)', () => {
    const result = decisionStatusChanged(
      makeUow('DECISION_APPROVED', { authorityLevel: 'L1' }) as any,
    ) as ReturnType<typeof updateOrRetry>;
    expect(result.updates).not.toHaveProperty('taskToken');
  });

  it('should return undefined for unmapped event types', () => {
    expect(decisionStatusChanged(makeUow('UNKNOWN_EVENT') as any)).toBeUndefined();
  });

});
