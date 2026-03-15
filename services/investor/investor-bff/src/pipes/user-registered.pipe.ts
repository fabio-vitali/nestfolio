import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type UserRegisteredPayload = {
  userId: string;
  tenantId: string;
  email: string;
};

export class UserRegisteredPipe implements Pipe<UnitOfWork<BusEvent<UserRegisteredPayload>>> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  async process(uow: UnitOfWork<BusEvent<UserRegisteredPayload>>): Promise<void> {
    const { event } = uow;
    const { userId, tenantId, email } = event.subject;

    const created = await this.repository.createProfile(tenantId, userId, email, event.id);
    if (!created) {
      logger.info('Profile already exists, skipping', { eventId: event.id });
      return;
    }

    logger.info('Created InvestorProfile skeleton', { tenantId, userId });
  }
}
