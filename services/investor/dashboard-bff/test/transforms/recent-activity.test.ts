import { record } from '@nestfolio/event-processor';
import { recentActivity } from '../../src/transforms/recent-activity';

describe('recentActivity transform', () => {
  const makeUow = (eventType: string, subject: Record<string, unknown> = {}) => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should return record intent with description for DECISION_APPROVED', () => {
    const result = recentActivity(makeUow('DECISION_APPROVED', { decisionId: 'd1' }) as any);
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        activityId: 'e1',
        activityType: 'DECISION_APPROVED',
        description: 'Decision approved: d1',
        metadata: { decisionId: 'd1' },
      }),
    );
  });

  it('should use generic description for unmapped event types', () => {
    const result = recentActivity(makeUow('SOME_EVENT', { key: 'value' }) as any);
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        activityId: 'e1',
        activityType: 'SOME_EVENT',
        description: expect.stringContaining('SOME_EVENT'),
        metadata: { key: 'value' },
      }),
    );
  });
});
