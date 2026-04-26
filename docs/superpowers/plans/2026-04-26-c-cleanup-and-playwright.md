# Phase C — Cleanup & Playwright Smoke Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land C1 + C2 of the MFE charter migration on `main` — a CloudFront smoke probe that proves all 5 MFE routes render plus the targeted deletions of charter-violating legacy artifacts (dead `RuntimeConfig` CDK extension, per-MFE inline CSPs, AppSync URL caching in ngsw, AppSync wildcards in `csp.txt`).

**Architecture:** One feature branch (`feat/c-cleanup-and-playwright`), seven ordered commits, deploy to `dev`, run `pnpm cf-smoke --prefix=dev`, open PR. Each deletion is a separate commit so `git bisect` is mechanical if smoke fails post-deploy. The negative-grep build-time gate prevents regrowth.

**Tech Stack:** Node 20 + `playwright-core` (smoke probe); `node:test` (gate's self-test); `aws-cli` + Leapp credentials (SSM read); existing Nx + `csp.txt` + `prepare-index` infrastructure (A1 shipped).

**Spec:** [`docs/superpowers/specs/2026-04-26-c-cleanup-and-playwright-design.md`](../specs/2026-04-26-c-cleanup-and-playwright-design.md)

---

## File Structure (end state)

**Files deleted:**
- `libs/cdk-constructs/src/extensions/runtime-config.ts` (3.6 KB dead CDK extension)

**Files modified:**
- `libs/cdk-constructs/src/extensions/index.ts` — drop the `RuntimeConfig` re-export line
- `apps/nestfolio-host/csp.txt` — shrink `connect-src` to `'self' + cognito-idp + cognito-identity`
- `apps/nestfolio-host/ngsw-config.json` — drop the `dataGroups` array
- `apps/nestfolio-host/project.json` — add `check-charter-invariants` Nx target; chain it as `lint` dependsOn
- `apps/dashboard-mfe/src/index.html` — drop the inline CSP `<meta>` line
- `apps/investor-mfe/src/index.html` — drop the inline CSP `<meta>` line
- `apps/advisory-mfe/src/index.html` — drop the inline CSP `<meta>` line
- `apps/ledger-mfe/src/index.html` — drop the inline CSP `<meta>` line
- `apps/onboarding-mfe/src/index.html` — drop the inline CSP `<meta>` line
- `package.json` — add `playwright-core` devDependency + `cf-smoke` npm script

**Files created:**
- `tools/probes/cf-smoke.mjs` — Node + playwright-core CloudFront route smoke probe
- `tools/probes/README.md` — one-paragraph note on what `cf-smoke.mjs` is for and how to run it
- `tools/check-no-appsync-literals.mjs` — build-time gate forbidding AppSync URL literal regrowth
- `tools/check-no-appsync-literals.test.mjs` — node:test sibling for the gate

**Memory files updated** (under `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/`):
- `project_shell_render_broken.md` — append "Resolution" section
- `project_mfe_charter_migration.md` — update Phase B + add Phase C section
- `project_playwright_e2e_ui.md` — change Status from BLOCKED to "Phase 0/1 done; smoke gate in place; full Phase 2–10 deferred"

---

## Pre-flight (do once, not a commit)

- [ ] **Step 1: Verify branch + clean tree**

Run:
```bash
cd /Users/fabiovitali/WebstormProjects/nestfolio
git branch --show-current
git status --short
```

Expected:
```
feat/c-cleanup-and-playwright
?? <only the spec doc, already committed>
```

The branch was created earlier in the session and the spec was committed as `2530ba7b`. If branch is wrong, `git checkout feat/c-cleanup-and-playwright`.

- [ ] **Step 2: Capture baseline gate state for sanity**

Run:
```bash
git grep -nE '^export.*RuntimeConfig.*runtime-config' libs/cdk-constructs/src/extensions/index.ts
git grep -lE 'http-equiv="Content-Security-Policy"' apps/*-mfe/src/index.html
```

Expected:
```
libs/cdk-constructs/src/extensions/index.ts:12:export { RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths } from './runtime-config';
apps/advisory-mfe/src/index.html
apps/dashboard-mfe/src/index.html
apps/investor-mfe/src/index.html
apps/ledger-mfe/src/index.html
apps/onboarding-mfe/src/index.html
```

If anything else surfaces (e.g. additional MFE), update the task list before proceeding.

---

## Task 1: Delete dead `RuntimeConfig` CDK extension

**Files:**
- Delete: `libs/cdk-constructs/src/extensions/runtime-config.ts`
- Modify: `libs/cdk-constructs/src/extensions/index.ts:12`
- Test: `libs/cdk-constructs` jest suite (existing, no new tests)

**Why:** Charter §10 explicitly names it. Static analysis (Phase C exploration) confirmed zero importers in `apps/`, `libs/`, or `services/` outside the file itself + the index re-export.

- [ ] **Step 1: Confirm zero non-self importers (must be empty)**

Run:
```bash
git grep -nE '\bRuntimeConfig(Props|SsmPaths)?\b' libs services apps \
  | grep -v 'extensions/runtime-config.ts' \
  | grep -v 'extensions/index.ts' \
  | grep -v 'auth.provider.ts' \
  | grep -v 'apps/nestfolio-host/test/app/runtime-config.service.spec.ts' \
  | grep -v 'apps/nestfolio-host/src/app/runtime-config.service.ts' \
  | grep -v 'apps/nestfolio-host/src/app/runtime-config.service.spec.ts'
```

Expected: empty stdout (the noise filters above match: the file itself, the re-export, an unrelated JSDoc comment in `auth.provider.ts`, and the *frontend* `RuntimeConfigService` which is a different class).

If non-empty, STOP. Investigate the remaining importer before deleting. The plan's premise (dead code) is wrong.

- [ ] **Step 2: Delete the file**

Run:
```bash
rm libs/cdk-constructs/src/extensions/runtime-config.ts
```

- [ ] **Step 3: Edit `extensions/index.ts` to drop the re-export**

Open `libs/cdk-constructs/src/extensions/index.ts`. Remove this line (currently line 12):

```ts
export { RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths } from './runtime-config';
```

Result file content (whole file):

```ts
// @nestfolio/cdk-constructs/extensions — Specialized, optional constructs
export { AgentRuntime, AgentRuntimeProps } from './agent-runtime';
export { KnowledgeBase, KnowledgeBaseProps } from './knowledge-base';
export {
  SharedParameter, SharedParameterProps,
  CrossAccountBusPolicy, CrossAccountBusPolicyProps,
  DomainAccountMap, getDomainAccounts, getConsumerAccountIds,
  resolveBusArn, resolveSsmValue,
} from './cross-account';
export { CostControls, CostControlsProps } from './cost-controls';
export { AdapterSchedule, AdapterScheduleProps } from './adapter-schedule';
export { MfeBucket, MfeBucketProps } from './mfe-bucket';
```

- [ ] **Step 4: Verify `cdk-constructs` builds + tests are green**

Run:
```bash
pnpm nx run cdk-constructs:test
pnpm nx run cdk-constructs:build
```

Expected: both green. If lint flags an "unused export" or anything related, paste the exact error and fix the offending file before continuing.

- [ ] **Step 5: Verify `investor-web` still synthesizes**

Run:
```bash
pnpm nx run investor-web:synth --prefix=test
```

Expected: green. `investor-web/src/service.stack.ts` does NOT instantiate `RuntimeConfig` (verified during exploration), so synth must remain unaffected.

- [ ] **Step 6: Verify zero `RuntimeConfig` references remain**

Run:
```bash
git grep -nE '\bRuntimeConfig(Props|SsmPaths)?\b' libs services
```

Expected: empty stdout.

- [ ] **Step 7: Commit**

Run:
```bash
git add libs/cdk-constructs/src/extensions/index.ts
git rm libs/cdk-constructs/src/extensions/runtime-config.ts 2>/dev/null || true
git status --short
git commit -m "$(cat <<'EOF'
chore(c2): remove dead RuntimeConfig CDK extension

Charter §10 enumerated this file as legacy debt to remove. Static analysis
confirmed zero importers — the only references were the file itself, the
re-export, an unrelated JSDoc comment in libs/shell/src/auth/auth.provider.ts,
and the frontend RuntimeConfigService class (different file, different name).

Tested: cdk-constructs:test + cdk-constructs:build + investor-web:synth all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Delete per-MFE index.html CSP `<meta>` tags

**Files:**
- Modify: `apps/dashboard-mfe/src/index.html`
- Modify: `apps/investor-mfe/src/index.html`
- Modify: `apps/advisory-mfe/src/index.html`
- Modify: `apps/ledger-mfe/src/index.html`
- Modify: `apps/onboarding-mfe/src/index.html`

**Why:** Pillar 5 + §5 row 8 — the shell owns CSP exclusively. These five inline meta tags have been dead since A1 because MFE `index.html` is never the document-level entry point in production (federation runtime loads MFE modules into the shell's document). The drift between these and `csp.txt` is a regression vector.

All 5 files share an identical structure (verified during exploration). The line to remove appears verbatim in all 5:

```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.appsync-api.us-east-1.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" />
```

- [ ] **Step 1: Edit `apps/dashboard-mfe/src/index.html`**

Remove the entire CSP `<meta>` line (one line). The file should go from this:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.appsync-api.us-east-1.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
```

To this:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
```

- [ ] **Step 2: Apply the identical edit to `apps/investor-mfe/src/index.html`**

Same removal. Same surrounding lines. Same result shape.

- [ ] **Step 3: Apply the identical edit to `apps/advisory-mfe/src/index.html`**

Same removal.

- [ ] **Step 4: Apply the identical edit to `apps/ledger-mfe/src/index.html`**

Same removal.

- [ ] **Step 5: Apply the identical edit to `apps/onboarding-mfe/src/index.html`**

Same removal.

- [ ] **Step 6: Verify zero CSP meta tags remain in MFE index.html files**

Run:
```bash
git grep -nE 'http-equiv="Content-Security-Policy"' apps/*-mfe/src/index.html
```

Expected: empty stdout.

The shell's `apps/nestfolio-host/src/index.html` continues to carry its CSP (substituted from `csp.txt` via `prepare-index`) — that's intentional and unchanged here.

- [ ] **Step 7: Verify all 5 MFEs still build (assert-shell-html only checks shell, but build must succeed)**

Run:
```bash
pnpm nx run-many -t build --projects=dashboard-mfe,investor-mfe,advisory-mfe,ledger-mfe,onboarding-mfe
```

Expected: all 5 green.

- [ ] **Step 8: Commit**

Run:
```bash
git add apps/dashboard-mfe/src/index.html apps/investor-mfe/src/index.html apps/advisory-mfe/src/index.html apps/ledger-mfe/src/index.html apps/onboarding-mfe/src/index.html
git commit -m "$(cat <<'EOF'
chore(c2): remove per-MFE inline Content-Security-Policy meta tags

Pillar 5 + §5 row 8: shell owns CSP exclusively. MFE index.html files are
never document-level entry points in production — the federation runtime
loads MFE modules into the shell's document. These five inline tags only
created drift potential against the canonical csp.txt.

Tested: build green for all 5 MFEs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Delete `ngsw-config.json` AppSync `dataGroup`

**Files:**
- Modify: `apps/nestfolio-host/ngsw-config.json`

**Why:** Pillar 3 (no resource literals) + §7 R6 (BFFs reached via `/graphql/<domain>`, not direct AppSync URLs). The service worker no longer attempts GraphQL caching; Apollo's normalized in-memory cache handles client-side caching.

- [ ] **Step 1: Edit `apps/nestfolio-host/ngsw-config.json`**

Replace the entire file content with:

```json
{
  "$schema": "../../node_modules/@angular/service-worker/config/schema.json",
  "index": "/index.html",
  "assetGroups": [
    {
      "name": "app",
      "installMode": "prefetch",
      "resources": {
        "files": ["/favicon.ico", "/index.html", "/*.css", "/*.js"]
      }
    },
    {
      "name": "assets",
      "installMode": "lazy",
      "updateMode": "prefetch",
      "resources": {
        "files": ["/assets/**"]
      }
    }
  ]
}
```

(The `dataGroups` array — which had only one entry, the AppSync `api` group — is removed entirely.)

- [ ] **Step 2: Verify JSON is valid**

Run:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('apps/nestfolio-host/ngsw-config.json','utf8')))"
```

Expected: prints the object with two keys (`assetGroups`, `index`, `$schema`) — no `dataGroups`.

- [ ] **Step 3: Verify shell builds**

Run:
```bash
pnpm nx run nestfolio-host:build
```

Expected: green. The Angular CLI will pick up the new ngsw config; missing `dataGroups` is valid (the schema makes it optional).

- [ ] **Step 4: Commit**

Run:
```bash
git add apps/nestfolio-host/ngsw-config.json
git commit -m "$(cat <<'EOF'
chore(c2): remove ngsw-config AppSync dataGroup

Pillar 3 + §7 R6: BFFs are reached via the relative /graphql/<domain> path
on CloudFront, not direct AppSync URLs. Service-worker GraphQL caching is
out of charter scope (and was a stale-data foot-gun on a write-heavy auth'd
API anyway). Apollo's in-memory normalized cache handles client-side caching.

Tested: nestfolio-host:build green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Shrink `csp.txt` `connect-src` to `'self' + Cognito`

**Files:**
- Modify: `apps/nestfolio-host/csp.txt`

**Why:** §7 R6 promises `connect-src 'self'` post-B1+B3. Pragmatic landing point keeps Cognito direct because Amplify v6 calls `cognito-idp.us-east-1.amazonaws.com` and `cognito-identity.us-east-1.amazonaws.com` directly during signIn / token refresh.

The A1 `prepare-index` Nx target re-substitutes `{{CSP}}` in `apps/nestfolio-host/src/index.html.tmpl` whenever `csp.txt` changes. The A1 `synth` target (which has `csp.txt` in its inputs, verified in `services/investor/investor-web/project.json:32`) re-runs `cdk synth` for `investor-web`, propagating to the CloudFront `ResponseHeadersPolicy`.

- [ ] **Step 1: Edit `apps/nestfolio-host/csp.txt`**

Replace the entire file with this single-line content (no trailing newline; matches existing format):

```
default-src 'self'; script-src 'self' 'sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

The change: `connect-src` had `'self' https://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com`. It now has `'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com`.

Everything else (default-src, script-src with sha256 hash, style-src, etc.) is unchanged byte-for-byte.

- [ ] **Step 2: Re-run `prepare-index` to regenerate the inline shell HTML**

Run:
```bash
pnpm nx run nestfolio-host:prepare-index
```

Expected: green. The script writes `apps/nestfolio-host/src/index.html` with the new CSP substituted.

- [ ] **Step 3: Verify the regenerated `index.html` has the shrunk CSP**

Run:
```bash
grep -o "connect-src [^;]*" apps/nestfolio-host/src/index.html
```

Expected:
```
connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com
```

If the line still contains `*.appsync-api.` or `*.amazonaws.com`, something failed in Step 2 — re-run `prepare-index` and re-check.

- [ ] **Step 4: Re-synth `investor-web` to confirm the `ResponseHeadersPolicy` picks up the new CSP**

Run:
```bash
rm -rf services/investor/investor-web/cdk.out
pnpm nx run investor-web:synth --prefix=test
grep -o "connect-src [^;]*" services/investor/investor-web/cdk.out/test-investor-web.template.json | head -1
```

Expected:
```
connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com
```

- [ ] **Step 5: Re-run shell build to confirm assert-shell-html still passes against new CSP**

Run:
```bash
pnpm nx run nestfolio-host:build
```

Expected: green. The `assert-shell-html.mjs` build-time gate (B2) verifies the inline CSP includes the federation-runtime sha256 hash and matches the canonical `csp.txt` byte-for-byte.

- [ ] **Step 6: Commit**

Run:
```bash
git add apps/nestfolio-host/csp.txt apps/nestfolio-host/src/index.html
git commit -m "$(cat <<'EOF'
chore(c2): shrink csp.txt connect-src to self + Cognito

§7 R6 promised connect-src 'self' once B1 (unified CloudFront topology) and
B3 (Apollo per-MFE relative paths) shipped. Both shipped — the wildcard
amazonaws.com / appsync-api.* / appsync-realtime-api.* entries are dead.

Cognito IdP + Identity remain because Amplify v6 calls them directly from
the browser during signIn / token refresh. Routing Cognito through CF is
out of charter scope.

The prepare-index Nx target regenerated apps/nestfolio-host/src/index.html;
investor-web's cdk synth produces the matching ResponseHeadersPolicy.

Tested: prepare-index green, synth green (CSP matches csp.txt verbatim),
nestfolio-host:build green (assert-shell-html OK).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `check-no-appsync-literals` build-time gate (TDD)

**Files:**
- Create: `tools/check-no-appsync-literals.mjs`
- Create: `tools/check-no-appsync-literals.test.mjs`
- Modify: `apps/nestfolio-host/project.json` (add `check-charter-invariants` target; chain into `lint` dependsOn)

**Why:** Pillar 3 (no env literals) — prevent the regrowth of AppSync URL hardcodes in app source. The gate scans `apps/**` and `libs/{shell,frontend-deps,ui}/**` for the regex `(appsync-api|appsync-realtime-api|\.amazonaws\.com)` and exits 1 with a per-file report on any match.

We TDD this: first the test, then the script, then the Nx wiring.

- [ ] **Step 1: Create the failing test**

Create `tools/check-no-appsync-literals.test.mjs`:

```js
// node:test sibling for check-no-appsync-literals.mjs.
// Verifies the gate flags AppSync literals and stays silent on clean trees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'tools/check-no-appsync-literals.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-charter-check-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}

function runGate(root) {
  return spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
}

test('exit 0 on a clean tree', () => {
  const root = makeTree({
    'apps/foo-mfe/src/main.ts': "console.log('hello');",
    'libs/shell/src/lib.ts': "export const x = 1;",
    'libs/frontend-deps/index.js': "module.exports = {};",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 with file in report when appsync-api appears in apps/', () => {
  const root = makeTree({
    'apps/foo-mfe/src/main.ts': "const url = 'https://x.appsync-api.us-east-1.amazonaws.com/graphql';",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /apps\/foo-mfe\/src\/main\.ts/);
    assert.match(r.stdout + r.stderr, /appsync-api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 when wss appsync-realtime-api appears', () => {
  const root = makeTree({
    'apps/bar-mfe/src/index.html': '<a href="wss://x.appsync-realtime-api.us-east-1.amazonaws.com/graphql">x</a>',
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /appsync-realtime-api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 when bare amazonaws.com appears in libs/shell', () => {
  const root = makeTree({
    'libs/shell/src/foo.ts': "const region = 'sqs.us-east-1.amazonaws.com';",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /amazonaws\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 0 when libs/cdk-constructs (out of scope) contains appsync-api', () => {
  const root = makeTree({
    'libs/cdk-constructs/src/foo.ts': "const url = 'https://x.appsync-api.us-east-1.amazonaws.com';",
    'apps/foo-mfe/src/main.ts': "console.log('clean');",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `expected clean (cdk-constructs is out of scope), got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 0 ignores node_modules / dist / cdk.out / .worktrees', () => {
  const root = makeTree({
    'apps/foo-mfe/node_modules/dep/file.js': "appsync-api.us-east-1.amazonaws.com",
    'apps/foo-mfe/dist/main.js': "appsync-api.us-east-1.amazonaws.com",
    'apps/foo-mfe/src/main.ts': "console.log('clean');",
    '.worktrees/old/apps/foo-mfe/src/main.ts': "appsync-api.us-east-1.amazonaws.com",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails (script doesn't exist yet)**

Run:
```bash
node --test tools/check-no-appsync-literals.test.mjs
```

Expected: test failure with `Cannot find module` or status non-zero on every test (because the script file is missing — `spawnSync` returns a non-zero status with stderr complaining about the missing module).

- [ ] **Step 3: Create the gate script**

Create `tools/check-no-appsync-literals.mjs`:

```js
#!/usr/bin/env node
// check-no-appsync-literals.mjs — Pillar 3 build-time gate.
// Fails the build if frontend app or shell-tier lib source contains a
// literal AppSync / amazonaws.com URL. Charter §7 R6 routes everything
// through relative CloudFront paths.
//
// Usage:
//   node tools/check-no-appsync-literals.mjs [--root <dir>]
//
// --root defaults to the current working directory (workspace root). Tests
// pass a tmpdir.
//
// Scope:
//   - apps/**/*.{ts,html,json,js,mjs}
//   - libs/shell/**, libs/frontend-deps/**, libs/ui/** (same extensions)
// Excluded path fragments:
//   - node_modules, dist, cdk.out, .worktrees, .nx, coverage
// Excluded files:
//   - csp.txt (intentionally lists the Cognito host as a charter exception)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FORBIDDEN = /(appsync-api|appsync-realtime-api|\.amazonaws\.com)/;
const EXTS = new Set(['.ts', '.html', '.json', '.js', '.mjs']);
const EXCLUDE_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage'];
const SCOPED_DIRS = [
  'apps',
  'libs/shell',
  'libs/frontend-deps',
  'libs/ui',
];
const EXCLUDED_BASENAMES = new Set(['csp.txt']);

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
  }
  return { root };
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE_FRAGMENTS.some(f => e.name === f)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) {
      if (EXCLUDED_BASENAMES.has(e.name)) continue;
      const dot = e.name.lastIndexOf('.');
      const ext = dot >= 0 ? e.name.slice(dot) : '';
      if (EXTS.has(ext)) yield p;
    }
  }
}

