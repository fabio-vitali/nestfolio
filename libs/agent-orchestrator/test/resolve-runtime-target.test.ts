import { resolveAgentRuntimeTarget } from '../src/resolve-runtime-target';

describe('resolveAgentRuntimeTarget', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('throws when AGENT_RUNTIME_URL_PARAM is not set', async () => {
    delete process.env.AGENT_RUNTIME_URL_PARAM;
    await expect(resolveAgentRuntimeTarget()).rejects.toThrow(
      'AGENT_RUNTIME_URL_PARAM env var is required',
    );
  });

  it('returns the SSM value verbatim when the extension responds', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/foo/bar';
    process.env.AWS_SESSION_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ Parameter: { Value: 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/x' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const target = await resolveAgentRuntimeTarget();
    expect(target).toBe('arn:aws:bedrock-agentcore:us-east-1:1:runtime/x');
  });

  it('throws when SSM holds the DISABLED sentinel', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/foo/bar';
    process.env.AWS_SESSION_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ Parameter: { Value: 'DISABLED' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(resolveAgentRuntimeTarget()).rejects.toThrow(
      'agent runtime target is DISABLED',
    );
  });
});
