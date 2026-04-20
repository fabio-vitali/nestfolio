import type { AgentNodeFn } from './with-validation';

export function withFallback(
  node: AgentNodeFn,
  fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
): AgentNodeFn {
  return async (state, config) => {
    try {
      return await node(state, config);
    } catch {
      return fallbackFn(state);
    }
  };
}
