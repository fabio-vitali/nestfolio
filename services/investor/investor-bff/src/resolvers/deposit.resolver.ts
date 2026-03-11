import { getUUID, getTime, logger, type Bus } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function initiateDeposit(
  repository: InvestorProfileRepository,
  bus: Bus,
  tenantId: string,
  userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
  const depositId = getUUID();
  const now = getTime();

  const deposit = {
    depositId,
    amountCents: input.amountCents,
    currency: input.currency,
    status: 'PENDING',
    initiatedAt: now,
  };

  // NOTE: persist + publish is not atomic. If bus.publish fails after persist,
  // the record exists without an event. Upstream IdempotencyGuard prevents
  // duplicate processing on retry. Consider Outbox pattern for stronger guarantees.
  const item = await repository.persistDeposit(tenantId, userId, deposit);

  await bus.publish({
    id: getUUID(),
    type: 'DEPOSIT_INITIATED',
    timestamp: now,
    subject: {
      depositId,
      tenantId,
      userId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: 'PENDING',
      initiatedAt: now,
    },
    context: { tenantId },
  });

  logger.info('Deposit initiated', { depositId, tenantId, amountCents: input.amountCents });

  return item;
}
