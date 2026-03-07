import type { OperatingMode } from '@nestfolio/domain-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function selectOperatingMode(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  mode: OperatingMode,
): Promise<Record<string, unknown>> {
  return repository.setOperatingMode(tenantId, userId, mode);
}
