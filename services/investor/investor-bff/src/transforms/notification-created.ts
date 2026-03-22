import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type NotificationCreatedPayload = {
  userId: string;
  tenantId: string;
  notificationId: string;
  channel: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: string;
};

export const notificationCreated = (
  uow: UnitOfWork<BusEvent<NotificationCreatedPayload>>,
): WriteIntent =>
  record('Notification', {
    tenantId: uow.event.subject.tenantId,
    userId: uow.event.subject.userId,
    notificationId: uow.event.subject.notificationId,
    channel: uow.event.subject.channel,
    title: uow.event.subject.title,
    body: uow.event.subject.body,
    relatedEntityType: uow.event.subject.relatedEntityType,
    relatedEntityId: uow.event.subject.relatedEntityId,
  });
