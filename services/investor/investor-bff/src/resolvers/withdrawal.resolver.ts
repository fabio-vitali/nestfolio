import { getUUID, getTime, logger } from '@nestfolio/platform-core';

// TODO: implement persistence + event emission
export async function requestWithdrawal(
  _tenantId: string,
  _userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
  logger.warn('Withdrawal not yet persisted — returning stub response', { amountCents: input.amountCents });
  const withdrawalId = getUUID();
  const now = getTime();

  return {
    withdrawalId,
    amountCents: input.amountCents,
    currency: input.currency,
    status: 'PENDING',
    requestedAt: now,
  };
}
