import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type BalanceUpdatedPayload = {
  tenantId: string;
  userId: string;
  balanceCents: number;
};

export class BalanceUpdatedPipe implements Pipe<UnitOfWork<BusEvent<BalanceUpdatedPayload>>> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  async process(uow: UnitOfWork<BusEvent<BalanceUpdatedPayload>>): Promise<void> {
    const { event } = uow;
    const payload = event.subject;

    await this.repository.upsertReadOnlyBalance(payload.tenantId, payload.userId, payload.balanceCents);

    logger.info('Processed balance updated event', {
      tenantId: payload.tenantId,
      balanceCents: payload.balanceCents,
    });
  }
}
