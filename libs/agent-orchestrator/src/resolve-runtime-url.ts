import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'agent-orchestrator' });

/**
 * Resolve agent runtime URL from SSM via the Parameters and Secrets Lambda Extension.
 * Returns null if AGENT_RUNTIME_URL_PARAM is unset or the param value is empty/whitespace (in-process mode).
 *
 * No application-level cache — the Parameters and Secrets Extension already caches with a
 * configurable TTL (PARAMETERS_SECRETS_EXTENSION_CACHE_SIZE / _TTL env vars). Adding a second
 * cache layer would prevent SsmOverrideFixture from redirecting warm Lambda instances to mocks.
 */
export async function resolveAgentRuntimeUrl(): Promise<string | null> {
  const paramName = process.env.AGENT_RUNTIME_URL_PARAM;
  if (!paramName) return null;

  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;

  try {
    const res = await fetch(
      `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
      { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
    );
    const data = await res.json() as { Parameter: { Value: string } };
    const value = data.Parameter.Value?.trim() ?? '';
    return value.startsWith('https://') ? value : null;
  } catch (err) {
    logger.warn('resolveAgentRuntimeUrl: SSM lookup failed, falling back to in-process', { error: err });
    return null;
  }
}

/**
 * Invoke a remote agent runtime via HTTP POST.
 * Used when resolveAgentRuntimeUrl() returns a non-null URL.
 */
export async function invokeRemoteRuntime<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Remote agent runtime returned ${res.status}: ${await res.text()}`);
  }
  return await res.json() as T;
}
