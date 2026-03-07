import type { RiskProfile } from '@nestfolio/domain-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function setRiskProfile(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  input: { score: number; band: { minEquity: number; maxEquity: number } },
): Promise<RiskProfile> {
  return repository.setRiskProfile(tenantId, userId, input);
}
