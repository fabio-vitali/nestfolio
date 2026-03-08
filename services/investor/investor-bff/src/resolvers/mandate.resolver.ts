import type { Mandate, MandateLevel, RebalanceCadence } from '@nestfolio/domain-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function grantMandate(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  input: {
    level: MandateLevel;
    monthlyTurnoverCapPercent: number;
    maxSingleTradePercent: number;
    coolDownDays: number;
    rebalanceCadence: RebalanceCadence;
  },
): Promise<Mandate> {
  return repository.grantMandate(tenantId, userId, input, userId);
}

export async function updateMandate(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  input: {
    level: MandateLevel;
    monthlyTurnoverCapPercent: number;
    maxSingleTradePercent: number;
    coolDownDays: number;
    rebalanceCadence: RebalanceCadence;
  },
): Promise<Mandate> {
  // Update is essentially a re-grant with new parameters
  return repository.grantMandate(tenantId, userId, input, userId);
}

export async function revokeMandate(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
): Promise<Mandate> {
  return repository.revokeMandate(tenantId, userId, userId);
}
