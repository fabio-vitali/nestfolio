# A1 — CSP single-source of truth (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `apps/nestfolio-host/csp.txt` as the single canonical source of the Content-Security-Policy string; wire the shell's `index.html` build-time substitution AND `investor-web`'s CDK `ResponseHeadersPolicy` both to read it.

**Architecture:** Tracked template `src/index.html.tmpl` contains a `{{CSP}}` placeholder. A Node script `scripts/emit-index-html.mjs` (stdlib only) substitutes the placeholder from `csp.txt` into a gitignored `src/index.html` before `esbuild` runs. The CDK stack `readFileSync`s the same `csp.txt` at synth time. `nx affected` picks up `csp.txt` changes on both sides via the shell's `prepare-index` target inputs and investor-web's `synth` target inputs.

**Tech Stack:** Node.js stdlib (`fs`, `path`), Nx `run-commands` executor, Angular Native Federation 21.2.x, AWS CDK.

**Spec:** [`docs/superpowers/specs/2026-04-24-a1-csp-single-source-design.md`](../specs/2026-04-24-a1-csp-single-source-design.md)
**Parent charter:** [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](../specs/2026-04-24-mfe-architecture-charter.md) — Pillar 5, §5 row 8
**Parent roadmap:** [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](./2026-04-24-mfe-charter-migration-roadmap.md) — item A1

---

## File structure

**New files:**
- `apps/nestfolio-host/csp.txt` — canonical CSP string (one line, no trailing newline, no trailing `;`).
- `apps/nestfolio-host/src/index.html.tmpl` — tracked template with `{{CSP}}` placeholder.
- `scripts/emit-index-html.mjs` — Node stdlib template-substitution tool.
- `scripts/emit-index-html.test.mjs` — unit tests for the emit script (uses `node:test`).

**Modified files:**
- `apps/nestfolio-host/src/index.html` — renamed (via delete + create tmpl), now gitignored.
- `apps/nestfolio-host/project.json` — new `prepare-index` target, `esbuild` gains `dependsOn`.
- `services/investor/investor-web/src/service.stack.ts` — line 103 replaced with `readFileSync` of `csp.txt`.
- `services/investor/investor-web/project.json` — new `synth` Nx target with `{workspaceRoot}/apps/nestfolio-host/csp.txt` in `inputs` (investor-web has no `synth` today — only `deploy`/`destroy`/`test`/`lint`).
- `.gitignore` — adds `apps/nestfolio-host/src/index.html`.

---

## Task 1: Create `apps/nestfolio-host/csp.txt`

**Files:**
- Create: `apps/nestfolio-host/csp.txt`

- [ ] **Step 1: Write the file**

Content (single line, exactly as shown, no trailing newline):

