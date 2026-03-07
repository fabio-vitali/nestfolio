import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type WithdrawalCompletedPayload = {
  userId: string;
  tenantId: string;
  withdrawalId: string;
  amountCents: number;
  currency: string;
  status: string;
};

export class WithdrawalCompletedPipe implements Pipe<UnitOfWork<BusEvent<WithdrawalCompletedPayload>>, void> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<WithdrawalCompletedPayload>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const payload = event.subject;

          await this.repository.addNotification(payload.tenantId, payload.userId, {
            notificationId: payload.withdrawalId,
            channel: 'IN_APP',
            title: 'Withdrawal Completed',
            body: `Your withdrawal of ${payload.amountCents / 100} ${payload.currency} has been completed.`,
            relatedEntityType: 'Withdrawal',
            relatedEntityId: payload.withdrawalId,
          });

          logger.info('Processed withdrawal completed event', {
            tenantId: payload.tenantId,
            withdrawalId: payload.withdrawalId,
          });
        })(),
      ),
    );
  }
}
