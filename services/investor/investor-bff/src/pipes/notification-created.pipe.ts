import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

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

export class NotificationCreatedPipe implements Pipe<UnitOfWork<BusEvent<NotificationCreatedPayload>>> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  async process(uow: UnitOfWork<BusEvent<NotificationCreatedPayload>>): Promise<void> {
    const { event } = uow;
    const payload = event.subject;

    const created = await this.repository.addNotification(payload.tenantId, payload.userId, {
      notificationId: payload.notificationId,
      channel: payload.channel,
      title: payload.title,
      body: payload.body,
      relatedEntityType: payload.relatedEntityType,
      relatedEntityId: payload.relatedEntityId,
    }, event.id);

    if (!created) {
      logger.info('Notification already exists, skipping', { eventId: event.id });
      return;
    }

    logger.info('Materialized notification', {
      tenantId: payload.tenantId,
      notificationId: payload.notificationId,
    });
  }
}