```
default-src 'self'; script-src 'self' 'sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Use `printf '%s' '<content>' > apps/nestfolio-host/csp.txt` to avoid a trailing newline.

- [ ] **Step 2: Verify no trailing newline**

Run: `wc -c apps/nestfolio-host/csp.txt && tail -c 1 apps/nestfolio-host/csp.txt | xxd`
Expected: character count matches string length; the last byte is not `0a` (newline).

- [ ] **Step 3: Verify the sha256 hash in the file matches the deterministic NF esms-options body**

Run: `printf '%s' '{"shimMode":true}' | openssl dgst -sha256 -binary | openssl base64`
Expected output: `NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=`
Cross-check: `grep -o 'sha256-[A-Za-z0-9+/=]*' apps/nestfolio-host/csp.txt` must print `sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=`.

- [ ] **Step 4: Commit**

```bash
git add apps/nestfolio-host/csp.txt
git commit -m "feat(a1-csp): add canonical csp.txt"
```

---

## Task 2: Write the `emit-index-html.mjs` tests (TDD — red)

**Files:**
- Create: `scripts/emit-index-html.test.mjs`

- [ ] **Step 1: Write the test file**

Create `scripts/emit-index-html.test.mjs` with this exact content:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./emit-index-html.mjs', import.meta.url).pathname;

function runEmit(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'emit-index-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('substitutes {{CSP}} placeholder with csp.txt contents (trimmed)', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />\n<body></body>');
    writeFileSync(csp, "default-src 'self'\n");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const emitted = readFileSync(out, 'utf-8');
    assert.match(emitted, /<meta content="default-src 'self'" \/>/);
    assert.ok(!emitted.includes('{{CSP}}'));
  });
});

test('emits a "DO NOT EDIT" comment as the second line of output', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<!doctype html>\n<html><head><meta content="{{CSP}}" /></head></html>');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const lines = readFileSync(out, 'utf-8').split('\n');
    assert.equal(lines[0], '<!doctype html>');
    assert.match(lines[1], /<!-- Generated from index.html.tmpl \+ csp\.txt\. DO NOT EDIT\. -->/);
  });
});

test('fails with exit 1 when template is missing', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'nope.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /template/i);
  });
});

test('fails with exit 1 when csp file is missing', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'nope.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /csp/i);
  });
});

test('fails with exit 1 when csp file is empty', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');
    writeFileSync(csp, '  \n  ');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty/i);
  });
});

test('fails with exit 1 when {{CSP}} placeholder is absent', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="no placeholder here" />');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /placeholder/i);
  });
});

test('fails with exit 1 when {{CSP}} placeholder appears more than once', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" /><meta content="{{CSP}}" />');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /placeholder/i);
  });
});

test('fails with exit 1 when invoked with wrong number of arguments', () => {
  const result = runEmit(['only-one']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage/i);
});

test('writes atomically via temp file + rename', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');
    writeFileSync(csp, "default-src 'self'");
    writeFileSync(out, 'OLD CONTENT');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const emitted = readFileSync(out, 'utf-8');
    assert.ok(!emitted.includes('OLD CONTENT'));
    assert.match(emitted, /<meta content="default-src 'self'" \/>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/emit-index-html.test.mjs`
Expected: FAIL — script does not exist yet. Error like `Cannot find module '.../scripts/emit-index-html.mjs'` or all tests fail with `status: null` / non-zero (spawn of nonexistent file).

---

## Task 3: Implement `emit-index-html.mjs` (TDD — green)

**Files:**
- Create: `scripts/emit-index-html.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/emit-index-html.mjs` with this exact content:

```javascript
#!/usr/bin/env node
// Emits apps/nestfolio-host/src/index.html from a template + csp.txt.
// Fails hard on any input problem so misconfiguration cannot silently ship.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';

function fail(msg) {
  stderr.write(`emit-index-html: ${msg}\n`);
  exit(1);
}

const [, , templatePath, cspPath, outputPath] = argv;

if (!templatePath || !cspPath || !outputPath) {
  fail('usage: emit-index-html.mjs <template> <csp-file> <output>');
}

if (!existsSync(templatePath)) fail(`template not found: ${templatePath}`);
if (!existsSync(cspPath)) fail(`csp file not found: ${cspPath}`);

const template = readFileSync(templatePath, 'utf-8');
const csp = readFileSync(cspPath, 'utf-8').trim();

if (csp.length === 0) fail(`csp file is empty: ${cspPath}`);

const placeholderCount = (template.match(/\{\{CSP\}\}/g) ?? []).length;
if (placeholderCount === 0) fail(`placeholder {{CSP}} missing in template: ${templatePath}`);
if (placeholderCount > 1) {
  fail(`placeholder {{CSP}} appears ${placeholderCount} times in template (expected 1): ${templatePath}`);
}

const substituted = template.replace('{{CSP}}', csp);

const lines = substituted.split('\n');
const banner = '    <!-- Generated from index.html.tmpl + csp.txt. DO NOT EDIT. -->';
const withBanner = [lines[0], banner, ...lines.slice(1)].join('\n');

const tmp = `${outputPath}.tmp`;
writeFileSync(tmp, withBanner, 'utf-8');
renameSync(tmp, outputPath);
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test scripts/emit-index-html.test.mjs`
Expected: PASS — all 9 tests green.

- [ ] **Step 3: Commit**

```bash
git add scripts/emit-index-html.mjs scripts/emit-index-html.test.mjs
git commit -m "feat(a1-csp): emit-index-html.mjs + tests"
```

---

## Task 4: Create `index.html.tmpl`, gitignore emitted `index.html`, regenerate locally

**Files:**
- Create: `apps/nestfolio-host/src/index.html.tmpl`
- Delete from git: `apps/nestfolio-host/src/index.html`
- Modify: `.gitignore`

