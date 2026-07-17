import { record } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { awaitingConfirmationActivity } from '../../../src/transforms/awaiting-confirmation-activity';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('awaitingConfirmationActivity transform', () => {
  const makeUow = (subject: Record<string, unknown>, eventId = 'e1'): TestUow => ({
    event: {
      id: eventId,
      type: 'DECISION_PACKET_UPDATED',
      timestamp: '2026-07-17T10:00:00.000Z',
      subject,
      context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  // Full DecisionPacketSchema-shaped CDC subject (DRY: identity in context).
  const awaitingPacket = {
    decisionId: 'd1',
    trigger: 'PORTFOLIO_DRIFT',
    triggerEventId: 'evt-trigger-1',
    executionArn: null,
    explanation: 'Rebalance proposal awaiting investor confirmation',
    proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityDelta: 5 }],
    confirmationRequired: true,
    status: 'AWAITING_CONFIRMATION',
    __version: 3,
    complianceResult: 'PASS',
    authorityLevel: 'L2',
    userDecision: null,
    blockReason: null,
    rejectionReason: null,
    timestamp: '2026-07-17T10:00:00.000Z',
    createdAt: '2026-07-17T09:59:00.000Z',
    updatedAt: '2026-07-17T10:00:00.000Z',
    taskToken: 'task-token-1',
  };

  it('records one awaiting-confirmation Activity row keyed by decisionId', () => {
    const result = awaitingConfirmationActivity(makeUow(awaitingPacket));
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        activityId: 'awaiting-confirmation#d1',
        activityType: 'DECISION_PACKET_UPDATED',
        description: 'Decision awaiting your confirmation: d1',
        createdAt: '2026-07-17T10:00:00.000Z',
        metadata: '{"decisionId":"d1","status":"AWAITING_CONFIRMATION"}',
      }, { sk: 'Activity#awaiting-confirmation#d1' }),
    );
  });

  it('uses the same row key for repeated updates of the same decision', () => {
    const skOf = (intent: ReturnType<typeof awaitingConfirmationActivity>): string | undefined =>
      intent && intent._tag === 'record' ? intent.overrides?.sk : undefined;
    const first = awaitingConfirmationActivity(makeUow(awaitingPacket, 'e1'));
    const redelivered = awaitingConfirmationActivity(
      makeUow({ ...awaitingPacket, __version: 4 }, 'e2'),
    );
    expect(skOf(first)).toBe('Activity#awaiting-confirmation#d1');
    expect(skOf(redelivered)).toBe('Activity#awaiting-confirmation#d1');
  });

  it('returns undefined for non-awaiting statuses', () => {
    for (const status of ['PENDING', 'GENERATING', 'CONFIRMED', 'REJECTED', 'BLOCKED', 'FAILED']) {
      expect(awaitingConfirmationActivity(makeUow({ ...awaitingPacket, status }))).toBeUndefined();
    }
  });

  it('returns undefined when decisionId is absent', () => {
    const { decisionId: _omitted, ...withoutDecisionId } = awaitingPacket;
    expect(awaitingConfirmationActivity(makeUow(withoutDecisionId))).toBeUndefined();
  });
});
