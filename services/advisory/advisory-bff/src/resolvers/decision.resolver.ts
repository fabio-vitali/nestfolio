import { AdvisoryRepository } from '../repositories/advisory.repository';

const PENDING_STATUSES = [
  'PROPOSED',
  'COMPLIANCE_REVIEW',
  'APPROVED',
  'CONFIRMATION_REQUIRED',
  'AWAITING_CONFIRMATION',
];

export async function getDecision(
  repository: AdvisoryRepository,
  tenantId: string,
  decisionId: string,
): Promise<Record<string, unknown> | null> {
  return repository.getDecision(tenantId, decisionId);
}

export async function getPendingDecisions(
  repository: AdvisoryRepository,
  tenantId: string,
  limit: number = 20,
  cursor?: string,
): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
  return repository.getDecisionsByStatus(tenantId, PENDING_STATUSES, limit, cursor);
}

export async function getDecisionHistory(
  repository: AdvisoryRepository,
  tenantId: string,
  limit: number = 20,
  cursor?: string,
): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
  return repository.getDecisionHistory(tenantId, limit, cursor);
}

export async function getAgentInvocations(
  repository: AdvisoryRepository,
  tenantId: string,
  decisionId: string,
): Promise<Record<string, unknown>[]> {
  return repository.getAgentInvocations(tenantId, decisionId);
}

export async function getComplianceChecks(
  repository: AdvisoryRepository,
  tenantId: string,
  decisionId: string,
): Promise<Record<string, unknown>[]> {
  return repository.getComplianceChecks(tenantId, decisionId);
}
