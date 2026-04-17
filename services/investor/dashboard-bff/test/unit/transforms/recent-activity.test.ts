import { record } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { recentActivity } from '../../../src/transforms/recent-activity';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('recentActivity transform', () => {
  const makeUow = (eventType: string, subject: Record<string, unknown> = {}): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('should return record intent with description for DECISION_APPROVED', () => {
    const result = recentActivity(makeUow('DECISION_APPROVED', { decisionId: 'd1' }));
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        activityId: 'e1',
        activityType: 'DECISION_APPROVED',
        description: 'Decision approved: d1',
        createdAt: '2026-01-01T00:00:00.000Z',
        metadata: '{"decisionId":"d1"}',
      }),
    );
  });

  it('should use generic description for unmapped event types', () => {
    const result = recentActivity(makeUow('SOME_EVENT', { key: 'value' }));
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        activityId: 'e1',
        activityType: 'SOME_EVENT',
        description: expect.stringContaining('SOME_EVENT'),
        createdAt: '2026-01-01T00:00:00.000Z',
        metadata: expect.any(String),
      }),
    );
  });

  it('should return record intent with description for DEPOSIT_DETECTED', () => {
    const result = recentActivity(
      makeUow('DEPOSIT_DETECTED', { amountCents: 500_000, currency: 'USD' }),
    );
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        activityId: 'e1',
        activityType: 'DEPOSIT_DETECTED',
        description: 'Deposit detected: 5000 USD',
        createdAt: '2026-01-01T00:00:00.000Z',
        metadata: '{"amountCents":500000,"currency":"USD"}',
      }),
    );
  });

  it('should include createdAt and stringified metadata (required by GraphQL schema)', () => {
    const result = recentActivity(makeUow('DEPOSIT_DETECTED', { amount: 100 }));
    const intent = result as unknown as { fields: Record<string, unknown> };
    expect(intent.fields).toHaveProperty('createdAt', '2026-01-01T00:00:00.000Z');
    expect(typeof intent.fields.metadata).toBe('string');
  });

  it('should return record intent with description for WITHDRAWAL_COMPLETED', () => {
    const result = recentActivity(
      makeUow('WITHDRAWAL_COMPLETED', { amountCents: 250_000, currency: 'USD' }),
    );
    expect(result).toEqual(
      record('Activity', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        activityId: 'e1',
        activityType: 'WITHDRAWAL_COMPLETED',
        description: 'Withdrawal completed: 2500 USD',
        createdAt: '2026-01-01T00:00:00.000Z',
        metadata: '{"amountCents":250000,"currency":"USD"}',
      }),
    );
  });
});
