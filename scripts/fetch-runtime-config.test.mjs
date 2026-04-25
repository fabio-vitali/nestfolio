import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./fetch-runtime-config.sh', import.meta.url).pathname;
const REPO_ROOT = new URL('..', import.meta.url).pathname;

/**
 * Runs the script with a stubbed `aws` on PATH.
 *
 * @param awsResponses - Map of SSM path -> { value, exitCode }. Default exit 0.
 * @param args - Args passed after the script.
 * @param overrides.outDir - Override the output target's parent dir (default: tmpdir).
 */
function runScript({ awsResponses, args, outDir }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'fetch-rtcfg-'));
  const stubBin = join(sandbox, 'bin');
  mkdirSync(stubBin, { recursive: true });

  // Build the aws stub. It receives `aws ssm get-parameter --name <path> --query Parameter.Value --output text`.
  // Encode the response map as a JSON file the stub reads at runtime.
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

  // Output dir under sandbox: emulate workspace layout for OUT_PATH override.
  const outRoot = outDir ?? join(sandbox, 'workspace');
  mkdirSync(join(outRoot, 'apps/nestfolio-host/public/assets'), { recursive: true });

  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH}`,
      RUNTIME_CONFIG_OUT_ROOT: outRoot, // script honors this for tests
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
  '/nestfolio/dev-investor/auth/userPoolId':         { value: 'us-east-1_POOL' },
  '/nestfolio/dev-investor/auth/userPoolClientId':   { value: 'CLIENT_ID' },
  '/nestfolio/dev-investor/auth/region':             { value: 'us-east-1' },
  '/nestfolio/dev-investor/web/distributionUrl':     { value: 'https://d111111abcdef8.cloudfront.net' },
  '/nestfolio/dev-investor-bff/api/graphqlUrl':      { value: 'https://aaa.appsync-api.us-east-1.amazonaws.com/graphql' },
  '/nestfolio/dev-advisory-bff/api/graphqlUrl':      { value: 'https://bbb.appsync-api.us-east-1.amazonaws.com/graphql' },
  '/nestfolio/dev-ledger-bff/api/graphqlUrl':        { value: 'https://ccc.appsync-api.us-east-1.amazonaws.com/graphql' },
  '/nestfolio/dev-dashboard-bff/api/graphqlUrl':     { value: 'https://ddd.appsync-api.us-east-1.amazonaws.com/graphql' },
};

test('emits a valid config.json when all SSM params are present', () => {
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: ['--prefix=dev'] });
  assert.equal(result.status, 0, `script failed: ${result.stderr}`);
  const cfg = JSON.parse(result.written);
  assert.deepEqual(cfg.auth, {
    userPoolId: 'us-east-1_POOL',
    clientId: 'CLIENT_ID',
    region: 'us-east-1',
  });
  assert.equal(cfg.appsync.investorBff.endpoint, 'https://aaa.appsync-api.us-east-1.amazonaws.com/graphql');
  assert.equal(cfg.appsync.investorBff.region, 'us-east-1');
  assert.equal(cfg.appsync.advisoryBff.endpoint, 'https://bbb.appsync-api.us-east-1.amazonaws.com/graphql');
  assert.equal(cfg.appsync.ledgerBff.endpoint,   'https://ccc.appsync-api.us-east-1.amazonaws.com/graphql');
  assert.equal(cfg.appsync.dashboardBff.endpoint,'https://ddd.appsync-api.us-east-1.amazonaws.com/graphql');
  assert.equal(cfg.copilotApiUrl, 'https://d111111abcdef8.cloudfront.net/api/copilotkit');
  assert.equal(Object.keys(cfg).sort().join(','), 'appsync,auth,copilotApiUrl');
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
  // No assertion on region in payload beyond what the SSM stub returned;
  // success is enough — this case just exercises the flag parser. Region
  // resolution itself is delegated to the AWS CLI (env vars / ~/.aws/config).
});
