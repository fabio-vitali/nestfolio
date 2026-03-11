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

export class WithdrawalCompletedPipe implements Pipe<UnitOfWork<BusEvent<WithdrawalCompletedPayload>>> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  async process(uow: UnitOfWork<BusEvent<WithdrawalCompletedPayload>>): Promise<void> {
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

    // Update cash balance (withdrawal decreases balance)
    await this.repository.updateCashBalance(payload.tenantId, payload.userId, -payload.amountCents);

    logger.info('Processed withdrawal completed event', {
      tenantId: payload.tenantId,
      withdrawalId: payload.withdrawalId,
    });
  }
}
