export interface InvestorProfileInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly taskToken: string;
  readonly investorProfile: Record<string, unknown>;
  readonly portfolioState: Record<string, unknown>;
}

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

export interface InvestorProfileResult {
  readonly goals: GoalInterpretation;
  readonly risk: RiskEvaluation;
  readonly metadata: {
    readonly durationMs: number;
    readonly modelTiers: ReadonlyArray<string>;
  };
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
