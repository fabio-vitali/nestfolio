import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'agent-orchestrator' });

/**
 * Resolve the agent runtime target string from SSM via the Parameters and
 * Secrets Lambda Extension. Returns the raw value — the dispatcher decides
 * whether it's an AgentCore ARN or a mock HTTPS URL.
 *
 * No application-level cache — the Parameters and Secrets Extension already
 * caches with a configurable TTL. Adding a second cache layer would prevent
 * SsmOverrideFixture from redirecting warm Lambda instances to mocks.
 *
 * Throws if the env var is missing, if SSM lookup fails, or if the resolved
 * value is the literal "DISABLED" sentinel — there is no in-process fallback
 * any more, so misconfiguration must surface as an error, not silently degrade.
 */
export async function resolveAgentRuntimeTarget(): Promise<string> {
  const paramName = process.env.AGENT_RUNTIME_URL_PARAM;
  if (!paramName) {
    throw new Error('AGENT_RUNTIME_URL_PARAM env var is required');
  }

  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;

  const res = await fetch(
    `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  if (!res.ok) {
    throw new Error(`SSM lookup for ${paramName} returned ${res.status}`);
  }
  const data = await res.json() as { Parameter?: { Value?: string } };
  const value = data.Parameter?.Value?.trim() ?? '';
  if (value === '' || value === 'DISABLED') {
    logger.error('resolveAgentRuntimeTarget: agent runtime target is DISABLED', { paramName });
    throw new Error(`agent runtime target is DISABLED for ${paramName}`);
  }
  return value;
}
