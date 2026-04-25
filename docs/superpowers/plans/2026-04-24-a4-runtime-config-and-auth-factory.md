# A4 — Runtime config producer + auth factory injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shell fetch its runtime configuration from SSM via a producer script (`scripts/fetch-runtime-config.sh` + `nestfolio-host:config` Nx target) and consume it through factory-bound DI tokens (`AuthConfig` abstract class), eliminating every `environment.ts` resource literal and the silent-fallback bootstrap path.

**Architecture:** Bash producer reads SSM and writes `apps/nestfolio-host/public/assets/config.json` (gitignored). At app bootstrap, `loadRuntimeConfig` fail-hard fetches that file. The config is exposed via `AuthConfig` (abstract-class DI token, pattern from `shape-frontends/libs/core/auth`); `provideAuth()` becomes no-args and reads `inject(AuthConfig)` inside its `APP_INITIALIZER`. `environment.ts`/`environment.prod.ts` are deleted.

**Tech Stack:** Bash + AWS CLI (producer), Node 20 `node:test` (producer harness), Angular 19 standalone `APP_INITIALIZER`s + `makeEnvironmentProviders`, Jest (existing app + lib specs), CDK + `aws-cdk-lib/assertions` Template (investor-web stack assertion).

**Reference design:** `docs/superpowers/specs/2026-04-24-a4-runtime-config-and-auth-factory-design.md`. Read it before starting.

---

## File map

**Create:**
- `scripts/fetch-runtime-config.sh` — bash producer.
- `scripts/fetch-runtime-config.test.mjs` — `node:test` runner harness for the producer.
- `libs/shell/test/auth/auth.provider.spec.ts` — new spec for `provideAuth()`.

**Modify:**
- `services/investor/investor-web/src/service.stack.ts` — add `auth/region` SSM export.
- `services/investor/investor-web/test/unit/service.stack.test.ts` — assert the new SSM export.
- `services/investor/investor-web/CLAUDE.md` — add `auth/region` to "SSM Parameters Published".
- `apps/nestfolio-host/project.json` — add `config` Nx target.
- `apps/nestfolio-host/src/app/app.config.ts` — rewrite `loadRuntimeConfig` (fail-hard), drop `environment` import, replace `provideAuth(environment.auth)` with `provideAuth()` + `AuthConfig` factory provider.
- `libs/shell/src/auth/auth.config.ts` — flip `interface` → `abstract class`.
- `libs/shell/src/auth/auth.provider.ts` — `provideAuth()` (no args) reading `inject(AuthConfig)` inside its APP_INITIALIZER.
- `libs/shell/src/auth/index.ts` — change `export type { AuthConfig }` → `export { AuthConfig }`.
- `apps/nestfolio-host/test/app/app.config.spec.ts` — adjust for fail-hard + new shape (`AuthConfig` provider ordering).
- `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` — adjust for fail-hard semantics.
- `.gitignore` — add `apps/nestfolio-host/public/assets/config.json`.
- `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md` — append A4 ship entry.

**Delete:**
- `apps/nestfolio-host/src/environments/environment.ts`
- `apps/nestfolio-host/src/environments/environment.prod.ts`
- `apps/nestfolio-host/src/environments/` (resulting empty directory)
- `apps/nestfolio-host/public/assets/config.json` (currently checked-in placeholder; replaced by gitignored producer output)

---

## Task 1: investor-web stack — `auth/region` SSM export

