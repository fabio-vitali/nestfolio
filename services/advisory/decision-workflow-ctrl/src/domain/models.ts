/** Status of a DecisionPacket through the Step Functions workflow. */
export type WorkflowStatus =
  | 'INITIATED'
  | 'PROFILING'
  | 'CONSTRUCTING'
  | 'NARRATING'
  | 'PROPOSED'
  | 'COMPLIANCE_REVIEW'
  | 'APPROVED'
  | 'BLOCKED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED';

/** DecisionPacket: the core aggregate owned by decision-workflow-ctrl. */
export interface DecisionPacket {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly status: WorkflowStatus;
  readonly executionArn: string | null;
  readonly complianceResult: 'APPROVED' | 'BLOCKED' | null;
  readonly authorityLevel: 'L1' | 'L2' | null;
  readonly userDecision: 'CONFIRMED' | 'REJECTED' | null;
  readonly blockReason: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InvestorProfileSnapshotProjectionRow {
  pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  sk: 'InvestorProfileSnapshot';
  __typename: 'InvestorProfileSnapshot';
  tenantId: string;
  userId: string;
  agentOutput: Record<string, unknown>;
  sourceEventId: string;
  updatedAt: string;
}

export interface MarketSnapshotProjectionRow {
  pk: string;                              // `MarketSnapshot#${region}`
  sk: 'MarketSnapshot';
  __typename: 'MarketSnapshot';
  region: string;
  agentOutput: Record<string, unknown>;
  updatedAt: string;
}
