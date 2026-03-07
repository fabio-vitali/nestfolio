import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type DepositDetectedPayload = {
  userId: string;
  tenantId: string;
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
};

export class DepositDetectedPipe implements Pipe<UnitOfWork<BusEvent<DepositDetectedPayload>>, void> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<DepositDetectedPayload>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const payload = event.subject;

          await this.repository.addNotification(payload.tenantId, payload.userId, {
            notificationId: payload.depositId,
            channel: 'IN_APP',
            title: 'Deposit Detected',
            body: `A deposit of ${payload.amountCents / 100} ${payload.currency} has been detected.`,
            relatedEntityType: 'Deposit',
            relatedEntityId: payload.depositId,
          });

          logger.info('Processed deposit detected event', {
            tenantId: payload.tenantId,
            depositId: payload.depositId,
          });
        })(),
      ),
    );
  }
}
