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

/** Payload shape for agent trigger events published by Step Functions. */
export interface AgentTriggerPayload {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly taskToken: string;
}

/** Payload shape for agent completion events received by the orchestrator. */
export interface AgentCompletionPayload {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly taskToken: string;
}
