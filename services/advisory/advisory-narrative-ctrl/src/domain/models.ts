export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'explainability';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly summary: string;
  readonly rationale: string;
  readonly keyFactors: ReadonlyArray<string>;
  readonly tone: string;
  readonly wordCount: number;
  readonly createdAt: string;
}

/** Feedback annotation written to S3 for KB ingestion */
export interface FeedbackAnnotation {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly outcome: 'ACCEPTED' | 'REJECTED';
  readonly rejectionReason: string | null;
  readonly originalSummary: string;
  readonly originalTone: string;
  readonly originalWordCount: number;
  readonly originalKeyFactors: ReadonlyArray<string>;
  readonly riskCategory: string;
  readonly annotatedAt: string;
}

export interface AgentCompletionRow {
  readonly pk: string;                              // `AgentCompletion#${decisionId}`
  readonly sk: string;                              // `AgentCompletion#${agentName}`
  readonly __typename: 'AgentCompletion';
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'advisory-narrative';
  readonly taskToken: string;
  readonly agentOutput: Record<string, unknown>;
  readonly completedAt: string;
}

export interface AgentFailureRow {
  readonly pk: string;                              // `AgentFailure#${decisionId}`
  readonly sk: string;                              // `AgentFailure#${agentName}`
  readonly __typename: 'AgentFailure';
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'advisory-narrative';
  readonly taskToken: string;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly failedAt: string;
}
