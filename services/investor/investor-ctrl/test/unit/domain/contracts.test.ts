import { NotificationCreatedSchema, MonthlyReportSchema } from '../../../src/domain/contracts';

const validSubject = {
  tenantId: 'tenant-123',
  userId: 'user-456',
  notificationId: 'notif-789',
  channel: 'push',
  title: 'Investment Decision Approved',
  body: 'An investment decision has been approved for your portfolio.',
  relatedEntityType: 'DECISION',
  relatedEntityId: 'dec-001',
};

describe('NotificationCreatedSchema', () => {
  it('parses a representative NOTIFICATION_CREATED subject', () => {
    const result = NotificationCreatedSchema.safeParse(validSubject);
    expect(result.success).toBe(true);
  });

  it('parses a SYSTEM-tenant notification (circuit-breaker)', () => {
    const result = NotificationCreatedSchema.safeParse({
      ...validSubject,
      tenantId: 'SYSTEM',
      relatedEntityType: 'SYSTEM',
      relatedEntityId: 'evt-cb-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when relatedEntityType is absent', () => {
    const { relatedEntityType: _relatedEntityType, ...without } = validSubject;
    const result = NotificationCreatedSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when relatedEntityId is absent', () => {
    const { relatedEntityId: _relatedEntityId, ...without } = validSubject;
    const result = NotificationCreatedSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when notificationId is absent', () => {
    const { notificationId: _notificationId, ...without } = validSubject;
    const result = NotificationCreatedSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when channel is absent', () => {
    const { channel: _channel, ...without } = validSubject;
    const result = NotificationCreatedSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
});

describe('investor-ctrl MonthlyReportSchema', () => {
  it('parses a representative MonthlyReport subject (dry — no identity/keys)', () => {
    const subject = {
      reportId: 'evt-1-report',
      period: '2026-06',
      status: 'GENERATED',
      sourceEventId: 'evt-1',
      orderDetails: { orderId: 'o1', symbol: 'VTI', quantity: 3 },
    };
    expect(MonthlyReportSchema.parse(subject)).toMatchObject({ period: '2026-06', status: 'GENERATED' });
  });

  it('strips identity/keys but keeps the domain fields (DRY subject)', () => {
    const parsed = MonthlyReportSchema.parse({
      tenantId: 't', pk: 'MonthlyReport#t#r', sk: 'MonthlyReport',
      reportId: 'r', period: '2026-06', status: 'GENERATED',
    });
    expect('tenantId' in parsed).toBe(false);
    expect('pk' in parsed).toBe(false);
    expect(parsed.reportId).toBe('r');
  });

  it('throws when reportId is absent', () => {
    expect(() => MonthlyReportSchema.parse({ period: '2026-06', status: 'GENERATED' })).toThrow();
  });
});
