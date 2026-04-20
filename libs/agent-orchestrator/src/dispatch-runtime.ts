import type { AgentInvocation } from './types';
import { invokeAgentCoreRuntime } from './invoke-agentcore';
import { invokeMockRuntime } from './invoke-mock';

/**
 * Dispatch an agent invocation to the right transport based on the SSM-resolved
 * target string.
 *
 *   arn:...      → AgentCore data-plane SDK call (production / sandbox)
 *   https://...  → plain fetch to a MockApiFixture-deployed Function URL (tests)
 *   anything else (incl. "DISABLED") → throws. The SSM polarity inversion makes
 *                                       absent configuration a hard failure, not
 *                                       a silent in-process fallback.
 */
export async function dispatchAgentInvocation<T>(
  target: string,
  payload: AgentInvocation,
): Promise<T> {
  if (target.startsWith('arn:')) {
    return invokeAgentCoreRuntime<T>(target, payload);
  }
  if (target.startsWith('https://')) {
    return invokeMockRuntime<T>(target, payload);
  }
  throw new Error(`Unrecognized agent runtime target: ${target}`);
}
