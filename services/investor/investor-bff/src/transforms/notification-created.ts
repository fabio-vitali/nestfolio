import { record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { NotificationCreatedSubjectSchema } from '@nestfolio/investor-ctrl/contracts';

export const notificationCreated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow, NotificationCreatedSubjectSchema);
  return record('Notification', {
    tenantId: s.tenantId,
    userId: s.userId,
    notificationId: s.notificationId,
    channel: s.channel,
    title: s.title,
    body: s.body,
    relatedEntityType: s.relatedEntityType,
    relatedEntityId: s.relatedEntityId,
    status: 'CREATED',
    createdAt: uow.event.timestamp,
    read: false,
  }, {
    pk: `InvestorProfile#${s.tenantId}#${s.userId}`,
    sk: `Notification#${s.notificationId}`,
  });
};
