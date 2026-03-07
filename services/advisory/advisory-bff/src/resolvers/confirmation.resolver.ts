import { getTime } from '@nestfolio/platform-core';
import { AdvisoryRepository } from '../repositories/advisory.repository';

export async function confirmDecision(
  repository: AdvisoryRepository,
  tenantId: string,
  userId: string,
  decisionId: string,
): Promise<Record<string, unknown>> {
  const now = getTime();
  await repository.updateDecisionStatus(tenantId, decisionId, 'CONFIRMED', {
    confirmedAt: now,
    confirmedBy: userId,
  });
  const decision = await repository.getDecision(tenantId, decisionId);
  return decision ?? { decisionId, tenantId, status: 'CONFIRMED', confirmedAt: now };
}

export async function rejectDecision(
  repository: AdvisoryRepository,
  tenantId: string,
  userId: string,
  decisionId: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const now = getTime();
  await repository.updateDecisionStatus(tenantId, decisionId, 'REJECTED', {
    rejectedAt: now,
    rejectionReason: reason,
    rejectedBy: userId,
  });
  const decision = await repository.getDecision(tenantId, decisionId);
  return decision ?? { decisionId, tenantId, status: 'REJECTED', rejectedAt: now, rejectionReason: reason };
}

export async function recordExplanationView(
  repository: AdvisoryRepository,
  tenantId: string,
  userId: string,
  decisionId: string,
): Promise<{ decisionId: string; viewedAt: string }> {
  const now = getTime();
  await repository.recordUserInteraction(tenantId, userId, decisionId, 'VIEWED_EXPLANATION');
  return { decisionId, viewedAt: now };
}
