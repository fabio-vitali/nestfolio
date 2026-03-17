import type { AgentNodeFn } from './with-validation';

export function withFallback(
  node: AgentNodeFn,
  fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
): AgentNodeFn {
  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    try {
      return await node(state);
    } catch {
      return fallbackFn(state);
    }
  };
}
