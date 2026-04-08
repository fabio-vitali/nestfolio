import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface NotificationCreatedPayload {
  userId: string;
  tenantId: string;
  notificationId: string;
  channel: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: string;
}

export const notificationCreated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as NotificationCreatedPayload;
  return record('Notification', {
    tenantId: s.tenantId,
    userId: s.userId,
    notificationId: s.notificationId,
    channel: s.channel,
    title: s.title,
    body: s.body,
    relatedEntityType: s.relatedEntityType,
    relatedEntityId: s.relatedEntityId,
  }, {
    pk: `InvestorProfile#${s.tenantId}#${s.userId}`,
    sk: `Notification#${s.notificationId}`,
  });
};
