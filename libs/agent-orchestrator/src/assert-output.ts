import { EmptyAgentResponseError } from './errors';
import type { AgentNodeResult } from './with-fallback';

// Phase γ helper (Spec 4, 2026-05-06).
//
// After Phase β, every wave-node output value is an AgentNodeResult
// discriminated union. This helper unwraps `.output` and asserts that:
//   - every expectedKey is present in the result,
//   - every expectedKey is `ok: true` AND its `.output` is a non-empty
//     object (>= 1 own property) OR a non-empty array (>= 1 element).
//
// Q1 resolved 2026-05-06: shallow first-level key check; escalate to deep
// schema introspection only if a degraded-but-non-empty case slips through.
//
// Intended to run AFTER the per-service discriminant check (Phase β.5) — the
// helper assumes it is called on results where every entry has been verified
// to be `ok: true`. The redundant `ok` check here is defensive: if a caller
// invokes the helper without a prior discriminant check, we still surface
// the failure rather than silently passing a fallback through.
export function assertOrchestratorOutput(
  result: Record<string, AgentNodeResult>,
  expectedKeys: readonly string[],
  context: { decisionId: string; agent: string },
): void {
  const missingOrEmpty: string[] = [];
  for (const key of expectedKeys) {
    const entry = result[key];
    if (!entry || entry.ok !== true) {
      missingOrEmpty.push(key);
      continue;
    }
    const output = entry.output;
    if (Array.isArray(output)) {
      if (output.length === 0) missingOrEmpty.push(key);
    } else if (typeof output === 'object' && output !== null) {
      if (Object.keys(output).length === 0) missingOrEmpty.push(key);
    } else {
      missingOrEmpty.push(key);
    }
  }
  if (missingOrEmpty.length > 0) {
    void context.agent;
    throw new EmptyAgentResponseError({
      decisionId: context.decisionId,
      responseKeys: Object.keys(result),
      missingOrEmptyKeys: missingOrEmpty,
    });
  }
}
