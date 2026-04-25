import { readFileSync } from 'fs';
import { join } from 'path';

// realtime-rewrite.js is a literal CloudFront Function source — no
// templating, evaluated as-is in CF. In tests, load the file and
// instantiate the handler in a sandboxed Function.
function loadHandler(): (event: unknown) => unknown {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'cf-functions', 'realtime-rewrite.js'),
    'utf-8',
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${source}\nreturn handler;`)() as (event: unknown) => unknown;
}

describe('realtime-rewrite CF function', () => {
  const handler = loadHandler();

  function runEvent(uri: string) {
    const event = { request: { uri, querystring: {}, headers: {}, method: 'GET' } };
    const out = handler(event) as { uri: string };
    return out;
  }

  it('rewrites /realtime/<domain> to /graphql', () => {
    expect(runEvent('/realtime/investor').uri).toBe('/graphql');
    expect(runEvent('/realtime/advisory').uri).toBe('/graphql');
    expect(runEvent('/realtime/ledger').uri).toBe('/graphql');
    expect(runEvent('/realtime/dashboard').uri).toBe('/graphql');
  });

  it('rewrites /realtime/<domain>/ (trailing slash) to /graphql', () => {
    expect(runEvent('/realtime/investor/').uri).toBe('/graphql');
  });

  it('rewrites /graphql/<domain> to /graphql', () => {
    expect(runEvent('/graphql/investor').uri).toBe('/graphql');
    expect(runEvent('/graphql/advisory').uri).toBe('/graphql');
  });

  it('rewrites /graphql/<domain>/ (trailing slash) to /graphql', () => {
    expect(runEvent('/graphql/investor/').uri).toBe('/graphql');
  });

  it('does not rewrite /api/copilotkit*', () => {
    expect(runEvent('/api/copilotkit').uri).toBe('/api/copilotkit');
    expect(runEvent('/api/copilotkit/foo').uri).toBe('/api/copilotkit/foo');
  });

  it('does not rewrite the default behavior path', () => {
    expect(runEvent('/').uri).toBe('/');
    expect(runEvent('/index.html').uri).toBe('/index.html');
  });

  it('does not rewrite /mfe/<key>/* paths', () => {
    expect(runEvent('/mfe/investor/index.html').uri).toBe('/mfe/investor/index.html');
    expect(runEvent('/mfe/onboarding/remoteEntry.json').uri).toBe('/mfe/onboarding/remoteEntry.json');
  });

  it('does not rewrite paths that do not match the patterns', () => {
    expect(runEvent('/realtime').uri).toBe('/realtime');           // missing domain
    expect(runEvent('/graphql').uri).toBe('/graphql');              // already /graphql, untouched
    expect(runEvent('/realtimex/foo').uri).toBe('/realtimex/foo');
  });
});
