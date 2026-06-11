import { z } from 'zod';
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

/**
 * Row-level zod contract for a task-token agent's SUCCESS callback row (the `AgentCompletion`
 * row CDC-emitted as `<AGENT>_COMPLETED`). Wraps the per-service `agentOutput` schema into the
 * full DRY subject: `Schema.parse(row)` strips the TableEntry envelope (pk/sk/__typename/
 * createdAt/…) and `tenantId` (→ event context), leaving `{ decisionId, agentName, taskToken,
 * agentOutput, completedAt }`. `taskToken` stays — the DWC consumer needs it for SendTaskSuccess.
 * `agentName` is `z.literal(agentName)` so a mis-keyed row fails the parse (a useful tripwire).
 */
export const AgentCompletionRowSchema = <A extends string, S extends z.ZodTypeAny>(
  agentName: A,
  agentOutput: S,
) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    agentOutput,
    completedAt: z.string(),
  });

/** Row-level zod contract for a task-token agent's FAILURE callback row (`AgentFailure` row,
 *  CDC-emitted as `<AGENT>_FAILED`). DRY subject — envelope + tenantId stripped on parse. */
export const AgentFailureRowSchema = <A extends string>(agentName: A) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    errorType: z.string(),
    errorMessage: z.string(),
    failedAt: z.string(),
  });
