import Highland from 'highland';
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

export class NotificationCreatedPipe implements Pipe<UnitOfWork<BusEvent<NotificationCreatedPayload>>, void> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<NotificationCreatedPayload>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const payload = event.subject;

          await this.repository.addNotification(payload.tenantId, payload.userId, {
            notificationId: payload.notificationId,
            channel: payload.channel,
            title: payload.title,
            body: payload.body,
            relatedEntityType: payload.relatedEntityType,
            relatedEntityId: payload.relatedEntityId,
          });

          logger.info('Materialized notification', {
            tenantId: payload.tenantId,
            notificationId: payload.notificationId,
          });
        })(),
      ),
    );
  }
}
