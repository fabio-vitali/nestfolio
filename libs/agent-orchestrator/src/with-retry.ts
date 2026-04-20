import { ValidationError, type RetryOptions } from './types';
import type { AgentNodeFn } from './with-validation';

export function withRetry(
  node: AgentNodeFn,
  options: RetryOptions,
): AgentNodeFn {
  const { maxAttempts, escalationPath } = options;

  return async (state, config) => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const escalatedState = { ...state };
        if (escalationPath && attempt > 0 && attempt < escalationPath.length) {
          escalatedState.__escalationTier = escalationPath[attempt];
        }
        return await node(escalatedState, config);
      } catch (error) {
        if (error instanceof ValidationError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError!;
  };
}
