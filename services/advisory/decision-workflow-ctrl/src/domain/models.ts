/** Status of a DecisionPacket through the Step Functions workflow. */
export type WorkflowStatus =
  | 'PENDING'
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
  readonly pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  readonly sk: 'InvestorProfileSnapshot';
  readonly __typename: 'InvestorProfileSnapshot';
  readonly tenantId: string;
  readonly userId: string;
  readonly agentOutput: Record<string, unknown>;
  readonly sourceEventId: string;
  readonly updatedAt: string;
}

export interface MarketSnapshotProjectionRow {
  readonly pk: string;                              // `MarketSnapshot#${region}`
  readonly sk: 'MarketSnapshot';
  readonly __typename: 'MarketSnapshot';
  readonly region: string;
  readonly agentOutput: Record<string, unknown>;
  readonly updatedAt: string;
}
