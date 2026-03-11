import { getUUID, getTime, logger, NotRetryableError, type Bus } from '@nestfolio/platform-core';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function requestWithdrawal(
  repository: InvestorProfileRepository,
  bus: Bus,
  tenantId: string,
  userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
  // Atomic cash sufficiency check — decrements balance or throws
  try {
    await repository.withdrawCashConditional(tenantId, userId, input.amountCents);
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      throw new NotRetryableError('Insufficient funds');
    }
    throw e;
  }

  const withdrawalId = getUUID();
  const now = getTime();

  const withdrawal = {
    withdrawalId,
    amountCents: input.amountCents,
    currency: input.currency,
    status: 'PENDING',
    requestedAt: now,
  };

  // NOTE: persist + publish is not atomic. If bus.publish fails after persist,
  // the record exists without an event. Upstream IdempotencyGuard prevents
  // duplicate processing on retry. Consider Outbox pattern for stronger guarantees.
  const item = await repository.persistWithdrawal(tenantId, userId, withdrawal);

  await bus.publish({
    id: getUUID(),
    type: 'WITHDRAWAL_REQUESTED',
    timestamp: now,
    subject: {
      withdrawalId,
      tenantId,
      userId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: 'PENDING',
      requestedAt: now,
    },
    context: { tenantId },
  });

  logger.info('Withdrawal requested', { withdrawalId, tenantId, amountCents: input.amountCents });

  return item;
}
