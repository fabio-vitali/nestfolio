import type { AgentCompletionRow, AgentFailureRow } from '@nestfolio/agent-orchestrator';
import type { NarrativeAgentOutput } from './contracts';

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

// Aliases use the same names as the deleted inline interfaces so that any
// re-exports from domain/index.ts (which does `export * from './models'`) keep
// the names stable for consumers outside this service.
export type { AgentCompletionRow, AgentFailureRow };

export type NarrativeAgentCompletionRow = AgentCompletionRow<'advisory-narrative', NarrativeAgentOutput>;
export type NarrativeAgentFailureRow = AgentFailureRow<'advisory-narrative'>;
