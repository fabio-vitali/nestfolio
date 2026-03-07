import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { IdempotencyGuard } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type UserRegisteredPayload = {
  userId: string;
  tenantId: string;
  email: string;
};

export class UserRegisteredPipe implements Pipe<UnitOfWork<BusEvent<UserRegisteredPayload>>, void> {
  constructor(
    private readonly repository: InvestorProfileRepository,
    private readonly idempotencyGuard: IdempotencyGuard,
  ) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<UserRegisteredPayload>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const { userId, tenantId, email } = event.subject;

          const isNew = await this.idempotencyGuard.ensureOnce(event.type, event.id);
          if (!isNew) {
            logger.info('Skipping duplicate USER_REGISTERED event', { eventId: event.id });
            return;
          }

          await this.repository.createProfile(tenantId, userId, email);
          logger.info('Created InvestorProfile skeleton', { tenantId, userId });
        })(),
      ),
    );
  }
}