- [ ] **Step 1: Create `src/index.html.tmpl` with `{{CSP}}` placeholder**

Content (identical to the current `apps/nestfolio-host/src/index.html` except the `content` attribute of the CSP meta tag becomes `{{CSP}}`):

```html
<!doctype html>
<html lang="it" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <title>Nestfolio</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="AI-managed investment platform" />
    <meta name="theme-color" content="#4f46e5" />
    <meta http-equiv="Content-Security-Policy" content="{{CSP}}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="manifest" href="manifest.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <app-root></app-root>
    <noscript>Please enable JavaScript to use Nestfolio.</noscript>
  </body>
</html>
```

- [ ] **Step 2: Add the emitted path to `.gitignore`**

Append to `.gitignore`:

```
# CSP single-source-of-truth — emitted from src/index.html.tmpl + csp.txt
apps/nestfolio-host/src/index.html
```

- [ ] **Step 3: Remove the tracked `src/index.html` from git (but keep on disk as the emit target)**

Run: `git rm --cached apps/nestfolio-host/src/index.html`
Then locally regenerate it: `node scripts/emit-index-html.mjs apps/nestfolio-host/src/index.html.tmpl apps/nestfolio-host/csp.txt apps/nestfolio-host/src/index.html`

- [ ] **Step 4: Verify the emitted file matches the canonical CSP**

Run: `grep -F "$(cat apps/nestfolio-host/csp.txt)" apps/nestfolio-host/src/index.html`
Expected: exactly one match (the `<meta>` line with the substituted CSP).