**Files:**
- Modify: `services/investor/investor-web/src/service.stack.ts:226-229` (insert new `StringParameter` between `UserPoolClientIdParam` and `DistributionUrlParam`)
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts` (append new `describe` block)

- [ ] **Step 1: Write the failing test**

In `services/investor/investor-web/test/unit/service.stack.test.ts`, append at end of file (before final newline):

```typescript
describe('InvestorWebStack — runtime config SSM exports', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStackRuntimeConfig', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('publishes auth/region for the runtime config producer', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/auth/region',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test investor-web -- --testPathPattern=service.stack
```

Expected: FAIL — no SSM::Parameter with `Name: /nestfolio/test-investor/auth/region` exists.

- [ ] **Step 3: Add the SSM export**

In `services/investor/investor-web/src/service.stack.ts`, immediately after the `UserPoolClientIdParam` block (currently lines 226-229), insert:

```typescript
    new StringParameter(this, 'AuthRegionParam', {
      parameterName: this.naming.ssmParameterPath('auth/region'),
      stringValue: this.region,
    });
```

`this.region` is the standard CDK `Stack.region` accessor (already available via the `ServiceStack` superclass). No new imports needed.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm nx test investor-web -- --testPathPattern=service.stack
```

Expected: PASS — both the new test and all pre-existing tests in the file pass.

- [ ] **Step 5: Update service card**

In `services/investor/investor-web/CLAUDE.md`, find the `## SSM Parameters Published` section and append `auth/region` so the block reads:

```
## SSM Parameters Published
- auth/userPoolId
- auth/userPoolClientId
- auth/region
- web/distributionUrl
- web/distributionId
```

- [ ] **Step 6: Verify cdk synth still works**

```bash
pnpm nx run investor-web:synth --configuration=sandbox 2>/dev/null || \
  bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --synth-only 2>&1 | tail -20
```

Expected: synth succeeds. (Use whichever invocation matches the workspace — `synth` Nx target if present, deploy script `--synth-only` otherwise.)

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts \
        services/investor/investor-web/test/unit/service.stack.test.ts \
        services/investor/investor-web/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(a4-runtime-config-and-auth-factory): publish auth/region SSM param from investor-web

Adds /nestfolio/<prefix>-investor/auth/region alongside the existing
auth/userPoolId and auth/userPoolClientId, so fetch-runtime-config.sh
can read the region from SSM rather than hard-coding it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `AuthConfig` — flip interface to abstract class

**Files:**
- Modify: `libs/shell/src/auth/auth.config.ts`
- Modify: `libs/shell/src/auth/index.ts`

This task is structural-only (no behavior change); behavior change happens in Task 3 (`provideAuth()` rewrite). Tests for the rewritten `provideAuth()` are written in Task 3.

- [ ] **Step 1: Read the current shape**

The current `libs/shell/src/auth/auth.config.ts`:

```typescript
export interface AuthConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}
```

- [ ] **Step 2: Flip to abstract class**

Replace the entire content of `libs/shell/src/auth/auth.config.ts` with:

```typescript
/**
 * DI token + type for runtime auth configuration.
 * Pattern: abstract class as injection token (matches shape-frontends/libs/core/auth).
 *
 * Consumers: `inject(AuthConfig)` from inside a factory or constructor.
 * Provider: registered by the shell app with a `useFactory` reading
 * `getRuntimeConfig().auth` (charter §8 bootstrap discipline).
 */
export abstract class AuthConfig {
  abstract userPoolId: string;
  abstract clientId: string;
  abstract region: string;
}
```

- [ ] **Step 3: Update the lib's public re-export**

In `libs/shell/src/auth/index.ts`, change:

```typescript
export type { AuthConfig } from './auth.config';
```

to:

```typescript
export { AuthConfig } from './auth.config';
```

(Abstract classes are values at runtime — re-exporting as a value-export is required so consumers can call `inject(AuthConfig)`.)

- [ ] **Step 4: Verify the lib builds**

```bash
pnpm nx build shell
```

Expected: build succeeds. If TypeScript flags any old consumer that did `const x: AuthConfig = { ... }` (object-literal coercion to the abstract class is fine; new-ing it is not), fix in this task — `inject(AuthConfig)` is value-coerce-compatible with `{ userPoolId, clientId, region }`.

- [ ] **Step 5: Verify the lib's existing tests still pass**

```bash
pnpm nx test shell
```

Expected: PASS — existing tests don't construct `AuthConfig`; they don't break.

- [ ] **Step 6: Commit**

```bash
git add libs/shell/src/auth/auth.config.ts libs/shell/src/auth/index.ts
git commit -m "$(cat <<'EOF'
refactor(a4-runtime-config-and-auth-factory): flip AuthConfig to abstract class as DI token

Adopts the shape-frontends/libs/core/auth pattern — a single abstract
class declaration acting as both the type and the Angular DI token.
Behavior unchanged in this commit; provideAuth() rewrite follows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `provideAuth()` — no-args, factory-bound

**Files:**
- Modify: `libs/shell/src/auth/auth.provider.ts`
- Create: `libs/shell/test/auth/auth.provider.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shell/test/auth/auth.provider.spec.ts`:

```typescript
jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from '../../src/auth/auth.config';
import { provideAuth } from '../../src/auth/auth.provider';

describe('provideAuth()', () => {
  beforeEach(() => {
    (Amplify.configure as jest.Mock).mockClear();
  });

  it('configures Amplify with values resolved via inject(AuthConfig)', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => ({
            userPoolId: 'pool-from-factory',
            clientId: 'client-from-factory',
            region: 'us-east-1',
          }),
        },
        provideAuth(),
      ],
    });

    // Run all APP_INITIALIZER factories.
    const initializers = TestBed.inject(APP_INITIALIZER);
    const initFns = (Array.isArray(initializers) ? initializers : [initializers])
      .map((fn: () => unknown) => fn());
    await Promise.all(initFns);

    expect(Amplify.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          userPoolId: 'pool-from-factory',
          userPoolClientId: 'client-from-factory',
        },
      },
    });
  });

  it('reads AuthConfig at injection time, not at provider-setup time', async () => {
    // Prove the factory is deferred: build providers BEFORE the AuthConfig
    // factory has a value to return, then assert Amplify.configure picks up
    // the value computed at inject() time.
    let regionAtInjectTime = 'unset';
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => ({
            userPoolId: 'pool',
            clientId: 'client',
            region: regionAtInjectTime,
          }),
        },
        provideAuth(),
      ],
    });

    // Mutate the closure variable AFTER providers are configured but BEFORE
    // the APP_INITIALIZER factories run.
    regionAtInjectTime = 'us-east-1';

    const initializers = TestBed.inject(APP_INITIALIZER);
    const initFns = (Array.isArray(initializers) ? initializers : [initializers])
      .map((fn: () => unknown) => fn());
    await Promise.all(initFns);

    // The injected AuthConfig.region must be the post-mutation value.
    const cfg = TestBed.inject(AuthConfig);
    expect(cfg.region).toBe('us-east-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test shell -- --testPathPattern=auth.provider
```

Expected: FAIL — `provideAuth()` (no-args) does not exist yet (current signature requires a `config` argument).

- [ ] **Step 3: Rewrite `provideAuth()`**

Replace the entire content of `libs/shell/src/auth/auth.provider.ts` with:

```typescript
import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, inject } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from './auth.config';

