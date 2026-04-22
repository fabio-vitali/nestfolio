import { readFileSync } from 'fs';
import { join } from 'path';

// The CF Function source is a template: `__RUNTIME_ARN__` is substituted at
// deploy time via `Fn.sub`. In tests, substitute a fake ARN and evaluate the
// handler in a sandboxed Function.
function loadHandler(runtimeArn: string): (event: unknown) => unknown {
  const template = readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'cf-functions', 'copilot-rewrite.js'),
    'utf-8',
  );
  const substituted = template.replace(/__RUNTIME_ARN__/g, runtimeArn);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${substituted}\nreturn handler;`)() as (event: unknown) => unknown;
}

describe('copilot-rewrite CF function', () => {
  const ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/onboarding_agent-abc';
  const handler = loadHandler(ARN);

  function runEvent(uri: string, querystring: Record<string, { value: string }> = {}) {
    const event = { request: { uri, querystring, headers: {}, method: 'POST' } };
    const out = handler(event) as { uri: string; querystring: Record<string, { value: string }> };
    return out;
  }

  it('rewrites /api/copilotkit to /runtimes/<encoded-arn>/invocations', () => {
    const out = runEvent('/api/copilotkit');
    expect(out.uri).toBe(`/runtimes/${encodeURIComponent(ARN)}/invocations`);
  });

  it('rewrites /api/copilotkit/ (trailing slash) the same way', () => {
    const out = runEvent('/api/copilotkit/');
    expect(out.uri).toBe(`/runtimes/${encodeURIComponent(ARN)}/invocations`);
  });

  it('sets qualifier=DEFAULT on the querystring regardless of input', () => {
    const out = runEvent('/api/copilotkit', { x: { value: 'y' } });
    expect(out.querystring).toEqual({ qualifier: { value: 'DEFAULT' } });
  });
});
