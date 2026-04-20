import type { RunnableConfig } from '@langchain/core/runnables';
import { ValidationError, type ValidationRule } from './types';

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
    const result = rule.validate(output as unknown as T);
    if (!result.valid) {
      throw new ValidationError(result.errors);
    }
    return output;
  };
}
