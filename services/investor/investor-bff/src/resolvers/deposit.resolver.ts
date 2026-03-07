import { getUUID, getTime } from '@nestfolio/platform-core';

export async function initiateDeposit(
  _tenantId: string,
  _userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
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
