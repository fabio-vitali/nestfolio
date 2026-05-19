import { ValidationError, type RetryOptions } from './types';
import type { AgentNodeFn } from './with-validation';

export function withRetry(
  node: AgentNodeFn,
  options: RetryOptions,
): AgentNodeFn {
  const { maxAttempts } = options;

  return async (state, config) => {
    let lastError: Error | undefined;
    let workingState: Record<string, unknown> = state;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const enriched: Record<string, unknown> = { ...workingState, __retryAttempt: attempt };
        return await node(enriched, config);
      } catch (error) {
        if (error instanceof ValidationError) {
          lastError = error;
          workingState = {
            ...workingState,
            __retryFeedback: error.feedback ?? error.errors.join('\n'),
          };
          continue;
        }
        throw error;
      }
    }

    throw lastError!;
  };
}
