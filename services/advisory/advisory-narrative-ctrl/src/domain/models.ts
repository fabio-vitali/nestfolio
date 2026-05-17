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
  pk: string;                              // `AgentCompletion#${decisionId}`
  sk: string;                              // `AgentCompletion#${agentName}`
  __typename: 'AgentCompletion';
  decisionId: string;
  tenantId: string;
  agentName: 'advisory-narrative';
  taskToken: string;
  agentOutput: Record<string, unknown>;
  completedAt: string;
}

export interface AgentFailureRow {
  pk: string;                              // `AgentFailure#${decisionId}`
  sk: string;                              // `AgentFailure#${agentName}`
  __typename: 'AgentFailure';
  decisionId: string;
  tenantId: string;
  agentName: 'advisory-narrative';
  taskToken: string;
  errorType: string;
  errorMessage: string;
  failedAt: string;
}