Also: `git status apps/nestfolio-host/src/index.html`
Expected: output shows nothing (file is ignored).

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-host/src/index.html.tmpl .gitignore
git rm --cached apps/nestfolio-host/src/index.html 2>/dev/null || true
git commit -m "feat(a1-csp): template + gitignore emitted index.html"
```

(The `git rm --cached` from Step 3 is staged into this commit.)

---

## Task 5: Wire `prepare-index` target into `nestfolio-host` project

**Files:**
- Modify: `apps/nestfolio-host/project.json`

- [ ] **Step 1: Add `prepare-index` target and `dependsOn` on `esbuild`**

Edit `apps/nestfolio-host/project.json`. Insert the `prepare-index` target before the existing `esbuild` target (so it reads naturally in the file), and add a `dependsOn` array to `esbuild`.

Before (relevant excerpt):

```json
    "esbuild": {
      "executor": "@angular-devkit/build-angular:application",
      "outputs": ["{options.outputPath}"],
      "options": {
```

After:

```json
    "prepare-index": {
      "executor": "nx:run-commands",
      "inputs": [
        "{projectRoot}/src/index.html.tmpl",
        "{projectRoot}/csp.txt"
      ],
      "outputs": ["{projectRoot}/src/index.html"],
      "options": {
        "cwd": "{workspaceRoot}",
        "commands": [
          "node scripts/emit-index-html.mjs apps/nestfolio-host/src/index.html.tmpl apps/nestfolio-host/csp.txt apps/nestfolio-host/src/index.html"
        ]
      }
    },
    "esbuild": {
      "executor": "@angular-devkit/build-angular:application",
      "dependsOn": ["prepare-index"],
      "outputs": ["{options.outputPath}"],
      "options": {
```

Do not modify the `options` block or any other target.

- [ ] **Step 2: Run `prepare-index` standalone and check the output**

First delete the local emitted file so we can see `prepare-index` recreate it:

```bash
rm -f apps/nestfolio-host/src/index.html
pnpm nx run nestfolio-host:prepare-index
```

Expected: exit 0; `apps/nestfolio-host/src/index.html` now exists with the substituted CSP.

Verify:

```bash
grep -F "$(cat apps/nestfolio-host/csp.txt)" apps/nestfolio-host/src/index.html
```

Expected: exactly one match.

- [ ] **Step 3: Run `build` and confirm the pipeline wires up correctly**

```bash
pnpm nx run nestfolio-host:build --configuration=production
```

Expected: exit 0. Nx log lines show `prepare-index` running before `esbuild`.

Then verify the emitted-to-dist copy has the CSP:

```bash
grep -F "$(cat apps/nestfolio-host/csp.txt)" dist/apps/nestfolio-host/browser/index.html
```

Expected: exactly one match (on the `<meta http-equiv="Content-Security-Policy">` line — note: NF's post-build also touches this file but only rewrites `polyfills`/`main` script tags, not the CSP meta).

- [ ] **Step 4: Commit**

```bash
git add apps/nestfolio-host/project.json
git commit -m "feat(a1-csp): wire prepare-index target into nestfolio-host build"
```

---

## Task 6: Switch investor-web CDK to read `csp.txt`

**Files:**
- Modify: `services/investor/investor-web/src/service.stack.ts` (line 100-118, the `securityHeaders` block)

- [ ] **Step 1: Replace the hardcoded CSP string with a `readFileSync` call**

Current lines 100-118 of `services/investor/investor-web/src/service.stack.ts`:

```ts
    // Security response headers policy
    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
          override: true,
        },
```

Replace with:

```ts
    // Security response headers policy
    // CSP is single-sourced from apps/nestfolio-host/csp.txt (charter §5 row 8, Pillar 5).
    const cspContent = readFileSync(
      join(__dirname, '../../../../apps/nestfolio-host/csp.txt'),
      'utf-8',
    ).trim();

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: cspContent,
          override: true,
        },
```

The `readFileSync` and `join` imports already exist on lines 21-22 of the file — no new imports needed.

- [ ] **Step 2: Synth the stack directly with `cdk synth` and confirm the CSP is materialised**

`investor-web` has no `synth` Nx target today (only `deploy`/`destroy`/`test`/`lint`). Task 7 will add one. For this task, verify via the raw `cdk synth` command that mirrors the existing `deploy` target's `--app` argument (from `services/investor/investor-web/project.json:10`):

```bash
npx cdk synth \
  --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts' \
  --output services/investor/investor-web/cdk.out \
  -c prefix=dev
```

Expected: exit 0. A template JSON file appears under `services/investor/investor-web/cdk.out/`.

Verify the CSP appears verbatim:

```bash
grep -F "$(cat apps/nestfolio-host/csp.txt)" services/investor/investor-web/cdk.out/*.template.json
```

Expected: at least one match (the `ContentSecurityPolicy.ContentSecurityPolicy` property in the `SecurityHeaders` `AWS::CloudFront::ResponseHeadersPolicy` resource).

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts
git commit -m "feat(a1-csp): investor-web reads csp.txt at synth time"
```

---

## Task 7: Add `synth` Nx target to investor-web with csp.txt in its inputs

**Files:**
- Modify: `services/investor/investor-web/project.json`

- [ ] **Step 1: Add the `synth` target + inputs tracking csp.txt**

Edit `services/investor/investor-web/project.json`. Insert a new `synth` target between the existing `destroy` and `test` targets (alphabetical grouping of CDK-flow targets: `deploy`, `destroy`, `synth`).

The `synth` target mirrors the `deploy` target's `--app` argument exactly (so the two stay consistent), writes to a project-local `cdk.out`, and declares `csp.txt` as an input for surgical Nx affected tracking.

Before (excerpt, lines 13-22):

```json
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
```

After:

```json
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "synth": {
      "executor": "nx:run-commands",
      "inputs": [
        "default",
        "^production",
        "{workspaceRoot}/apps/nestfolio-host/csp.txt"
      ],
      "outputs": ["{projectRoot}/cdk.out"],
      "options": {
        "command": "npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts' --output services/investor/investor-web/cdk.out -c prefix={args.prefix}"
      }
    },
    "test": {
```

Leave all other targets untouched.

- [ ] **Step 2: Run `synth` twice and verify the second run is a cache hit**

```bash
pnpm nx reset
pnpm nx run investor-web:synth --prefix=dev
pnpm nx run investor-web:synth --prefix=dev
```

Expected: first run actually runs `cdk synth` (reads from CDK + writes `cdk.out/`). Second run reports "existing outputs match" / cache hit (Nx log includes `Nx read the output from the cache` or equivalent).

- [ ] **Step 3: Confirm a `csp.txt` change invalidates the cache**

```bash
printf ' ' >> apps/nestfolio-host/csp.txt
pnpm nx run investor-web:synth --prefix=dev
```

Expected: cache MISS — Nx actually re-runs `cdk synth`. Revert:

```bash
git checkout -- apps/nestfolio-host/csp.txt
```

- [ ] **Step 4: Confirm an unrelated shell change does NOT invalidate the synth cache**

```bash
# Touch an unrelated shell file (won't modify bytes in git; use a throwaway file instead):
touch apps/nestfolio-host/src/main.ts
pnpm nx run investor-web:synth --prefix=dev
```

Expected: cache HIT — the synth inputs do not reference `main.ts` or the shell project, only csp.txt. If this cache-MISSes, the `inputs` array is too broad (or an implicit project dep was added somewhere) — investigate before proceeding.

Reset mtime:

```bash
git checkout -- apps/nestfolio-host/src/main.ts 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/project.json
git commit -m "feat(a1-csp): add synth target to investor-web with csp.txt inputs"
```

---

## Task 8: Cross-consumer parity check

**Files:** none (verification only)

- [ ] **Step 1: Rebuild both sides from a clean state**

```bash
pnpm nx reset
pnpm nx run nestfolio-host:build --configuration=production
pnpm nx run investor-web:synth --prefix=dev
```

Expected: both succeed, exit 0.

- [ ] **Step 2: Extract the CSP string from each artefact and diff against csp.txt**

Extract from the emitted `index.html`:

```bash
CSP_CANONICAL=$(cat apps/nestfolio-host/csp.txt)
CSP_FROM_HTML=$(grep -oE 'Content-Security-Policy"[[:space:]]*content="[^"]*"' dist/apps/nestfolio-host/browser/index.html | sed -E 's/.*content="([^"]*)".*/\1/')
[ "$CSP_CANONICAL" = "$CSP_FROM_HTML" ] && echo "HTML MATCH" || echo "HTML DIFF"
```

Expected: `HTML MATCH`.

Extract from the synthesized CFN (produced by the new `synth` target's output dir `services/investor/investor-web/cdk.out`):

```bash
CFN_FILE=$(find services/investor/investor-web/cdk.out -name '*.template.json' | head -1)
echo "Inspecting: $CFN_FILE"
CSP_FROM_CFN=$(jq -r '
  [.. | objects | select(.Type == "AWS::CloudFront::ResponseHeadersPolicy")]
  | .[0].Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy
' "$CFN_FILE")
[ "$CSP_CANONICAL" = "$CSP_FROM_CFN" ] && echo "CFN MATCH" || echo "CFN DIFF"
```

Expected: `CFN MATCH`.

(If the CFN template has multiple `ResponseHeadersPolicy` resources — e.g. the CopilotKit CORS policy — `.[0]` may not be the security one. Refine the jq selection: `select(.Type == "AWS::CloudFront::ResponseHeadersPolicy" and (.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig != null))` if `HTML MATCH + CFN DIFF` appears.)

- [ ] **Step 3: If both MATCH, the single source of truth is verified. No commit — this task is validation only.**

If either DIFFs, abort. Do not continue. Investigate by running `diff <(echo "$CSP_CANONICAL") <(echo "$CSP_FROM_HTML")` / `diff <(echo "$CSP_CANONICAL") <(echo "$CSP_FROM_CFN")`.

---

## Task 9: Drift-detection smoke test

**Files:** none (verification only — leaves no change)

- [ ] **Step 1: Mutate `csp.txt` and confirm `nx affected` re-runs both targets**

```bash
# Capture the current commit; we will revert at the end.
HEAD_BEFORE=$(git rev-parse HEAD)
# Harmless mutation: add a URL to connect-src that was already in the list (idempotent effect, but bytes differ).
sed -i.bak 's/https:\/\/cognito-identity\.us-east-1\.amazonaws\.com/https:\/\/cognito-identity.us-east-1.amazonaws.com https:\/\/example.invalid/' apps/nestfolio-host/csp.txt
rm apps/nestfolio-host/csp.txt.bak

# Run affected:
pnpm nx affected -t build --projects=nestfolio-host --base=$HEAD_BEFORE 2>&1 | tail -20
pnpm nx affected -t synth --projects=investor-web --base=$HEAD_BEFORE 2>&1 | tail -20
```

Expected: both commands report the target executing (NOT skipped / cached).

- [ ] **Step 2: Revert the mutation**

```bash
git checkout -- apps/nestfolio-host/csp.txt
```

Expected: `apps/nestfolio-host/csp.txt` returns to canonical content. Run `diff <(git show HEAD:apps/nestfolio-host/csp.txt) apps/nestfolio-host/csp.txt` — exit 0.

- [ ] **Step 3: No commit**

This task leaves no changes on disk.

---

## Task 10: Placeholder-missing guard test

**Files:** none (verification only — leaves no change)

- [ ] **Step 1: Temporarily break the template and confirm `prepare-index` fails**

```bash
# Save original.
cp apps/nestfolio-host/src/index.html.tmpl /tmp/a1-tmpl-backup.html
# Mutilate: remove the placeholder.
sed -i.bak 's/{{CSP}}/BROKEN/' apps/nestfolio-host/src/index.html.tmpl
rm apps/nestfolio-host/src/index.html.tmpl.bak

pnpm nx run nestfolio-host:prepare-index 2>&1 | tee /tmp/a1-prepare-index.log
EXIT=${PIPESTATUS[0]}
echo "Exit code: $EXIT"
grep -i 'placeholder' /tmp/a1-prepare-index.log
```

Expected: non-zero exit code; log contains "placeholder {{CSP}} missing" (from `emit-index-html.mjs`).

- [ ] **Step 2: Restore the template**

```bash
mv /tmp/a1-tmpl-backup.html apps/nestfolio-host/src/index.html.tmpl
# Verify restoration:
grep -c '{{CSP}}' apps/nestfolio-host/src/index.html.tmpl
```

Expected: `1`.

- [ ] **Step 3: Re-emit the local `index.html` so the working tree is healthy**

```bash
node scripts/emit-index-html.mjs apps/nestfolio-host/src/index.html.tmpl apps/nestfolio-host/csp.txt apps/nestfolio-host/src/index.html
```

Expected: exit 0.

- [ ] **Step 4: No commit**

Verification only.

---

## Task 11: Update memory + close out

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` (one-line entry under "Recently Completed Work")
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` — update the `project_shell_render_broken.md` / `playwright-e2e-ui` entries to note A1 is done (these plans are blocked on B2+ so no status change yet — note only the A1 step completion).

- [ ] **Step 1: Record A1 landing in MEMORY.md**

Under the "Recently Completed Work" bullet list, insert a new line after the "Onboarding runtime latent bugs" entry (near the top, since this is the most recent):

```
- **A1 — CSP single-source of truth** — SHIPPED 2026-04-24: `apps/nestfolio-host/csp.txt` is now the canonical CSP; shell emits `src/index.html` from a template at build-time, investor-web CDK reads the same file at synth-time; sha256 hash for NF's deterministic `{"shimMode":true}` inline esms-options is `NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=`; `connect-src` still admits AppSync + Cognito (shrinks to `'self'` in B1/B3). First item complete in the charter migration roadmap.
```

- [ ] **Step 2: Commit**

Do NOT commit memory files via git — they live outside the working directory. The Write tool call itself persists them.

- [ ] **Step 3: Final sanity check — full green path**

```bash
pnpm nx reset
pnpm nx run nestfolio-host:build --configuration=production
pnpm nx run investor-web:synth --prefix=dev
node --test scripts/emit-index-html.test.mjs
```

Expected: all four commands green (the `nx reset` followed by the three actual invocations). Task complete.

---

## Success criteria (from spec §7, restated)

- `apps/nestfolio-host/csp.txt` exists, one non-empty line, matches the content in Task 1.
- `pnpm nx build nestfolio-host` produces `dist/apps/nestfolio-host/browser/index.html` whose `<meta http-equiv="Content-Security-Policy">` content equals `csp.txt` verbatim (verified in Task 8).
- `pnpm nx run investor-web:synth` produces a CFN template whose `ResponseHeadersPolicy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy` equals `csp.txt` verbatim (verified in Task 8).
- `pnpm nx affected -t build,synth` re-runs both targets when `csp.txt` changes (verified in Task 9).
- `scripts/emit-index-html.mjs` fails clearly when any input is missing or when the `{{CSP}}` placeholder is absent / duplicated (verified in Task 10 + unit tests in Task 2).
- `git status` after `pnpm nx build nestfolio-host` shows no untracked `apps/nestfolio-host/src/index.html` (confirmed gitignored in Task 4).
