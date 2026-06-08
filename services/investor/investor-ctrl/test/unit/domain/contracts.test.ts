import { NotificationCreatedSchema } from '../../../src/domain/contracts';

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
