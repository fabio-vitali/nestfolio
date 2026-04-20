import type { AgentInvocation } from './types';

/**
 * Invoke an HTTPS mock agent runtime (Lambda Function URL) via plain fetch.
 *
 * Used by integration tests after `SsmOverrideFixture` redirects the SSM
 * runtime-target parameter to a `MockApiFixture`-deployed URL. Production
 * never hits this branch because production SSM holds an `arn:` value.
 */
export async function invokeMockRuntime<T>(url: string, payload: AgentInvocation): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Mock agent runtime returned ${res.status}: ${await res.text()}`);
  }
  return await res.json() as T;
}
