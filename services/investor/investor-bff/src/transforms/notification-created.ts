import { record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { NotificationCreatedSchema } from '@nestfolio/investor-ctrl/contracts';

export const notificationCreated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow, NotificationCreatedSchema);
  const { tenantId, userId } = uow.event.context;
  return record('Notification', {
    tenantId,
    userId,
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
    pk: `InvestorProfile#${tenantId}#${userId}`,
    sk: `Notification#${s.notificationId}`,
  });
};
