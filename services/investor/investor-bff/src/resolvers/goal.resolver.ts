import type { Goal } from '@nestfolio/domain-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function setGoal(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  input: {
    objective: string;
    targetAmountCents: number;
    currency: string;
    timeHorizonMonths: number;
    targetReturn: number;
  },
): Promise<Goal> {
  return repository.setGoal(tenantId, userId, input);
}

export async function updateGoal(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  goalId: string,
  input: Partial<{
    objective: string;
    targetAmountCents: number;
    currency: string;
    timeHorizonMonths: number;
    targetReturn: number;
  }>,
): Promise<Goal> {
  return repository.updateGoal(tenantId, userId, goalId, input);
}

export async function getGoals(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
): Promise<Goal[]> {
  return repository.getGoals(tenantId, userId);
}
