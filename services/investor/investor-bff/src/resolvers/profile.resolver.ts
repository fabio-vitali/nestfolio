import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function getProfile(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  return repository.getProfile(tenantId, userId);
}
