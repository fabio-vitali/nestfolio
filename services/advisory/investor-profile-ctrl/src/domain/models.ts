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
  readonly pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  readonly sk: 'InvestorProfileSnapshot';
  readonly __typename: 'InvestorProfileSnapshot';
  readonly tenantId: string;
  readonly userId: string;
  readonly agentOutput: {
    readonly goals: ReadonlyArray<string>;
    readonly timeHorizon: string;
    readonly riskWillingness: string;
    readonly riskScore: number;
    readonly riskCategory: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
    readonly regulatoryFlags: ReadonlyArray<string>;
    readonly suitabilityAssessment: string;
    readonly confidence: number;
  };
  readonly sourceEventId: string;
  readonly sourceEventType: 'INVESTOR_PROFILE_UPDATED' | 'MANDATE_ISSUED';
  readonly agentInvocationId: string;
  readonly updatedAt: string;
}
