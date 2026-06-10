import type { TableEntry } from '@nestfolio/event-processor';

/** PK/SK key helpers for the per-agent SF-callback completion/failure rows. */
export const agentCompletionPk = (decisionId: string): string => `AgentCompletion#${decisionId}`;
export const agentCompletionSk = (agentName: string): string => `AgentCompletion#${agentName}`;
export const agentFailurePk = (decisionId: string): string => `AgentFailure#${decisionId}`;
export const agentFailureSk = (agentName: string): string => `AgentFailure#${agentName}`;

/**
 * Shared AgentCompletion row — a task-token agent's success callback row. `A` is the agentName
 * literal; `O` is the agent's composite output subject (per-service derived schema). Tenant-scoped
 * only (no userId/region). The persisted row carries the full TableEntry envelope including
 * `createdAt` (the record() intent stamps it at write time); `completedAt` is the agent-semantic
 * timestamp.
 */
export type AgentCompletionRow<A extends string, O = unknown> = TableEntry<
  { decisionId: string; agentName: A; taskToken: string; agentOutput: O; completedAt: string },
  { tenantId: string }
> & { __typename: 'AgentCompletion' };

export type AgentFailureRow<A extends string> = TableEntry<
  { decisionId: string; agentName: A; taskToken: string; errorType: string; errorMessage: string; failedAt: string },
  { tenantId: string }
> & { __typename: 'AgentFailure' };
