import { getUUID, getTime } from '@nestfolio/platform-core';

export async function requestWithdrawal(
  _tenantId: string,
  _userId: string,
  input: { amountCents: number; currency: string },
): Promise<Record<string, unknown>> {
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
