import type { RunnableConfig } from '@langchain/core/runnables';
import { ValidationError, type ValidationContext, type ValidationRule } from './types';

export type AgentNodeFn = (
  state: Record<string, unknown>,
  config?: RunnableConfig,
) => Promise<Record<string, unknown>>;

export function withValidation<T>(
  node: AgentNodeFn,
  rule: ValidationRule<T>,
): AgentNodeFn {
  return async (state, config) => {
    const output = await node(state, config);
    const attempt = (state['__retryAttempt'] as number | undefined) ?? 0;
    const ctx: ValidationContext = { state, attempt };
    const result = rule.validate(output as unknown as T, ctx);
    if (!result.valid) {
      throw new ValidationError(result.errors, { feedback: result.feedback });
    }
    return output;
  };
}
