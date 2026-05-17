export interface GoalInterpretation {
  readonly goals: ReadonlyArray<string>;
  readonly timeHorizon: string;
  readonly riskWillingness: string;
  readonly confidence: number;
}

export interface RiskEvaluation {
  readonly riskScore: number;
  readonly riskCategory: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  readonly regulatoryFlags: ReadonlyArray<string>;
  readonly suitabilityAssessment: string;
  readonly confidence: number;
}

export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'user-goals' | 'risk-assessment';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly createdAt: string;
}

export interface InvestorProfileSnapshotRow {
  pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  sk: 'InvestorProfileSnapshot';
  __typename: 'InvestorProfileSnapshot';
  tenantId: string;
  userId: string;
  agentOutput: {
    goals: string[];
    timeHorizon: string;
    riskWillingness: string;
    riskScore: number;
    riskCategory: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
    regulatoryFlags: string[];
    suitabilityAssessment: string;
    confidence: number;
  };
  sourceEventId: string;
  sourceEventType: 'INVESTOR_PROFILE_UPDATED' | 'MANDATE_ISSUED' | 'OPERATING_MODE_CHANGED';
  agentInvocationId: string;
  updatedAt: string;
}
