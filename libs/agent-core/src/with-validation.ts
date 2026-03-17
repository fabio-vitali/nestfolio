import { ValidationError, type ValidationRule } from './types';

export type AgentNodeFn = (state: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function withValidation<T>(
  node: AgentNodeFn,
  rule: ValidationRule<T>,
): AgentNodeFn {
  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const output = await node(state);
    const result = rule.validate(output as unknown as T);
    if (!result.valid) {
      throw new ValidationError(result.errors);
    }
    return output;
  };
}