/**
 * Registers the Amplify configuration step as an APP_INITIALIZER.
 * Reads `AuthConfig` from DI at injection time — the value must be provided
 * by the consuming app via `{ provide: AuthConfig, useFactory: () => ... }`.
 *
 * Charter §8 bootstrap discipline: this initializer must run AFTER the
 * runtime-config loader has populated the source the AuthConfig factory
 * reads from. Ordering is the consumer app's responsibility.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const cfg = inject(AuthConfig);
        return () => {
          Amplify.configure({
            Auth: {
              Cognito: {
                userPoolId: cfg.userPoolId,
                userPoolClientId: cfg.clientId,
              },
            },
          });
        };
      },
      multi: true,
    },
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm nx test shell -- --testPathPattern=auth.provider
```

Expected: PASS — both new tests succeed.

- [ ] **Step 5: Run the full shell lib suite to catch any regressions**

```bash
pnpm nx test shell
```

Expected: PASS — no other shell test invokes `provideAuth(arg)` (it was only called from `app.config.ts`, which is in a different project and is updated in Task 6).

- [ ] **Step 6: Commit**

```bash
git add libs/shell/src/auth/auth.provider.ts libs/shell/test/auth/auth.provider.spec.ts
git commit -m "$(cat <<'EOF'
refactor(a4-runtime-config-and-auth-factory): provideAuth() becomes no-args, reads inject(AuthConfig)

Charter §8 bootstrap discipline: Amplify is now configured by an
APP_INITIALIZER that reads AuthConfig at injection time, not from a
value captured at provider-setup time. This kills the silent-pool
bug where placeholder env literals beat the runtime-config fetch.

The shell app must register {provide: AuthConfig, useFactory: () =>
getRuntimeConfig().auth} BEFORE provideAuth() in its providers array
so the loader runs first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Producer script — `scripts/fetch-runtime-config.sh`

**Files:**
- Create: `scripts/fetch-runtime-config.sh`
- Create: `scripts/fetch-runtime-config.test.mjs`

- [ ] **Step 1: Write the failing test harness**

Create `scripts/fetch-runtime-config.test.mjs`:

```javascript
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
  const awsStub = `#!/usr/bin/env bash
# Stub aws CLI: extracts --name <path> from "aws ssm get-parameter --name <path> ..."
set -e
RESPONSES_FILE="${responsesPath}"
NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done
node -e "
  const r = JSON.parse(require('fs').readFileSync(process.env.RESPONSES_FILE, 'utf-8'));
  const entry = r[process.env.NAME];
  if (!entry) { process.stderr.write('ParameterNotFound: ' + process.env.NAME + '\\n'); process.exit(1); }
  if (entry.exitCode && entry.exitCode !== 0) { process.stderr.write(entry.value + '\\n'); process.exit(entry.exitCode); }
  process.stdout.write(entry.value);
" 
`;
  const stubPath = join(stubBin, 'aws');
  writeFileSync(stubPath, awsStub, { mode: 0o755 });
  // Wrap the stub so RESPONSES_FILE + NAME are visible.
  // Easier: rewrite to inline env injection.
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

test('honors --region (default us-east-1)', () => {
  const result = runScript({
    awsResponses: HAPPY_RESPONSES,
    args: ['--prefix=dev', '--region=us-east-1'],
  });
  assert.equal(result.status, 0, result.stderr);
  // No assertion on region in payload beyond what the SSM stub returned;
  // success is enough — this case just exercises the flag parser.
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```

Expected: FAIL — `scripts/fetch-runtime-config.sh` does not exist.

- [ ] **Step 3: Implement the producer**

Create `scripts/fetch-runtime-config.sh`:

```bash
#!/usr/bin/env bash
#
# fetch-runtime-config.sh — A4 runtime config producer.
#
# Reads the runtime-config SSM parameters published by the investor subsystem
# (auth, BFF AppSync endpoints, web distribution URL) and writes
# apps/nestfolio-host/public/assets/config.json.
#
# Charter §8: the only producer of the shell's runtime-config payload.
#
# Usage:
#   bash scripts/fetch-runtime-config.sh --prefix=<prefix> [--region=<region>]
#
# Exits non-zero with a named-path error if any SSM parameter is missing or
# AWS credentials are unavailable. No silent fallback.
#
set -euo pipefail

PREFIX=""
REGION="us-east-1"

usage() {
  cat >&2 <<EOF
Usage: bash scripts/fetch-runtime-config.sh --prefix=<prefix> [--region=<region>]

  --prefix    Required. SSM parameter prefix (e.g. dev, staging, prod).
  --region    Optional. AWS region for SSM queries. Default: us-east-1.
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    --prefix)   PREFIX="${2:-}"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --region)   REGION="${2:-}"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$PREFIX" ]] || usage

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found. Install via your package manager." >&2
  exit 127
fi

# Output path. Tests override the output root via RUNTIME_CONFIG_OUT_ROOT.
OUT_ROOT="${RUNTIME_CONFIG_OUT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
OUT_PATH="${OUT_ROOT}/apps/nestfolio-host/public/assets/config.json"

# Reads one SSM parameter. Names the path + remediation in the failure message.
get_ssm() {
  local path="$1"
  local owning_service="$2"
  local value
  if ! value="$(aws ssm get-parameter --region "$REGION" --name "$path" --query 'Parameter.Value' --output text 2>&1)"; then
    cat >&2 <<EOF
SSM param not found or unreadable: ${path}
Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=${PREFIX} --services=${owning_service}\` first.
(aws stderr was: ${value})
EOF
    exit 1
  fi
  printf '%s' "$value"
}

USER_POOL_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolId" "investor-web")"
CLIENT_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "investor-web")"
AUTH_REGION="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/region" "investor-web")"
DIST_URL="$(get_ssm "/nestfolio/${PREFIX}-investor/web/distributionUrl" "investor-web")"
INVESTOR_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-investor-bff/api/graphqlUrl" "investor-bff")"
ADVISORY_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-advisory-bff/api/graphqlUrl" "advisory-bff")"
LEDGER_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-ledger-bff/api/graphqlUrl" "ledger-bff")"
DASHBOARD_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-dashboard-bff/api/graphqlUrl" "dashboard-bff")"

# JSON encoder: minimal, used per-string to escape backslash and double-quote.
json_str() { printf '"%s"' "${1//\"/\\\"}" ; }

mkdir -p "$(dirname "$OUT_PATH")"
{
  printf '{\n'
  printf '  "auth": {\n'
  printf '    "userPoolId": %s,\n' "$(json_str "$USER_POOL_ID")"
  printf '    "clientId": %s,\n'   "$(json_str "$CLIENT_ID")"
  printf '    "region": %s\n'      "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "appsync": {\n'
  printf '    "investorBff":  { "endpoint": %s, "region": %s },\n' "$(json_str "$INVESTOR_BFF_URL")"  "$(json_str "$AUTH_REGION")"
  printf '    "advisoryBff":  { "endpoint": %s, "region": %s },\n' "$(json_str "$ADVISORY_BFF_URL")"  "$(json_str "$AUTH_REGION")"
  printf '    "dashboardBff": { "endpoint": %s, "region": %s },\n' "$(json_str "$DASHBOARD_BFF_URL")" "$(json_str "$AUTH_REGION")"
  printf '    "ledgerBff":    { "endpoint": %s, "region": %s }\n'  "$(json_str "$LEDGER_BFF_URL")"    "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "copilotApiUrl": %s\n' "$(json_str "${DIST_URL}/api/copilotkit")"
  printf '}\n'
} > "$OUT_PATH"

echo "Wrote ${OUT_PATH}"
```

Make it executable:

```bash
chmod +x scripts/fetch-runtime-config.sh
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```

Expected: PASS — all four tests succeed.

- [ ] **Step 5: Manual smoke against real AWS (optional, only if creds present)**

If the developer has dev creds available:

```bash
RUNTIME_CONFIG_OUT_ROOT=$(mktemp -d) bash scripts/fetch-runtime-config.sh --prefix=dev
cat $RUNTIME_CONFIG_OUT_ROOT/apps/nestfolio-host/public/assets/config.json | head -20
```

Expected: real values populated, exit 0. Skip this step if creds aren't readily available — the harness covers behavior.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-runtime-config.sh scripts/fetch-runtime-config.test.mjs
git commit -m "$(cat <<'EOF'
feat(a4-runtime-config-and-auth-factory): runtime config producer (fetch-runtime-config.sh)

New bash producer reads the investor-subsystem SSM parameters and
writes apps/nestfolio-host/public/assets/config.json. Fails non-zero
with a named-path error if any param is missing — no silent fallback.

copilotApiUrl is derived from web/distributionUrl as
"<distributionUrl>/api/copilotkit" — same chain as the CloudFront
behavior in services/investor/investor-web/src/service.stack.ts:212.

Tests use node:test with a tmpdir-stubbed `aws` on PATH, matching
the existing scripts/emit-index-html.test.mjs pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Nx `config` target on `nestfolio-host`

**Files:**
- Modify: `apps/nestfolio-host/project.json`

- [ ] **Step 1: Inspect current targets**

Read `apps/nestfolio-host/project.json` and locate the `targets` block. The `config` target will be added at the same level as `prepare-index`, `esbuild`, `build`, `serve`.

- [ ] **Step 2: Add the `config` target**

Insert the following `config` target into `apps/nestfolio-host/project.json` `targets` object, immediately after the `prepare-index` target:

```json
    "config": {
      "executor": "nx:run-commands",
      "inputs": ["{workspaceRoot}/scripts/fetch-runtime-config.sh"],
      "outputs": ["{projectRoot}/public/assets/config.json"],
      "options": {
        "cwd": "{workspaceRoot}",
        "commands": [
          "bash scripts/fetch-runtime-config.sh --prefix={args.prefix} --region={args.region}"
        ]
      },
      "cache": false
    },
```

- [ ] **Step 3: Verify Nx parses the target**

```bash
pnpm nx show project nestfolio-host --json 2>&1 | head -30
```

Expected: JSON output includes `"config"` in the targets list. No parse error.

- [ ] **Step 4: Verify the target works against the test harness**

Even without AWS creds, we can exercise the wiring via the existing `node:test` harness from Task 4. To smoke the Nx target itself, run with a stubbed `aws` only if creds are not present — otherwise run for real:

```bash
# Real run (requires AWS creds via Leapp):
pnpm nx run nestfolio-host:config --prefix=dev --region=us-east-1
```

Expected (with creds): `Wrote .../apps/nestfolio-host/public/assets/config.json`, real values inside.

If creds aren't available, skip this step; the script test covers the wiring.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-host/project.json
git commit -m "$(cat <<'EOF'
feat(a4-runtime-config-and-auth-factory): nestfolio-host:config Nx target

Wires fetch-runtime-config.sh as a manual prereq target on the shell.
Charter §8 pipeline order — workflow becomes:

  pnpm nx run nestfolio-host:config --prefix=<prefix>
  pnpm nx serve nestfolio-host

cache: false because the script's output depends on AWS state, not
on its source. No dependsOn from serve/esbuild — coupling them
would surprise developers without AWS creds with an opaque error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Shell `app.config.ts` rewrite

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.config.ts`

This is the key behavioral change. Tests are updated in Task 7. The test rewrites are intentionally separated so this commit lands the production code change atomically; the next commit fixes the test fallout.

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `apps/nestfolio-host/src/app/app.config.ts` with:

```typescript
import { ApplicationConfig, provideZonelessChangeDetection, APP_INITIALIZER, ErrorHandler, isDevMode, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAuth, authInterceptor, getAuthUser, AuthConfig } from '@nestfolio/shell/auth';
import { provideI18n } from '@nestfolio/shell/i18n';
import { provideNestfolioTheme } from '@nestfolio/ui';
import { AuthStore, GlobalErrorHandler, FeatureFlagService, COPILOT_API_URL } from '@nestfolio/shell';
import { appRoutes } from './app.routes';

export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  appsync: {
    investorBff: { endpoint: string; region: string };
    advisoryBff: { endpoint: string; region: string };
    dashboardBff: { endpoint: string; region: string };
    ledgerBff: { endpoint: string; region: string };
  };
  copilotApiUrl: string;
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      'Runtime config not initialised. loadRuntimeConfig must run as an APP_INITIALIZER before any consumer reads getRuntimeConfig().',
    );
  }
  return runtimeConfig;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const endpoints = [
    config.appsync.investorBff.endpoint,
    config.appsync.advisoryBff.endpoint,
    config.appsync.dashboardBff.endpoint,
    config.appsync.ledgerBff.endpoint,
    config.copilotApiUrl,
  ];

  for (const url of endpoints) {
    if (!url) continue;
    if (url.startsWith('https://')) continue;
    if (isDevMode() && url.startsWith('http://localhost')) continue;
    throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
  }
}

export function loadRuntimeConfig(): () => Promise<void> {
  return async () => {
    const remediation =
      'Run `pnpm nx run nestfolio-host:config --prefix=<prefix>` (e.g. --prefix=dev for local development).';
    let response: Response;
    try {
      response = await fetch('/assets/config.json');
    } catch (error) {
      throw new Error(
        `Runtime config not reachable at /assets/config.json: ${String(error)}. ${remediation}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Runtime config not found at /assets/config.json (HTTP ${response.status}). ${remediation}`,
      );
    }
    let parsed: RuntimeConfig;
    try {
      parsed = (await response.json()) as RuntimeConfig;
    } catch (error) {
      throw new Error(
        `Runtime config malformed at /assets/config.json: ${String(error)}. Re-run \`pnpm nx run nestfolio-host:config --prefix=<prefix>\`.`,
      );
    }
    validateEndpoints(parsed);
    runtimeConfig = parsed;
  };
}

function initializeAuth(): () => Promise<void> {
  const authStore = inject(AuthStore);
  return async () => {
    const user = await getAuthUser();
    if (user) {
      authStore.setAuthenticated({
        userId: user.userId,
        username: user.username,
        email: user.email ?? '',
        tenantId: user.tenantId ?? '',
        onboardingCompletedAt: user.onboardingCompletedAt ?? null,
      });
    } else {
      authStore.setUnauthenticated();
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideZonelessChangeDetection(),
    {
      provide: APP_INITIALIZER,
      useFactory: loadRuntimeConfig,
      multi: true,
    },
    {
      provide: AuthConfig,
      useFactory: () => getRuntimeConfig().auth,
    },
    {
      provide: COPILOT_API_URL,
      useFactory: () => getRuntimeConfig().copilotApiUrl,
    },
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads flags + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
  ],
};
```

Key changes from the previous version:

1. `import { environment } from '../environments/environment'` is removed.
2. `provideAuth(environment.auth)` becomes `provideAuth()` (no args).
3. `AuthConfig` is imported from `@nestfolio/shell/auth` and registered with `useFactory: () => getRuntimeConfig().auth`.
4. `getRuntimeConfig()` throws if `runtimeConfig` is null (no `?? environment` fallback).
5. `loadRuntimeConfig` is exported (was `function`-scoped) so the test can invoke it directly. It always fetches — no `environment.production` short-circuit. On any failure (network error, non-200, malformed JSON, validation), it throws with named remediation.
6. Provider order: `loadRuntimeConfig` APP_INITIALIZER is placed BEFORE the `AuthConfig` factory provider and BEFORE `provideAuth()`. Angular runs APP_INITIALIZERs in registration order, awaiting each — so by the time `provideAuth()`'s APP_INITIALIZER calls `inject(AuthConfig)` and the factory runs, `runtimeConfig` is populated.

- [ ] **Step 2: Verify the build still type-checks**

```bash
pnpm nx build nestfolio-host
```

Expected: build succeeds. (Existing tests will fail — they're updated in Task 7. Build itself must pass.)

If the build fails because `RuntimeConfigService` (in `apps/nestfolio-host/src/app/runtime-config.service.ts`) imports `getRuntimeConfig` and TypeScript can't widen the throw return path: confirm it still type-checks (the function returns `RuntimeConfig` post-narrow, identical to before).

- [ ] **Step 3: Commit (tests will follow in Task 7)**

```bash
git add apps/nestfolio-host/src/app/app.config.ts
git commit -m "$(cat <<'EOF'
feat(a4-runtime-config-and-auth-factory): rewrite app.config.ts to use AuthConfig + fail-hard loader

- loadRuntimeConfig is fail-hard: fetch always runs, no env short-circuit,
  no silent fallback. Throws with named remediation message on 404,
  malformed JSON, or validateEndpoints failure.
- provideAuth(environment.auth) → provideAuth() (no args) +
  {provide: AuthConfig, useFactory: () => getRuntimeConfig().auth}.
- environment.ts import removed.
- getRuntimeConfig() throws if runtimeConfig is null instead of
  silently returning environment placeholders.
- APP_INITIALIZER ordering: loadRuntimeConfig is registered before
  the AuthConfig provider and provideAuth(); Angular awaits
  initializers in order, so AuthConfig.useFactory runs after
  runtimeConfig is populated.

Test fallout fixed in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Test rewrites for `app.config.spec.ts` and `runtime-config.service.spec.ts`

**Files:**
- Modify: `apps/nestfolio-host/test/app/app.config.spec.ts`
- Modify: `apps/nestfolio-host/test/app/runtime-config.service.spec.ts`

- [ ] **Step 1: Run the existing specs to confirm fallout**

```bash
pnpm nx test nestfolio-host -- --testPathPattern=app.config
pnpm nx test nestfolio-host -- --testPathPattern=runtime-config.service
```

Expected: both fail. The current specs implicitly rely on `getRuntimeConfig()` returning `environment` when `runtimeConfig` is null. After Task 6, that path throws. We rewrite the specs now.

- [ ] **Step 2: Rewrite `app.config.spec.ts`**

Replace the entire content of `apps/nestfolio-host/test/app/app.config.spec.ts` with:

```typescript
// Mock modules that cause ESM issues in jest before any imports
jest.mock('@angular-architects/native-federation', () => ({
  loadRemoteModule: jest.fn(),
}));

jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
}));

// Mock isDevMode
let devMode = false;
const originalCore = jest.requireActual('@angular/core');
jest.mock('@angular/core', () => ({
  ...originalCore,
  isDevMode: () => devMode,
}));

import { validateEndpoints, RuntimeConfig, loadRuntimeConfig, getRuntimeConfig } from '../../src/app/app.config';

function makeConfig(overrides?: Partial<Record<'investorBff' | 'advisoryBff' | 'dashboardBff' | 'ledgerBff', { endpoint: string; region: string }>>): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    appsync: {
      investorBff: { endpoint: 'https://investor.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      advisoryBff: { endpoint: 'https://advisory.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      dashboardBff: { endpoint: 'https://dashboard.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      ledgerBff: { endpoint: 'https://ledger.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      ...overrides,
    },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
  };
}

describe('validateEndpoints', () => {
  beforeEach(() => {
    devMode = false;
  });

  it('should accept valid HTTPS endpoints', () => {
    expect(() => validateEndpoints(makeConfig())).not.toThrow();
  });

  it('should accept empty endpoint strings', () => {
    const config = makeConfig({
      investorBff: { endpoint: '', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).not.toThrow();
  });

  it('should reject HTTP endpoints in production', () => {
    const config = makeConfig({
      investorBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });

  it('should reject http://localhost in production', () => {
    const config = makeConfig({
      ledgerBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });

  it('should allow http://localhost in dev mode', () => {
    devMode = true;
    const config = makeConfig({
      ledgerBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).not.toThrow();
  });

  it('should still reject non-localhost HTTP in dev mode', () => {
    devMode = true;
    const config = makeConfig({
      advisoryBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });
});

describe('loadRuntimeConfig (fail-hard)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    devMode = false;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('populates runtimeConfig on a successful fetch', async () => {
    const cfg = makeConfig();
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cfg,
    } as unknown as Response);

    await loadRuntimeConfig()();
    expect(getRuntimeConfig()).toEqual(cfg);
  });

  it('throws with named remediation when fetch returns 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config not found.*nestfolio-host:config/,
    );
  });

  it('throws with named remediation when JSON is malformed', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('unexpected token'); },
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config malformed/,
    );
  });

  it('throws when validateEndpoints rejects', async () => {
    const bad = makeConfig({ investorBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' } });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => bad,
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow('Invalid endpoint URL');
  });

  it('throws on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config not reachable/,
    );
  });
});
```

Note on test isolation: `runtimeConfig` is a module-level `let`. The `loadRuntimeConfig (fail-hard)` block's "populates" test mutates it; subsequent tests in the file may see leakage. To mitigate, tests that need `runtimeConfig === null` (none in this spec, but future tests) would need a reset hook. For now, ordering is deliberate: validateEndpoints tests (pure) run first, then the loader tests run last. `getRuntimeConfig()` is only asserted in the populates test where the fetch has just succeeded.

- [ ] **Step 3: Rewrite `runtime-config.service.spec.ts`**

Replace the entire content of `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` with:

```typescript
// Mock modules that cause ESM issues in jest before any imports
jest.mock('@angular-architects/native-federation', () => ({
  loadRemoteModule: jest.fn(),
}));

jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../src/app/runtime-config.service';
import { loadRuntimeConfig, RuntimeConfig } from '../../src/app/app.config';

function makeConfig(): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    appsync: {
      investorBff: { endpoint: 'https://investor.example.com/graphql', region: 'us-east-1' },
      advisoryBff: { endpoint: 'https://advisory.example.com/graphql', region: 'us-east-1' },
      dashboardBff: { endpoint: 'https://dashboard.example.com/graphql', region: 'us-east-1' },
      ledgerBff: { endpoint: 'https://ledger.example.com/graphql', region: 'us-east-1' },
    },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
  };
}

describe('RuntimeConfigService (post-A4 fail-hard)', () => {
  const originalFetch = globalThis.fetch;
  let service: RuntimeConfigService;

  beforeAll(async () => {
    // Populate the module-level runtimeConfig before TestBed reads it.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeConfig(),
    } as unknown as Response);
    await loadRuntimeConfig()();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RuntimeConfigService);
  });

  it('reads the loaded runtime config (no environment fallback)', () => {
    const config = service.config;
    expect(config.auth).toEqual({ userPoolId: 'pool', clientId: 'client', region: 'us-east-1' });
    expect(config.appsync.investorBff.endpoint).toBe('https://investor.example.com/graphql');
    expect(config.appsync.advisoryBff.endpoint).toBe('https://advisory.example.com/graphql');
    expect(config.appsync.dashboardBff.endpoint).toBe('https://dashboard.example.com/graphql');
    expect(config.appsync.ledgerBff.endpoint).toBe('https://ledger.example.com/graphql');
    expect(config.copilotApiUrl).toBe('https://example.cloudfront.net/api/copilotkit');
  });

  it('exposes auth shortcut', () => {
    expect(service.auth).toEqual(service.config.auth);
  });

  it('exposes appsync shortcut', () => {
    expect(service.appsync).toEqual(service.config.appsync);
  });

  it('exposes copilotApiUrl shortcut', () => {
    expect(service.copilotApiUrl).toBe('https://example.cloudfront.net/api/copilotkit');
  });
});
```

The previous "should provide default config" tests are gone — they implicitly tested the silent-fallback path (`getRuntimeConfig() ?? environment`), which the charter forbids and Task 6 removed.

- [ ] **Step 4: Run all touched specs**

```bash
pnpm nx test nestfolio-host -- --testPathPattern='(app.config|runtime-config.service)'
```

Expected: PASS — all tests in both files succeed.

- [ ] **Step 5: Run the full nestfolio-host test suite to catch other fallout**

```bash
pnpm nx test nestfolio-host
```

Expected: PASS. If `provide-graphql.spec.ts` (or any other spec) breaks because it implicitly relied on the `environment` fallback, fix it the same way: populate `runtimeConfig` via `loadRuntimeConfig()` in a `beforeAll` with a mocked `fetch`. Do NOT introduce a parallel "default config" path.

- [ ] **Step 6: Commit**

```bash
git add apps/nestfolio-host/test/app/app.config.spec.ts \
        apps/nestfolio-host/test/app/runtime-config.service.spec.ts
git commit -m "$(cat <<'EOF'
test(a4-runtime-config-and-auth-factory): adapt specs to fail-hard runtime-config semantics

- app.config.spec.ts gains a loadRuntimeConfig (fail-hard) describe
  block: 404, malformed JSON, validateEndpoints failure, network
  error, and happy path.
- runtime-config.service.spec.ts now populates runtimeConfig via
  loadRuntimeConfig() in beforeAll instead of relying on the
  environment.ts fallback that was deleted in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Delete `environment.ts` files + checked-in `config.json` + `.gitignore`

**Files:**
- Delete: `apps/nestfolio-host/src/environments/environment.ts`
- Delete: `apps/nestfolio-host/src/environments/environment.prod.ts`
- Delete: `apps/nestfolio-host/src/environments/` (empty after the above)
- Delete: `apps/nestfolio-host/public/assets/config.json`
- Modify: `.gitignore`

- [ ] **Step 1: Verify no other importers**

```bash
git grep -nE "environments/environment" apps/ libs/
```

Expected: zero results (Task 6 dropped the only import). If anything is still listed, fix it before deleting — typically a service or component you didn't expect.

- [ ] **Step 2: Delete environment files**

```bash
git rm apps/nestfolio-host/src/environments/environment.ts \
       apps/nestfolio-host/src/environments/environment.prod.ts
rmdir apps/nestfolio-host/src/environments 2>/dev/null || true
```

The `rmdir` is best-effort: if any non-tracked file lingers (it shouldn't), the `rmdir` no-ops and that's fine — git won't track an empty dir.

- [ ] **Step 3: Delete the checked-in `config.json` placeholder**

```bash
git rm apps/nestfolio-host/public/assets/config.json
```

- [ ] **Step 4: Add the gitignore entry**

In `.gitignore`, immediately after the existing line `apps/nestfolio-host/src/index.html`, add:

```
apps/nestfolio-host/public/assets/config.json
```

- [ ] **Step 5: Verify nothing is broken**

```bash
pnpm nx build nestfolio-host
pnpm nx test nestfolio-host
pnpm nx test shell
```

Expected: all green. The build no longer references `environments/`, and the test suite already runs with mocked `fetch` (Task 7).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore(a4-runtime-config-and-auth-factory): delete environment.ts files + checked-in config.json placeholder

- Removes apps/nestfolio-host/src/environments/{environment.ts,
  environment.prod.ts}: Pillar 3 forbids resource literals, and
  Task 6 dropped the only import. The dev/prod boolean is sourced
  from Angular's isDevMode() (already used by validateEndpoints).
- Removes the checked-in apps/nestfolio-host/public/assets/config.json
  placeholder (had stale `portfolioBff` field and never matched
  reality). Replaced by gitignored producer output.
- .gitignore: apps/nestfolio-host/public/assets/config.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification — synth + lib + app

**Files:** none modified.

This task is verification only. It catches issues that per-task tests didn't surface — type checks across project boundaries, real CDK synth for investor-web, full Nx graph behavior.

- [ ] **Step 1: Full lib + app test pass**

```bash
pnpm nx run-many --target=test --projects=shell,nestfolio-host,investor-web
```

Expected: all green.

- [ ] **Step 2: Full lib + app build pass**

```bash
pnpm nx run-many --target=build --projects=shell,nestfolio-host
```

Expected: all green.

- [ ] **Step 3: Producer script test**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 4: cdk synth for investor-web**

```bash
pnpm nx run investor-web:synth --configuration=sandbox 2>/dev/null || \
  bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --synth-only 2>&1 | tail -20
```

Expected: synth succeeds. Spot-check the synthesized template includes the `auth/region` SSM parameter:

```bash
ls cdk.out/*investor-web*.template.json 2>/dev/null | head -1 | xargs -I{} grep -B1 -A3 'auth/region' {} | head -20
```

Expected: a `Name` line containing `/nestfolio/<prefix>-investor/auth/region`.

- [ ] **Step 5: (Optional) Live config-target run**

If AWS dev creds are available:

```bash
pnpm nx run nestfolio-host:config --prefix=dev
cat apps/nestfolio-host/public/assets/config.json | head -20
ls -la apps/nestfolio-host/public/assets/config.json
```

Expected: file written with real values, `git status` shows it as untracked-and-ignored. Skip if creds aren't available — script harness covers behavior.

- [ ] **Step 6: Memory note**

Append to `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md` an A4 ship entry following the format used for A1/A2/A3:

```markdown
## A4 — Runtime config producer + auth factory injection — SHIPPED 2026-04-25 on branch `feat/a4-runtime-config-and-auth-factory`

- New `scripts/fetch-runtime-config.sh` reads investor-subsystem SSM parameters
  (auth/userPoolId, auth/userPoolClientId, auth/region [NEW from this branch],
  web/distributionUrl, plus per-BFF api/graphqlUrl) and writes
  `apps/nestfolio-host/public/assets/config.json`. Fail-hard with
  named-path remediation; no silent fallback.
- New `nestfolio-host:config` Nx target wraps the script. Manual prereq —
  no `dependsOn` from `serve`/`esbuild`, charter §8 pipeline order is
  documented and enforced by convention.
- `apps/nestfolio-host/src/environments/{environment.ts,environment.prod.ts}`
  deleted. `getRuntimeConfig()` now throws if `runtimeConfig` is null
  instead of falling back to env placeholders. `apps/nestfolio-host/
  public/assets/config.json` is now gitignored (was checked-in placeholder
  with stale `portfolioBff` field).
- `libs/shell/src/auth/auth.config.ts`: `interface AuthConfig` flipped to
  `abstract class AuthConfig` (matches shape-frontends/libs/core/auth pattern).
  Consumers do `inject(AuthConfig)`.
- `libs/shell/src/auth/auth.provider.ts`: `provideAuth()` now no-args. Reads
  `inject(AuthConfig)` inside its APP_INITIALIZER. App registers
  `{provide: AuthConfig, useFactory: () => getRuntimeConfig().auth}` BEFORE
  `provideAuth()` so Angular's deferred APP_INITIALIZER chain picks up
  the loaded config.
- Charter sections realised: §5 row 5, §8, Pillar 3.
- B3 will adopt the same abstract-class flip for `AppSyncConfig` plus
  Apollo factory injection. `auth.service.ts` functions-module → Injectable
  refactor and store-colocation are deferred to a future shell-core
  alignment plan (see spec §3 non-goals + §9).
```

- [ ] **Step 7: Commit memory**

The memory directory is outside the repo; commit-by-save.

```bash
# (Memory file is at /Users/fabiovitali/.claude/projects/.../memory/...
#  — not under git in this workspace.)
```

No git step needed for the memory file. Just save the file.

- [ ] **Step 8: Optional final review commit (if any cleanup)**

```bash
git status
git log --oneline -10
```

Expected: clean working tree, the most recent ~7 commits are the A4 commits from Tasks 1-8.

---

## Recap of expected commit sequence

1. `feat(a4-runtime-config-and-auth-factory): publish auth/region SSM param from investor-web`
2. `refactor(a4-runtime-config-and-auth-factory): flip AuthConfig to abstract class as DI token`
3. `refactor(a4-runtime-config-and-auth-factory): provideAuth() becomes no-args, reads inject(AuthConfig)`
4. `feat(a4-runtime-config-and-auth-factory): runtime config producer (fetch-runtime-config.sh)`
5. `feat(a4-runtime-config-and-auth-factory): nestfolio-host:config Nx target`
6. `feat(a4-runtime-config-and-auth-factory): rewrite app.config.ts to use AuthConfig + fail-hard loader`
7. `test(a4-runtime-config-and-auth-factory): adapt specs to fail-hard runtime-config semantics`
8. `chore(a4-runtime-config-and-auth-factory): delete environment.ts files + checked-in config.json placeholder`

(Task 9 is verification + memory; produces no commit unless cleanup is needed.)
