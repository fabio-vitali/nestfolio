import { getUUID, getTime, logger } from '@nestfolio/platform-core';

// TODO: implement persistence + event emission
export async function initiateDeposit(
  _tenantId: string,
  _userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
  logger.warn('Deposit not yet persisted — returning stub response', { amountCents: input.amountCents });
  const depositId = getUUID();
  const now = getTime();

  return {
    depositId,
    amountCents: input.amountCents,
    currency: input.currency,
    status: 'PENDING',
    initiatedAt: now,
  };
}
