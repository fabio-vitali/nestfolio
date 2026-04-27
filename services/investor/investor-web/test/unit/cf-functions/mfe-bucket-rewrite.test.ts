import { readFileSync } from 'fs';
import { join } from 'path';

// mfe-bucket-rewrite.js is a literal CloudFront Function source — no
// templating, evaluated as-is in CF. In tests, load the file and
// instantiate the handler in a sandboxed Function.
function loadHandler(): (event: unknown) => unknown {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'cf-functions', 'mfe-bucket-rewrite.js'),
    'utf-8',
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${source}\nreturn handler;`)() as (event: unknown) => unknown;
}

describe('mfe-bucket-rewrite CF function', () => {
  const handler = loadHandler();

  function runEvent(uri: string) {
    const event = { request: { uri, querystring: {}, headers: {}, method: 'GET' } };
    const out = handler(event) as { uri: string };
    return out;
  }

  it('strips /mfe/<key> prefix from object paths', () => {
    expect(runEvent('/mfe/investor/remoteEntry.json').uri).toBe('/remoteEntry.json');
    expect(runEvent('/mfe/advisory/remoteEntry.json').uri).toBe('/remoteEntry.json');
    expect(runEvent('/mfe/ledger/main-ABC.js').uri).toBe('/main-ABC.js');
    expect(runEvent('/mfe/dashboard/chunk-XYZ.js').uri).toBe('/chunk-XYZ.js');
    expect(runEvent('/mfe/onboarding/styles.css').uri).toBe('/styles.css');
  });

  it('strips /mfe/<key>/<nested>/<file> correctly', () => {
    expect(runEvent('/mfe/investor/assets/icon.png').uri).toBe('/assets/icon.png');
  });

  it('rewrites bare /mfe/<key>/ (trailing slash) to /', () => {
    expect(runEvent('/mfe/investor/').uri).toBe('/');
  });

  it('rewrites bare /mfe/<key> (no trailing slash) to /', () => {
    expect(runEvent('/mfe/investor').uri).toBe('/');
  });

  it('does not rewrite /mfe (no key)', () => {
    expect(runEvent('/mfe').uri).toBe('/mfe');
  });

  it('does not rewrite paths outside /mfe/*', () => {
    expect(runEvent('/').uri).toBe('/');
    expect(runEvent('/index.html').uri).toBe('/index.html');
    expect(runEvent('/assets/config.json').uri).toBe('/assets/config.json');
    expect(runEvent('/realtime/investor').uri).toBe('/realtime/investor');
    expect(runEvent('/graphql/investor').uri).toBe('/graphql/investor');
    expect(runEvent('/api/copilotkit').uri).toBe('/api/copilotkit');
  });

  it('does not match /mfex/foo (similar but different prefix)', () => {
    expect(runEvent('/mfex/foo').uri).toBe('/mfex/foo');
  });
});