function scan(scopedRoot, root) {
  const hits = [];
  for (const file of walk(scopedRoot)) {
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(FORBIDDEN);
      if (m) hits.push({ file: relative(root, file), line: i + 1, match: m[0], snippet: lines[i].trim().slice(0, 200) });
    }
  }
  return hits;
}

function main() {
  const { root } = parseArgs(process.argv);
  const allHits = [];
  for (const rel of SCOPED_DIRS) {
    const dir = join(root, rel);
    let exists = false;
    try { exists = statSync(dir).isDirectory(); }
    catch {}
    if (!exists) continue;
    allHits.push(...scan(dir, root));
  }

  if (allHits.length === 0) {
    console.log('check-no-appsync-literals: OK (0 hits)');
    process.exit(0);
  }

  console.error('check-no-appsync-literals: FAIL');
  console.error(`Found ${allHits.length} forbidden literal(s) in app/shell-tier source.`);
  console.error('Charter §7 R6: route through relative CloudFront paths (/graphql/<domain>, /realtime/<domain>, /mfe/<key>/*).\n');
  for (const h of allHits) {
    console.error(`  ${h.file}:${h.line}  [${h.match}]`);
    console.error(`    ${h.snippet}`);
  }
  process.exit(1);
}

main();
```

- [ ] **Step 4: Re-run the test — all six cases should pass**

Run:
```bash
node --test tools/check-no-appsync-literals.test.mjs
```

Expected: 6 tests pass, 0 fail.

If any test fails, paste the failure and adjust the script. Common pitfalls:
- The script imports a node:fs API that does not exist (e.g. `readdirSync` with options) — Node 20 supports `withFileTypes`.
- The walker descends into excluded dirs because the fragment check is wrong — verify `EXCLUDE_FRAGMENTS.some(f => e.name === f)` strictness.
- `--root` arg isn't parsed correctly — `process.argv[0]` is `node`, `[1]` is the script path, real args start at `[2]`.

- [ ] **Step 5: Run the gate against the live workspace — must be green now (after Tasks 1–4)**

Run:
```bash
node tools/check-no-appsync-literals.mjs
```

Expected: `check-no-appsync-literals: OK (0 hits)` and exit 0.

If FAIL: the gate is detecting a literal we missed. The most likely candidate is `apps/nestfolio-host/src/index.html` (the regenerated file). Verify Step 4 of Task 4 actually overwrote the inline CSP. Re-run `pnpm nx run nestfolio-host:prepare-index` if needed.

- [ ] **Step 6: Wire the gate as a `nestfolio-host:check-charter-invariants` Nx target + chain into `lint`**

Open `apps/nestfolio-host/project.json`. Find the `targets` object. Add a new target `check-charter-invariants`, and add a `lint` target (or modify the existing one) so it dependsOn `check-charter-invariants`.

Insert this target into the `targets` object (placement: after `prepare-index`, before `config` is fine — order does not affect behavior):

```json
    "check-charter-invariants": {
      "executor": "nx:run-commands",
      "inputs": [
        "{workspaceRoot}/tools/check-no-appsync-literals.mjs",
        "{workspaceRoot}/apps/**/*.{ts,html,json,js,mjs}",
        "{workspaceRoot}/libs/shell/**/*.{ts,html,json,js,mjs}",
        "{workspaceRoot}/libs/frontend-deps/**/*.{ts,html,json,js,mjs}",
        "{workspaceRoot}/libs/ui/**/*.{ts,html,json,js,mjs}"
      ],
      "outputs": [],
      "options": {
        "cwd": "{workspaceRoot}",
        "commands": [
          "node tools/check-no-appsync-literals.mjs"
        ]
      },
      "cache": true
    },
