import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentNodeFn } from './with-validation';

// Phase β reshape (Spec 4, 2026-05-06).
//
// Before: withFallback returned `Record<string, unknown>` — caller could not
// tell whether the inner node succeeded or fell back. The static fallback
// then propagated through the wave node into AgentCore Memory and the
// downstream advisory-bff recommendation, manifesting as proposedTrades:[]
// on the e2e gate.
//
// Now: returns a discriminated union { ok: true; output } | { ok: false;
// reason; fallback }. The wave node propagates this shape upward; per-service
// agent-service.ts raises DegradedAgentOutputError when any entry has
// ok:false, so SF observes a TaskFailure with a clear cause instead of a
// silent success.
export type AgentNodeResult =
  | { ok: true; output: Record<string, unknown> }
  | { ok: false; reason: string; fallback: Record<string, unknown> };

export type AgentNodeWithFallback = (
  state: Record<string, unknown>,
  config?: RunnableConfig,
) => Promise<AgentNodeResult>;

export function withFallback(
  node: AgentNodeFn,
  fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
): AgentNodeWithFallback {
  return async (state, config) => {
    try {
      const output = await node(state, config);
      return { ok: true, output };
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { ok: false, reason, fallback: fallbackFn(state) };
    }
  };
}
