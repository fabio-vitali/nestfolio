import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./fetch-runtime-config.sh', import.meta.url).pathname;

function runScript({ awsResponses, args, outDir }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'fetch-rtcfg-'));
  const stubBin = join(sandbox, 'bin');
  mkdirSync(stubBin, { recursive: true });

  const responsesPath = join(sandbox, 'responses.json');
  writeFileSync(responsesPath, JSON.stringify(awsResponses));
  const stubPath = join(stubBin, 'aws');
  writeFileSync(stubPath, `#!/usr/bin/env bash
NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done
RESPONSES_FILE="${responsesPath}" NAME="$NAME" node -e "
  const r = JSON.parse(require('fs').readFileSync(process.env.RESPONSES_FILE, 'utf-8'));
  const entry = r[process.env.NAME];
  if (!entry) { process.stderr.write('ParameterNotFound: ' + process.env.NAME + '\\n'); process.exit(1); }
  if (entry.exitCode && entry.exitCode !== 0) { process.stderr.write(entry.value + '\\n'); process.exit(entry.exitCode); }
  process.stdout.write(entry.value);
"
`, { mode: 0o755 });
  chmodSync(stubPath, 0o755);

  const outRoot = outDir ?? join(sandbox, 'workspace');
  mkdirSync(join(outRoot, 'apps/nestfolio-host/public/assets'), { recursive: true });

  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH}`,
      RUNTIME_CONFIG_OUT_ROOT: outRoot,
    },
  });

  let written = null;
  try {
    written = readFileSync(join(outRoot, 'apps/nestfolio-host/public/assets/config.json'), 'utf-8');
  } catch { /* not written — test will check */ }

  rmSync(sandbox, { recursive: true, force: true });
  return { ...result, written };
}

const HAPPY_RESPONSES = {
  '/nestfolio/dev-investor/auth/userPoolId':       { value: 'us-east-1_POOL' },
  '/nestfolio/dev-investor/auth/userPoolClientId': { value: 'CLIENT_ID' },
  '/nestfolio/dev-investor/auth/region':           { value: 'us-east-1' },
  '/nestfolio/dev-investor/web/distributionUrl':   { value: 'https://d111111abcdef8.cloudfront.net' },
};

test('emits a charter-§8 config.json (auth + copilotApiUrl only) when SSM is healthy', () => {
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: ['--prefix=dev'] });
  assert.equal(result.status, 0, `script failed: ${result.stderr}`);
  const cfg = JSON.parse(result.written);
  assert.deepEqual(cfg.auth, {
    userPoolId: 'us-east-1_POOL',
    clientId: 'CLIENT_ID',
    region: 'us-east-1',
  });
  assert.equal(cfg.copilotApiUrl, 'https://d111111abcdef8.cloudfront.net/api/copilotkit');
  assert.equal(Object.keys(cfg).sort().join(','), 'auth,copilotApiUrl');
  assert.equal(cfg.appsync, undefined);
});

test('does NOT query *-bff/api/graphqlUrl SSM paths', () => {
  // If the script tried to query a BFF endpoint that isn't in HAPPY_RESPONSES,
  // the stub would exit non-zero and the script would propagate the failure.
  // The previous test passing therefore covers this — restate explicitly:
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: ['--prefix=dev'] });
  assert.equal(result.status, 0);
});

test('exits non-zero with a named-path error when an SSM param is missing', () => {
  const broken = { ...HAPPY_RESPONSES };
  delete broken['/nestfolio/dev-investor/auth/userPoolId'];
  const result = runScript({ awsResponses: broken, args: ['--prefix=dev'] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\/nestfolio\/dev-investor\/auth\/userPoolId/);
  assert.match(result.stderr, /deploy\.sh/);
  assert.equal(result.written, null);
});

test('exits non-zero with usage when --prefix is missing', () => {
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: [] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--prefix/);
});

test('accepts --region as an explicit override', () => {
  const result = runScript({
    awsResponses: HAPPY_RESPONSES,
    args: ['--prefix=dev', '--region=us-east-1'],
  });
  assert.equal(result.status, 0, result.stderr);
});