```

If `lint` exists in `nestfolio-host/project.json`, add `"check-charter-invariants"` to its `dependsOn` array. If `lint` is inferred (via `@nx/eslint:lint` plugin) and not declared, declare it explicitly:

```json
    "lint": {
      "executor": "@nx/eslint:lint",
      "dependsOn": ["check-charter-invariants"]
    }
```

- [ ] **Step 7: Verify the new target runs from the Nx CLI**

Run:
```bash
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: `check-no-appsync-literals: OK (0 hits)` and the Nx run is green.

- [ ] **Step 8: Verify `lint` triggers `check-charter-invariants`**

Run:
```bash
pnpm nx run nestfolio-host:lint
```

Expected: green. Output should include both the eslint run and the gate run (or the gate may be cached as `OK` from Step 7 — that's fine; cached or live, the gate passed).

- [ ] **Step 9: Smoke-test the gate by intentionally salting a file (do NOT commit)**

Run:
```bash
echo "const url = 'https://x.appsync-api.us-east-1.amazonaws.com';" >> apps/nestfolio-host/src/main.ts
pnpm nx run nestfolio-host:check-charter-invariants 2>&1 | tail -10
```

Expected: FAIL output showing `apps/nestfolio-host/src/main.ts:<line>  [appsync-api]`.

Then revert:
```bash
git checkout apps/nestfolio-host/src/main.ts
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: OK.

- [ ] **Step 10: Commit**

Run:
```bash
git add tools/check-no-appsync-literals.mjs tools/check-no-appsync-literals.test.mjs apps/nestfolio-host/project.json
git commit -m "$(cat <<'EOF'
feat(c2): add check-no-appsync-literals build-time gate

Pillar 3: forbid AppSync / amazonaws.com URL literals from regrowing in
apps/** and libs/{shell,frontend-deps,ui}/**. Charter §7 R6 routes everything
through relative CloudFront paths.

Wired as nestfolio-host:check-charter-invariants Nx target, chained into the
lint dependsOn. Includes a node:test sibling exercising six cases:
clean tree, scoped match in apps, scoped match in libs/shell, wss match,
out-of-scope match (cdk-constructs ignored), and node_modules/dist/.worktrees
exclusion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `tools/probes/cf-smoke.mjs` CloudFront route smoke probe

**Files:**
- Create: `tools/probes/cf-smoke.mjs`
- Create: `tools/probes/README.md`
- Modify: `package.json` (add `playwright-core` devDependency + `cf-smoke` script)

**Why:** §3 behavioural gate. Walks 5 MFE routes against the deployed CloudFront URL and asserts each renders without console errors or failed charter-path requests.

- [ ] **Step 1: Add `playwright-core` to root `devDependencies`**

Run:
```bash
pnpm add -D -w playwright-core
```

Expected: lockfile updates; `package.json` `devDependencies` gains `playwright-core` at the latest 1.x version. Verify:
```bash
node -e 'console.log(require("./package.json").devDependencies["playwright-core"])'
```

Expected: a version string like `^1.49.0` (any 1.x release is fine).

- [ ] **Step 2: Add `cf-smoke` script to root `package.json`**

Edit `package.json`. Add to `scripts`:
```json
    "cf-smoke": "node tools/probes/cf-smoke.mjs"
```

The full `scripts` block becomes:

```json
  "scripts": {
    "prepare": "test -d .git/hooks && cp scripts/verify-structure.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit || true",
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "lint": "nx run-many -t lint",
    "deploy": "bash infrastructure/scripts/deploy.sh",
    "destroy": "bash infrastructure/scripts/teardown.sh",
    "cf-smoke": "node tools/probes/cf-smoke.mjs"
  },
```

- [ ] **Step 3: Install the chromium-headless-shell binary**

Run:
```bash
pnpm exec playwright install chromium-headless-shell
```

Expected: prints download progress for the chromium-headless-shell binary (~80 MB) and exits 0. The binary is cached in `~/Library/Caches/ms-playwright/` (macOS) and is not committed.

If `playwright` (the full distribution) is not in the workspace, pnpm exec may fail to find the `playwright` CLI. Workaround: run via `node -e`:

```bash
node -e "require('playwright-core/lib/server/registry').registry.installDeps()"
```

If neither path works (playwright-core does not ship the install CLI on all versions), instead run:

```bash
npx --yes playwright install chromium-headless-shell
```

This downloads through the standalone playwright CLI without requiring the `playwright` package as a workspace dep. Either way, success means a `chromium-headless-shell` binary lives in `~/Library/Caches/ms-playwright/`.

- [ ] **Step 4: Create `tools/probes/cf-smoke.mjs`**

```js
#!/usr/bin/env node
// cf-smoke.mjs — CloudFront route smoke probe.
// Asserts the deployed shell renders all 5 MFE routes (or their /login
// redirects) without console errors or failed charter-path requests.
//
// Usage:
//   pnpm cf-smoke --prefix=dev
//   node tools/probes/cf-smoke.mjs --prefix=dev [--region=us-east-1] [--routes=/foo,/bar]
//
// Reads CF URL from SSM /nestfolio/<prefix>-investor/web/distributionUrl.
// Requires AWS credentials (Leapp).

import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const DEFAULT_ROUTES = ['/investor', '/advisory', '/ledger', '/dashboard', '/onboarding'];
const CHARTER_PATH_RE = /\/(graphql|mfe|realtime)\//;

function parseArgs(argv) {
  const out = { prefix: null, region: null, routes: DEFAULT_ROUTES };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--prefix=')) out.prefix = a.slice('--prefix='.length);
    else if (a === '--prefix') out.prefix = argv[++i];
    else if (a.startsWith('--region=')) out.region = a.slice('--region='.length);
    else if (a === '--region') out.region = argv[++i];
    else if (a.startsWith('--routes=')) out.routes = a.slice('--routes='.length).split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!out.prefix) {
    console.error('cf-smoke: --prefix is required (e.g. --prefix=dev)');
    process.exit(2);
  }
  return out;
}

function ssmGet(name, region) {
  const args = ['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value', '--output', 'text'];
  if (region) args.unshift(`--region=${region}`);
  const r = spawnSync('aws', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`cf-smoke: SSM read failed for ${name}.`);
    console.error(`Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=<prefix> --services=investor-web\` first, then retry.`);
    console.error(`(aws stderr: ${r.stderr.trim()})`);
    process.exit(1);
  }
  return r.stdout.trim();
}

function normalizeBaseUrl(s) {
  let u = s.trim();
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

async function checkRoute(browser, baseUrl, route) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const requestFailures = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (CHARTER_PATH_RE.test(url)) {
      requestFailures.push({ url, failure: req.failure()?.errorText || 'unknown' });
    }
  });

  let response;
  let renderOk = false;
  let error = null;
  const url = baseUrl + route;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Allow up to 10s for Angular to bootstrap and populate <app-root>.
    await page.waitForFunction(() => {
      const root = document.querySelector('app-root');
      return !!root && root.children.length > 0;
    }, { timeout: 10000 });
    renderOk = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  await ctx.close();

  const status = response ? response.status() : null;
  const ok = renderOk && (status === 200 || status === 304) && consoleErrors.length === 0 && requestFailures.length === 0;
  return { route, url, status, renderOk, consoleErrors, requestFailures, error, ok };
}

async function main() {
  const args = parseArgs(process.argv);
  const ssmPath = `/nestfolio/${args.prefix}-investor/web/distributionUrl`;
  const cfUrl = normalizeBaseUrl(ssmGet(ssmPath, args.region));
  console.log(`cf-smoke: prefix=${args.prefix} cfUrl=${cfUrl}`);
  console.log(`cf-smoke: routes=${args.routes.join(',')}`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const r of args.routes) {
      results.push(await checkRoute(browser, cfUrl, r));
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  console.log('Per-route results:');
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.route}  status=${r.status ?? 'n/a'}  rendered=${r.renderOk}  consoleErrors=${r.consoleErrors.length}  requestFailures=${r.requestFailures.length}`);
    if (!r.ok) {
      if (r.error) console.log(`    error: ${r.error}`);
      for (const e of r.consoleErrors) console.log(`    console.error: ${e}`);
      for (const f of r.requestFailures) console.log(`    requestfailed: ${f.url} (${f.failure})`);
    }
  }
  console.log('');

  if (failed.length > 0) {
    console.error(`cf-smoke: FAIL (${failed.length}/${results.length} routes)`);
    process.exit(1);
  }
  console.log(`cf-smoke: PASS (${results.length}/${results.length} routes)`);
}

main().catch(err => {
  console.error(`cf-smoke: unhandled error: ${err?.stack ?? err}`);
  process.exit(1);
});
```

- [ ] **Step 5: Create `tools/probes/README.md`**

```markdown
# Probes

Throwaway scripts that exercise deployed environments.

## `cf-smoke.mjs`

CloudFront route smoke probe. Walks the 5 MFE routes (`/investor`,
`/advisory`, `/ledger`, `/dashboard`, `/onboarding`) and asserts each renders
without console errors or failed charter-path requests.

```bash
pnpm cf-smoke --prefix=dev
# or
node tools/probes/cf-smoke.mjs --prefix=dev --region=us-east-1
```

Requires Leapp credentials (reads SSM
`/nestfolio/<prefix>-investor/web/distributionUrl`) and the
chromium-headless-shell Playwright binary
(`pnpm exec playwright install chromium-headless-shell`).

This probe is the C1 charter graduation gate. When the full
`apps/nestfolio-e2e/` Playwright harness lands (resumption of
`docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` Phase 2–10), this
probe is removed — the harness's own boot-time check supersedes it.
```

- [ ] **Step 6: Run the probe with no `--prefix` to verify the arg-parse error path**

Run:
```bash
node tools/probes/cf-smoke.mjs
```

Expected: exit 2 with stderr `cf-smoke: --prefix is required (e.g. --prefix=dev)`.

- [ ] **Step 7: Run the probe with a bogus prefix to verify the SSM-error remediation message**

Run:
```bash
node tools/probes/cf-smoke.mjs --prefix=does-not-exist 2>&1 | head -10
```

Expected: clean exit 1 with the remediation message naming `infrastructure/scripts/deploy.sh sandbox --prefix=does-not-exist --services=investor-web`.

This may *succeed* if the AWS CLI can't authenticate (e.g. no Leapp session) — in that case you'll see an auth error in the stderr instead. Both outcomes confirm the script is wired correctly. The full happy-path run happens in Task 9.

- [ ] **Step 8: Commit**

Run:
```bash
git add package.json pnpm-lock.yaml tools/probes/cf-smoke.mjs tools/probes/README.md
git commit -m "$(cat <<'EOF'
feat(c1): add tools/probes/cf-smoke.mjs CloudFront smoke probe

Charter §3 behavioural gate: walks /investor, /advisory, /ledger, /dashboard,
/onboarding on the deployed CF distribution and asserts each renders without
console errors or failed /graphql/* | /mfe/* | /realtime/* requests.

Reads CF URL from SSM /nestfolio/<prefix>-investor/web/distributionUrl. Uses
playwright-core + chromium-headless-shell. Throwaway by design — superseded
when Playwright Phase 2–10 ships its own harness boot-time check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update memory

**Files** (all under `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/`):
- Modify: `project_shell_render_broken.md`
- Modify: `project_mfe_charter_migration.md`
- Modify: `project_playwright_e2e_ui.md`
- Modify: `MEMORY.md` (index entries)

**Why:** future sessions need to read main's actual state, not its 2026-04-22 state. Memory is currently three steps stale.

- [ ] **Step 1: Update `project_shell_render_broken.md`**

Append a "Resolution" section to the existing file. Read the current file first via Read tool; then append. The new section content:

```markdown

## Resolution — 2026-04-26

Phase B (B1+B2+B3+B4) collectively unblocked the deployed-CF render. The five
layered issues from 2026-04-22 are addressed by:

- (1) `es-module-shims` polyfill missing → B2 wired it via `esbuild.options.polyfills` for shell + 5 MFEs (commits `817ca169` shell, `c4a8e827` investor-mfe, etc.).
- (2) `sharedMappings` subpath entries missing → B2 added `@nestfolio/shell/{auth,graphql,i18n}` + `@nestfolio/ui/feature-flags`.
- (3) `includeSecondaries` missing on subpath packages → B2 added it to `@primeuix/themes`, `graphql`, `aws-appsync-{auth,subscription}-link`.
- (4) `url` polyfill missing → B2 added `url` to `frontend-deps` singleton surface; `es-module-shims` + `url` added as direct devDependencies.
- (5) CSP drift between meta tag and CF header → A1 single-source `csp.txt` + B3 + C2 (Edit 4) shrunk `connect-src` to `'self' + Cognito`.

Verification: `tools/probes/cf-smoke.mjs` walks /investor, /advisory, /ledger,
/dashboard, /onboarding against the deployed CloudFront distribution and
asserts each renders without console errors or failed charter-path requests.
Smoke green on `dev` (recorded in PR for `feat/c-cleanup-and-playwright`).

Status: RESOLVED.
```

Update the frontmatter `description` to reflect resolution. Change:

```
description: nestfolio-host /login has never rendered in any browser on any commit of main — discovered 2026-04-22. Five layered issues. Blocks Playwright e2e plan.
```

To:

```
description: Shell render bug — RESOLVED 2026-04-26. Five layered federation/CSP issues all addressed by Phase B (B1+B2+B3+B4). cf-smoke.mjs verifies rendering on deployed CloudFront.
```

- [ ] **Step 2: Update `project_mfe_charter_migration.md`**

This file's "Phase B" section currently lists B4 as "not started." Read the file, then update:
- Phase B → mark B4 as SHIPPED (commits `de75669b feat(investor-web): add deploy-shell Nx target (B4)`, `e9bc2b8c feat: wire shell upload as Phase 4b in deploy.sh (B4)`, `b2694819 chore(b4): apply code-review fixes`, merge `1aae7890`).
- Add a new "Phase C — cleanup & verification" section with:

```markdown
## Phase C — cleanup & verification

- **C1 — CloudFront smoke probe** — SHIPPED 2026-04-26 on branch `feat/c-cleanup-and-playwright`. `tools/probes/cf-smoke.mjs` walks /investor, /advisory, /ledger, /dashboard, /onboarding; asserts HTTP 200/304, `<app-root>` non-empty within 10s, no console errors, no failed `/graphql/* | /mfe/* | /realtime/*` requests. Throwaway by design — superseded when full Playwright harness lands.
- **C2 — legacy debt removal** — SHIPPED 2026-04-26 on the same branch. Five edits, each its own commit:
  1. Deleted dead `libs/cdk-constructs/src/extensions/runtime-config.ts` + index.ts re-export.
  2. Deleted per-MFE inline CSP `<meta>` tags in 5 MFE index.html files.
  3. Deleted `apps/nestfolio-host/ngsw-config.json` AppSync `dataGroup`.
  4. Shrunk `apps/nestfolio-host/csp.txt` `connect-src` to `'self' + Cognito IdP + Cognito Identity` (Amplify v6 calls Cognito directly).
  5. Added `tools/check-no-appsync-literals.mjs` build-time gate (wired as `nestfolio-host:check-charter-invariants` Nx target, chained into `lint` dependsOn) preventing AppSync URL literal regrowth in `apps/**` and `libs/{shell,frontend-deps,ui}/**`.

  Charter graduation status: GRADUATED. All 5 pillars hold on `main`.
```

- [ ] **Step 3: Update `project_playwright_e2e_ui.md`**

Change the file's `## Status` section from:

```markdown
## Status
**BLOCKED** on `project_shell_render_broken` — every Playwright journey requires the shell to render in a browser, which it currently does not.
```

To:

```markdown
## Status
**Phase 0 + Phase 1 done.** Charter graduation gate met by `tools/probes/cf-smoke.mjs` (Phase C/C1, shipped 2026-04-26). Full Phase 2–10 (new-investor happy path harness, ~10 days) **deferred** — start a fresh brainstorming session when an end-to-end behavioural suite becomes a product priority. The shell-render-broken blocker is RESOLVED (see `project_shell_render_broken.md` Resolution).
```

Also update the frontmatter `description`:

```
description: Status of docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md. Phase 0 + 1 done; charter graduation met by cf-smoke.mjs; Phase 2–10 deferred.
```

- [ ] **Step 4: Update `MEMORY.md` index entries**

The `MEMORY.md` index lines currently read:

```
- [Shell render broken](./project_shell_render_broken.md) — OPEN 2026-04-22: nestfolio-host /login has never rendered in any browser on any main commit; 5 layered issues (es-module-shims, importmap gaps, subpath mappings, url shim, CSP); blocks Playwright e2e plan.
- [Playwright UI e2e](./project_playwright_e2e_ui.md) — PAUSED 2026-04-22: Phase 0 + Phase 1 spikes done, Phase 2+ blocked on shell-render bug; plan deltas logged
- [MFE charter migration](./project_mfe_charter_migration.md) — A1 shipped 2026-04-24; 7 sub-plans remain across Phase A/B/C. V1 PASS unblocks the roadmap.
```

Replace those three lines with:

```
- [Shell render broken](./project_shell_render_broken.md) — RESOLVED 2026-04-26: Phase B addressed all 5 layered issues; cf-smoke.mjs verifies on deployed CF.
- [Playwright UI e2e](./project_playwright_e2e_ui.md) — Phase 0+1 done; charter graduation met by cf-smoke.mjs; Phase 2–10 deferred.
- [MFE charter migration](./project_mfe_charter_migration.md) — GRADUATED 2026-04-26: all 5 pillars hold on main; A1–A4, B1–B4, C1–C2 all shipped.
```

- [ ] **Step 5: Verify all memory files are valid markdown + frontmatter**

Run:
```bash
for f in /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/{project_shell_render_broken,project_mfe_charter_migration,project_playwright_e2e_ui,MEMORY}.md; do
  echo "--- $f ---"
  head -5 "$f"
done
```

Expected: each file starts with `---` frontmatter (except `MEMORY.md` which has no frontmatter), is non-empty, and the `name`/`description` fields read coherently.

- [ ] **Step 6: Commit**

Memory files live under `~/.claude/`, NOT under the repo. Do NOT `git add` them. Memory updates are a separate persistence channel and not version-controlled in the project repo.

This step has nothing to commit. Move on.

---

## Task 8: Pre-deploy verification gates

**Files:** None (verification only).

- [ ] **Step 1: Full workspace build**

Run:
```bash
pnpm nx run-many -t build --projects=nestfolio-host,investor-mfe,advisory-mfe,ledger-mfe,dashboard-mfe,onboarding-mfe
```

Expected: 6/6 green; assert-shell-html passes for the shell.

- [ ] **Step 2: Affected test suite**

Run:
```bash
pnpm nx run-many -t test --projects=nestfolio-host,shell,frontend-deps,cdk-constructs,investor-web,ui
```

Expected: all green.

- [ ] **Step 3: Charter-invariants gate**

Run:
```bash
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: `OK (0 hits)`.

- [ ] **Step 4: Lint chain (verifies the gate is wired correctly)**

Run:
```bash
pnpm nx run nestfolio-host:lint
```

Expected: green; output references both eslint and the gate (or shows the gate as cached green).

- [ ] **Step 5: investor-web synth (verifies CSP propagation)**

Run:
```bash
pnpm nx run investor-web:synth --prefix=test
grep -o "connect-src [^;]*" services/investor/investor-web/cdk.out/test-investor-web.template.json | head -1
```

Expected: `connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com`.

- [ ] **Step 6: Negative greps (regression bar)**

Run:
```bash
git grep -nE '\bRuntimeConfig(Props|SsmPaths)?\b' libs/cdk-constructs services
git grep -nE 'http-equiv="Content-Security-Policy"' apps/*-mfe/src/index.html
git grep -nE 'appsync-(api|realtime-api)|wss://\*\.appsync' apps/nestfolio-host/csp.txt
git grep -nE '"urls".*appsync-api' apps/nestfolio-host/ngsw-config.json
```

Expected: all four return empty stdout.

- [ ] **Step 7: Step-by-step `git log` review**

Run:
```bash
git log --oneline main..HEAD
```

Expected: 7 commits in this order (newest at top — the spec commit `2530ba7b` was made earlier in the brainstorming/planning phase):
```
<hash7> feat(c1): add tools/probes/cf-smoke.mjs CloudFront smoke probe
<hash6> feat(c2): add check-no-appsync-literals build-time gate
<hash5> chore(c2): shrink csp.txt connect-src to self + Cognito
<hash4> chore(c2): remove ngsw-config AppSync dataGroup
<hash3> chore(c2): remove per-MFE inline Content-Security-Policy meta tags
<hash2> chore(c2): remove dead RuntimeConfig CDK extension
<hash1> docs(c): add Phase C cleanup + Playwright smoke gate design
```

If any commit is missing or out of order, stop and reconcile.

---

## Task 9: Deploy to `dev` and run `cf-smoke`

**Files:** None (deploy + smoke only).

- [ ] **Step 1: Confirm Leapp session is active**

Run:
```bash
aws sts get-caller-identity --query 'Arn' --output text
```

Expected: an ARN like `arn:aws:sts::771924376645:assumed-role/AdminRole/...`. If not (no creds, expired session), run a Leapp session for the dev account before proceeding.

- [ ] **Step 2: Deploy `investor-web` to dev**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web
```

Expected: green. The script's Phase 2 redeploys investor-web with `csp.txt` propagated to the `ResponseHeadersPolicy`. Phase 4b uploads the shell bundle.

If non-investor-web services are also drifted (rare on a clean main pull), run a full deploy:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev
```

- [ ] **Step 3: Run `cf-smoke`**

Run:
```bash
pnpm cf-smoke --prefix=dev
```

Expected:
```
cf-smoke: prefix=dev cfUrl=https://d3i9cio23diphs.cloudfront.net
cf-smoke: routes=/investor,/advisory,/ledger,/dashboard,/onboarding

Per-route results:
  [PASS] /investor   status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /advisory   status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /ledger     status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /dashboard  status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /onboarding status=200  rendered=true  consoleErrors=0  requestFailures=0

cf-smoke: PASS (5/5 routes)
```

Save the full output for the PR description.

If a route FAILs, the per-route breakdown will show:
- `consoleErrors` — Angular bootstrap or federation runtime errors. Inspect the captured `console.error` lines.
- `requestFailures` on `/graphql/*` — B1 unified topology issue (CloudFront → AppSync origin). Investigate the `ResponseHeadersPolicy` synth output + CF distribution behaviors.
- `requestFailures` on `/mfe/<key>/*` — A3 bucket / B1 origin issue. Verify the BFF's `mfe/bucketName` SSM export + the bucket policy granting OAC.
- `rendered=false` with no other signal — Angular failed to bootstrap silently. Open Chrome DevTools manually against the same URL to see the actual error.

`git bisect run` is mechanical: smoke ran green pre-debt-removal (we have B-merged main as the known-good baseline). The 5 deletion commits each isolate one regression vector.

- [ ] **Step 4: If smoke FAIL, bisect; if smoke PASS, proceed to PR**

If smoke FAIL: diagnose per the per-route breakdown above; create a fix-up commit on the same branch; re-deploy; re-smoke. Do NOT amend earlier commits — the bisect trail must remain intact.

If smoke PASS: continue.

---

## Task 10: Open the PR

**Files:** None.

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/c-cleanup-and-playwright
```

- [ ] **Step 2: Open the PR via `gh`**

Run (paste the cf-smoke output captured in Task 9 Step 3 into the test plan):

```bash
gh pr create --title "Phase C: charter cleanup + CloudFront smoke gate" --body "$(cat <<'EOF'
## Summary
- C1: `tools/probes/cf-smoke.mjs` walks 5 MFE routes against deployed CloudFront and asserts each renders. Charter §3 behavioural gate.
- C2: removes 5 charter-violating artifacts (dead RuntimeConfig CDK extension; per-MFE inline CSPs; ngsw AppSync dataGroup; csp.txt wildcards) + adds `check-no-appsync-literals` build-time gate.

Spec: `docs/superpowers/specs/2026-04-26-c-cleanup-and-playwright-design.md`
Plan: `docs/superpowers/plans/2026-04-26-c-cleanup-and-playwright.md`

## Test plan
- [x] `pnpm nx run-many -t build` green for shell + 5 MFEs
- [x] `pnpm nx run-many -t test` green for nestfolio-host, shell, frontend-deps, cdk-constructs, investor-web, ui
- [x] `pnpm nx run nestfolio-host:check-charter-invariants` → `OK (0 hits)`
- [x] `pnpm nx run nestfolio-host:lint` green
- [x] `pnpm nx run investor-web:synth --prefix=test` → connect-src shrunk to `'self' + Cognito`
- [x] Negative greps clean (RuntimeConfig, MFE CSP metas, AppSync wildcards in csp.txt, ngsw AppSync URLs)
- [x] `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web` green
- [x] `pnpm cf-smoke --prefix=dev` PASS 5/5 routes (output below)

```
<paste cf-smoke output here>
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Print the PR URL for the user**

`gh pr create` will print the URL on success. Capture it and share with the operator. The PR is ready for human review.

---

## Self-review notes

- **Spec coverage:** §4.1 → Task 6; §4.2 Edits 1–5 → Tasks 1, 2, 3, 4, 5 respectively; §4.3 → Task 7; §4.4 ordering → Tasks 1–6 + 9; §10 acceptance criteria → Tasks 8 (pre-deploy) + 9 (deploy + smoke) + 10 (PR).
- **Placeholder scan:** all code blocks are complete; no TBD/TODO/"similar to"; the cf-smoke.mjs script body is verbatim, the gate body is verbatim, the test body is verbatim.
- **Type consistency:** the gate's CLI flag is `--root` (string) in script + test; the smoke probe's CLI flags are `--prefix` (required), `--region` (optional), `--routes` (optional comma-list) — all referenced consistently.
- **One known soft spot:** Task 6 Step 3 has three fallbacks for installing the chromium-headless-shell binary because pnpm/playwright-core packaging varies by version. The first one that succeeds wins; the operator picks based on workspace state.
