import { NotificationCreatedSubjectSchema } from '../../../src/domain/contracts';

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

describe('NotificationCreatedSubjectSchema', () => {
  it('parses a representative NOTIFICATION_CREATED subject', () => {
    const result = NotificationCreatedSubjectSchema.safeParse(validSubject);
    expect(result.success).toBe(true);
  });

  it('parses a SYSTEM-tenant notification (circuit-breaker)', () => {
    const result = NotificationCreatedSubjectSchema.safeParse({
      ...validSubject,
      tenantId: 'SYSTEM',
      relatedEntityType: 'SYSTEM',
      relatedEntityId: 'evt-cb-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when relatedEntityType is absent', () => {
    const { relatedEntityType, ...without } = validSubject;
    const result = NotificationCreatedSubjectSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when relatedEntityId is absent', () => {
    const { relatedEntityId, ...without } = validSubject;
    const result = NotificationCreatedSubjectSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when notificationId is absent', () => {
    const { notificationId, ...without } = validSubject;
    const result = NotificationCreatedSubjectSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when channel is absent', () => {
    const { channel, ...without } = validSubject;
    const result = NotificationCreatedSubjectSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
});
