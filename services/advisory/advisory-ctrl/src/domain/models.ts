/** Status of a decision packet through its lifecycle. */
export type DecisionStatus =
  | 'DRAFT'
  | 'PROPOSED'
  | 'COMPLIANCE_REVIEW'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'FILLED'
  | 'FAILED';

/** Compliance check level. */
export type ComplianceLevel = 'L1' | 'L2' | 'L3';

/** Compliance check result. */
export type ComplianceResult = 'PASSED' | 'FAILED' | 'ESCALATED';

/** A proposed trade within a decision packet. */
export interface ProposedTrade {
  readonly symbol: string;
  readonly assetClass: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
  readonly targetWeightPercent: number;
  readonly rationale: string;
}

/** Decision packet: the core artifact of the advisory pipeline. */
export interface DecisionPacket {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly trigger: string;
  readonly status: DecisionStatus;
  readonly proposedTrades: ReadonlyArray<ProposedTrade>;
  readonly explanation: string;
  readonly complianceChecks: ReadonlyArray<ComplianceCheck>;
  readonly agentInvocations: ReadonlyArray<AgentInvocation>;
  readonly confirmationRequired: boolean;
  readonly confirmedAt: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** Result of a compliance check on a decision. */
export interface ComplianceCheck {
  readonly checkId: string;
  readonly decisionId: string;
  readonly level: ComplianceLevel;
  readonly ruleName: string;
  readonly result: ComplianceResult;
  readonly details: string;
  readonly checkedAt: string;
}

/** Record of an agent invocation during advisory processing. */
export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly agentName: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly status: 'STARTED' | 'COMPLETED' | 'FAILED';
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}
