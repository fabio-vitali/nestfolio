# B2 — Federation mechanical fixes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Native Federation runtime mechanics that make Pillar 2's "shell ⊇ MFE" identity work at runtime, plus a build-time regression gate that catches future drift.

**Architecture:** All singleton-surface changes flow through `libs/frontend-deps/index.js` (single edit, six-app reach). Three `tsconfig.base.json` `paths` keys make NF's literal-string `sharedMappings` resolution work for shell subpaths. Every app's `project.json` gains `es-module-shims` in the polyfills array and a renamed build-target chain (`build` → `nf-build`, plus a new composite `build` that runs `scripts/assert-shell-html.mjs` against the dist output). The assertion script enforces five invariants on the post-NF `index.html` and exits non-zero on any regression.

**Tech Stack:** Native Federation (`@angular-architects/native-federation@21.2.1`, `@softarc/native-federation@3.5.4`); Nx 22.5.4 (`run-commands`, target `dependsOn`); Node ≥24 stdlib (`fs`, `crypto`, `path`); pnpm 10 workspace.

**Spec:** [`docs/superpowers/specs/2026-04-26-b2-federation-mechanical-fixes-design.md`](../specs/2026-04-26-b2-federation-mechanical-fixes-design.md)

**Branch:** Work on `feat/b2-federation-mechanical-fixes`. Create it before Task 1.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `libs/frontend-deps/index.js` | Modify | Singleton surface + workspace-lib subpath bridge — single source for all six apps |
| `tsconfig.base.json` | Modify | Explicit `paths` keys for shell subpaths — what NF's `mapped-paths.js` reads |
| `package.json` (root) | Modify | `es-module-shims` + `url` direct devDeps |
| `pnpm-lock.yaml` | Regenerate | Auto via `pnpm install` |
| `apps/nestfolio-host/project.json` | Modify | Polyfill + build-chain rename + `--kind=shell` assertion |
| `apps/investor-mfe/project.json` | Modify | Polyfill + build-chain rename + `--kind=mfe` assertion |
| `apps/advisory-mfe/project.json` | Modify | Same as investor-mfe |
| `apps/dashboard-mfe/project.json` | Modify | Same as investor-mfe |
| `apps/ledger-mfe/project.json` | Modify | Same as investor-mfe |
| `apps/onboarding-mfe/project.json` | Modify | Same as investor-mfe |
| `scripts/assert-shell-html.mjs` | Create | Five-rule build-time invariant gate |
| `scripts/test-assert-shell-html.sh` | Create | Self-test: pass case + 5 deliberate-failure cases |

---

## Task 0 — Branch + baseline

**Goal:** Confirm starting state and create the working branch.

- [ ] **Step 0.1: Verify clean working tree**

  Run: `git status --short`
  Expected: empty output (no uncommitted changes).

  If the tree is dirty, stop and report — the executing agent should not silently stash work.

- [ ] **Step 0.2: Verify on `main` and up to date**

  Run: `git rev-parse --abbrev-ref HEAD`
  Expected: `main`.

  Run: `git fetch origin && git status -sb`
  Expected: `## main...origin/main` (no `[behind N]`).

- [ ] **Step 0.3: Create the working branch**

  Run: `git switch -c feat/b2-federation-mechanical-fixes`
  Expected: `Switched to a new branch 'feat/b2-federation-mechanical-fixes'`.

- [ ] **Step 0.4: Capture pre-baseline build state for one app**

  Run: `pnpm nx run nestfolio-host:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: build succeeds (exits 0). Note the output path it reports — should be `dist/apps/nestfolio-host/browser`.

  This is the "before" baseline — the project builds today; B2 must not regress that. Do not commit anything yet.

---

## Task 1 — Build-time assertion script (TDD)

**Goal:** Implement `scripts/assert-shell-html.mjs` and a bash self-test that exercises all five rules against synthetic HTML fixtures. The script must exist and pass its own tests before any `project.json` chains it.

**Files:**
- Create: `scripts/assert-shell-html.mjs`
- Create: `scripts/test-assert-shell-html.sh`

- [ ] **Step 1.1: Write the failing self-test**

  Create `scripts/test-assert-shell-html.sh`:

  ```bash
  #!/usr/bin/env bash
  # Self-test for scripts/assert-shell-html.mjs.
  # Builds synthetic dist/index.html fixtures in a tmp dir and asserts the script's exit codes.
  set -u

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ASSERT="$SCRIPT_DIR/assert-shell-html.mjs"

  fail() { echo "FAIL: $1"; exit 1; }
  pass() { echo "PASS: $1"; }

  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  # Canonical good shell HTML (CSP hash matches sha256-base64 of {"shimMode":true})
  GOOD_HASH="NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U="
  GOOD_ESMS='{"shimMode":true}'

  write_good_shell() {
    local dir="$1"; mkdir -p "$dir"
    cat > "$dir/index.html" <<EOF
  <!doctype html>
  <html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-$GOOD_HASH'; style-src 'self'">
  <script type="esms-options">$GOOD_ESMS</script>
  <script type="module" src="polyfills-ABC123.js"></script>
  <script type="module-shim" src="main-DEF456.js"></script>
  </head><body><app-root></app-root></body></html>
  EOF
  }

  write_good_mfe() {
    local dir="$1"; mkdir -p "$dir"
    cat > "$dir/index.html" <<EOF
  <!doctype html>
  <html><head>
  <script type="esms-options">$GOOD_ESMS</script>
  <script type="module" src="polyfills-XYZ.js"></script>
  <script type="module-shim" src="main-XYZ.js"></script>
  </head><body></body></html>
  EOF
  }

  expect_exit() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" -eq "$expected" ]]; then pass "$label (exit=$got)"; else fail "$label expected exit=$expected, got=$got"; fi
  }

  # Pass cases
  D="$TMP/good-shell"; write_good_shell "$D"
  node "$ASSERT" "$D" --kind=shell; expect_exit "good shell" 0 $?

  D="$TMP/good-mfe"; write_good_mfe "$D"
  node "$ASSERT" "$D" --kind=mfe; expect_exit "good mfe" 0 $?

  # Rule 1: missing polyfills tag
  D="$TMP/no-polyfills"; write_good_shell "$D"
  sed -i.bak '/polyfills-/d' "$D/index.html" && rm "$D/index.html.bak"
  node "$ASSERT" "$D" --kind=shell; expect_exit "rule 1 missing polyfills" 1 $?

  # Rule 2: missing main module-shim tag
  D="$TMP/no-main-shim"; write_good_shell "$D"
  sed -i.bak '/main-/d' "$D/index.html" && rm "$D/index.html.bak"
  node "$ASSERT" "$D" --kind=shell; expect_exit "rule 2 missing main shim" 1 $?

  # Rule 3: malformed esms-options JSON
  D="$TMP/bad-esms-json"; write_good_shell "$D"
  sed -i.bak 's|<script type="esms-options">{"shimMode":true}</script>|<script type="esms-options">{not json}</script>|' "$D/index.html" && rm "$D/index.html.bak"
  node "$ASSERT" "$D" --kind=shell; expect_exit "rule 3 bad json" 1 $?

  # Rule 4: wrong esms-options body
  D="$TMP/wrong-esms-body"; write_good_shell "$D"
  sed -i.bak 's|<script type="esms-options">{"shimMode":true}</script>|<script type="esms-options">{"shimMode":false}</script>|' "$D/index.html" && rm "$D/index.html.bak"
  node "$ASSERT" "$D" --kind=shell; expect_exit "rule 4 wrong body" 1 $?

  # Rule 5: CSP hash mismatch (shell only)
  D="$TMP/csp-mismatch"; write_good_shell "$D"
  sed -i.bak "s|sha256-$GOOD_HASH|sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=|" "$D/index.html" && rm "$D/index.html.bak"
  node "$ASSERT" "$D" --kind=shell; expect_exit "rule 5 csp mismatch" 1 $?

  # Rule 5 NOT enforced for mfe (mfe ignores CSP entirely)
  D="$TMP/mfe-no-csp"; write_good_mfe "$D"
  node "$ASSERT" "$D" --kind=mfe; expect_exit "mfe ignores rule 5" 0 $?

  # Argument validation
  node "$ASSERT" 2>/dev/null; expect_exit "missing args" 2 $?
  node "$ASSERT" "$TMP/good-shell" --kind=invalid 2>/dev/null; expect_exit "bad kind" 2 $?

  echo
  echo "All assertion-script self-tests passed."
  ```

  Make it executable: `chmod +x scripts/test-assert-shell-html.sh`.

- [ ] **Step 1.2: Run self-test to confirm it fails (script doesn't exist yet)**

  Run: `bash scripts/test-assert-shell-html.sh`
  Expected: first `node` invocation fails because `scripts/assert-shell-html.mjs` does not exist. The script aborts on the first FAIL line.

- [ ] **Step 1.3: Implement `scripts/assert-shell-html.mjs`**

  Create exactly this file:

  ```js
  #!/usr/bin/env node
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { createHash } from 'node:crypto';

  const args = process.argv.slice(2);
  const distDir = args.find((a) => !a.startsWith('--'));
  const kindArg = args.find((a) => a.startsWith('--kind='));
  const kind = kindArg ? kindArg.slice('--kind='.length) : null;

  if (!distDir || !kind || !['shell', 'mfe'].includes(kind)) {
    console.error('Usage: assert-shell-html.mjs <dist-dir> --kind=<shell|mfe>');
    process.exit(2);
  }

  const fail = (rule, msg) => {
    console.error(`assert-shell-html (${kind}) ${rule} FAILED: ${msg}`);
    process.exit(1);
  };

  let html;
  try {
    html = readFileSync(join(distDir, 'index.html'), 'utf8');
  } catch (e) {
    fail('preflight', `cannot read ${join(distDir, 'index.html')}: ${e.message}`);
  }

  // Rule 1 — exactly one polyfills.js as type="module"
  const polyfills = [...html.matchAll(/<script\s+type="module"\s+src="(polyfills-[^"]+\.js)"\s*>/g)];
  if (polyfills.length !== 1) {
    fail('rule-1', `expected 1 <script type="module" src="polyfills-*.js">, found ${polyfills.length}`);
  }

  // Rule 2 — exactly one main.js as type="module-shim"
  const mainShim = [...html.matchAll(/<script\s+type="module-shim"\s+src="(main-[^"]+\.js)"\s*>/g)];
  if (mainShim.length !== 1) {
    fail('rule-2', `expected 1 <script type="module-shim" src="main-*.js">, found ${mainShim.length}`);
  }

  // Rule 3 — exactly one esms-options inline script with valid JSON body
  const esmsTags = [...html.matchAll(/<script\s+type="esms-options"\s*>([^<]*)<\/script>/g)];
  if (esmsTags.length !== 1) {
    fail('rule-3', `expected 1 <script type="esms-options">, found ${esmsTags.length}`);
  }
  const esmsBody = esmsTags[0][1];
  let esmsParsed;
  try {
    esmsParsed = JSON.parse(esmsBody);
  } catch (e) {
    fail('rule-3', `esms-options body is not valid JSON: ${e.message}`);
  }

  // Rule 4 — esms-options body equals {"shimMode":true}
  if (JSON.stringify(esmsParsed) !== '{"shimMode":true}') {
    fail('rule-4', `esms-options body must equal {"shimMode":true}, got ${JSON.stringify(esmsParsed)}`);
  }

  // Rule 5 — shell only: sha256(esms body) matches the CSP script-src hash token
  if (kind === 'shell') {
    const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    if (!cspMatch) fail('rule-5', 'no <meta http-equiv="Content-Security-Policy"> tag found');
    const hashToken = cspMatch[1].match(/script-src[^;]*'sha256-([A-Za-z0-9+/=]+)'/);
    if (!hashToken) fail('rule-5', `no sha256-<hash> token in script-src: ${cspMatch[1]}`);
    const expected = createHash('sha256').update(esmsBody).digest('base64');
    if (hashToken[1] !== expected) {
      fail('rule-5', `CSP hash mismatch — meta has 'sha256-${hashToken[1]}', sha256(esms-body) is 'sha256-${expected}'`);
    }
  }

  console.log(`assert-shell-html (${kind}) OK: all rules passed for ${distDir}/index.html`);
  ```

- [ ] **Step 1.4: Run self-test to confirm all assertions pass**

  Run: `bash scripts/test-assert-shell-html.sh`
  Expected: every line begins with `PASS:`, final line is `All assertion-script self-tests passed.`, exit code 0.

  If any line begins with `FAIL:`, do not proceed. Fix the script until all checks pass.

- [ ] **Step 1.5: Commit**

  ```bash
  git add scripts/assert-shell-html.mjs scripts/test-assert-shell-html.sh
  git commit -m "$(cat <<'EOF'
  feat(b2): add assert-shell-html.mjs build-time invariant gate

  Five-rule check on dist/<app>/browser/index.html: polyfill <script>
  shape, main module-shim <script> shape, esms-options inline shape,
  esms-options JSON body, and (shell only) sha256(esms-body) ≡ CSP
  meta-tag hash token. Stdlib only.

  Self-test in scripts/test-assert-shell-html.sh exercises one good
  case per kind plus one deliberate failure per rule.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

  Verify: `git log -1 --stat` shows two new files.

---

## Task 2 — Root `package.json` direct devDeps

**Goal:** Promote `es-module-shims` and `url` to direct devDependencies so pnpm hoists them deterministically into the workspace root for NF's import-map resolution.

**Files:**
- Modify: `package.json` (root)
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 2.1: Add the two devDependencies**

  Open `package.json` (root). In the `devDependencies` block, insert two new entries — keep the block alphabetised by key (so they go between existing entries):

  - `"es-module-shims": "^1.5.12"` — insert immediately before `"eslint": "^9.20.0"`.
  - `"url": "^0.11.0"` — insert immediately before `"yaml": "^2.8.3"`.

  Resulting nearby block (only the new lines and immediate context shown):

  ```json
      "esbuild": "^0.25.0",
      "es-module-shims": "^1.5.12",
      "eslint": "^9.20.0",
  ```

  ```json
      "typescript-eslint": "^8.25.0",
      "url": "^0.11.0",
      "yaml": "^2.8.3"
  ```

- [ ] **Step 2.2: Install + regenerate lockfile**

  Run: `pnpm install`
  Expected: succeeds; `pnpm-lock.yaml` updates. No peer-dep errors that weren't there before.

  Verify the symlinks exist:
  - `ls -ld node_modules/es-module-shims` → directory or symlink, not "No such file".
  - `ls -ld node_modules/url` → directory or symlink.

- [ ] **Step 2.3: Smoke-test that the build still works pre-frontend-deps changes**

  Run: `pnpm nx run nestfolio-host:build --configuration=production --skip-nx-cache 2>&1 | tail -3`
  Expected: exit 0. (The new devDeps are inert until Task 3 references them.)

- [ ] **Step 2.4: Commit**

  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "$(cat <<'EOF'
  chore(b2): add es-module-shims + url as direct devDependencies

  es-module-shims is the polyfill Native Federation expects in the
  app polyfills array. url@^0.11.0 is the browser-safe npm package
  declared as a runtime dep by aws-appsync-subscription-link@4.0.1;
  promoted from transitive to direct so pnpm hoists it into the
  workspace root where NF's import-map resolution looks.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — `libs/frontend-deps/index.js` — singleton surface + sharedMappings

**Goal:** Wire `includeSecondaries: true` on the four subpath-importing singletons, share the `url` bare specifier, and expand `sharedMappings` to the four workspace-lib subpaths actually imported at runtime.

**File:**
- Modify: `libs/frontend-deps/index.js`

- [ ] **Step 3.1: Replace the file contents**

  Overwrite `libs/frontend-deps/index.js` with this exact content:

  ```js
  const { share } = require('@angular-architects/native-federation/config');

  const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };
  const singletonWithSecondaries = { ...singletonOpts, includeSecondaries: true };

  const sharedFrontendDeps = share({
    '@angular/animations': singletonOpts,
    '@angular/cdk': singletonOpts,
    '@angular/common': singletonOpts,
    '@angular/core': singletonOpts,
    '@angular/forms': singletonOpts,
    '@angular/platform-browser': singletonOpts,
    '@angular/platform-browser-dynamic': singletonOpts,
    '@angular/router': singletonOpts,
    '@angular/service-worker': singletonOpts,
    '@ngrx/signals': singletonOpts,
    '@ngx-translate/core': singletonOpts,
    '@ngx-translate/http-loader': singletonOpts,
    '@primeuix/themes': singletonWithSecondaries,
    'aws-amplify': singletonOpts,
    '@apollo/client': singletonOpts,
    'aws-appsync-auth-link': singletonWithSecondaries,
    'aws-appsync-subscription-link': singletonWithSecondaries,
    'graphql': singletonWithSecondaries,
    'primeicons': singletonOpts,
    'primeng': singletonOpts,
    'rxjs': singletonOpts,
    'url': singletonOpts,
    '@ag-ui/client': singletonOpts,
    '@copilotkitnext/angular': singletonOpts,
  });

  const sharedMappings = [
    '@nestfolio/ui',
    '@nestfolio/ui/feature-flags',
    '@nestfolio/shell',
    '@nestfolio/shell/auth',
    '@nestfolio/shell/graphql',
    '@nestfolio/shell/i18n',
  ];

  module.exports = { sharedFrontendDeps, sharedMappings };
  ```

- [ ] **Step 3.2: Verify the file parses (Node CommonJS)**

  Run: `node -e "const m = require('./libs/frontend-deps'); console.log(Object.keys(m.sharedFrontendDeps).length, 'singletons;', m.sharedMappings.length, 'mappings')"`
  Expected output (single line): `24 singletons; 6 mappings`.

  If the count differs, the file edit is wrong — re-check Step 3.1.

- [ ] **Step 3.3: Commit**

  ```bash
  git add libs/frontend-deps/index.js
  git commit -m "$(cat <<'EOF'
  feat(b2): expand frontend-deps singleton surface + sharedMappings

  Adds includeSecondaries: true to @primeuix/themes, graphql, and the
  two aws-appsync-* packages so NF's import map advertises their
  subpath entries (graphql/language/printer.js, @primeuix/themes/aura,
  internal aws-appsync deps). Shares the 'url' bare specifier so NF
  resolves it via the import map. Expands sharedMappings to include
  @nestfolio/ui/feature-flags + the three shell subpaths actually
  imported at runtime: @nestfolio/shell/{auth,graphql,i18n}.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — `tsconfig.base.json` — explicit shell subpath keys

**Goal:** Add three explicit `paths` entries that NF's literal-string `mapped-paths.js` can match. The existing `@nestfolio/shell/*` wildcard stays — Jest's `moduleNameMapper` keeps using it for `@nestfolio/shell/testing` (which is intentionally test-only and excluded from `sharedMappings`).

**File:**
- Modify: `tsconfig.base.json`

- [ ] **Step 4.1: Insert the three explicit keys**

  In `tsconfig.base.json`, the current shell `paths` block (lines 83–85) reads:

  ```json
        "@nestfolio/shell": ["libs/shell/src/index.ts"],
        "@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
        "@nestfolio/shell/*": ["libs/shell/src/*/index.ts"],
  ```

  Replace that block with:

  ```json
        "@nestfolio/shell": ["libs/shell/src/index.ts"],
        "@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
        "@nestfolio/shell/auth": ["libs/shell/src/auth/index.ts"],
        "@nestfolio/shell/graphql": ["libs/shell/src/graphql/index.ts"],
        "@nestfolio/shell/i18n": ["libs/shell/src/i18n/index.ts"],
        "@nestfolio/shell/*": ["libs/shell/src/*/index.ts"],
  ```

  (Three new lines inserted between `testing` and `*`. Order matters only for human readability — TypeScript resolves longest-match-first regardless.)

- [ ] **Step 4.2: Verify the three target index.ts files exist**

  Run: `ls libs/shell/src/auth/index.ts libs/shell/src/graphql/index.ts libs/shell/src/i18n/index.ts`
  Expected: all three paths print without error.

  If any are missing, stop — the spec assumed they exist; if they don't, this is a real codebase gap to surface to the user, not patch around.

- [ ] **Step 4.3: Verify TypeScript still resolves the existing imports**

  Run: `pnpm nx run nestfolio-host:test --skip-nx-cache 2>&1 | tail -10`
  Expected: tests pass (or — if they were failing before — fail no worse than before). The signal is that no new TS resolution error appears for `@nestfolio/shell/auth`, `/graphql`, or `/i18n`.

  If there's a regression, re-check Step 4.1 — the wildcard line was likely deleted accidentally.

- [ ] **Step 4.4: Commit**

  ```bash
  git add tsconfig.base.json
  git commit -m "$(cat <<'EOF'
  feat(b2): add explicit shell subpath paths to tsconfig.base.json

  Native Federation's mapped-paths.js does literal-string match
  against tsconfig.compilerOptions.paths keys; the @nestfolio/shell/*
  wildcard isn't visible to it. Adds three explicit keys for the
  three shell subpaths app code imports at runtime
  (@nestfolio/shell/{auth,graphql,i18n}). The wildcard stays as a
  Jest moduleNameMapper fallback for @nestfolio/shell/testing.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — `apps/nestfolio-host/project.json` — polyfill + build-chain rename (shell)

**Goal:** Add `es-module-shims` to the shell's polyfills array, rename the existing `build` to `nf-build`, and add a new composite `build` that runs the assertion in `--kind=shell` mode. Wire `serve-static` to skip the assertion.

**File:**
- Modify: `apps/nestfolio-host/project.json`

- [ ] **Step 5.1: Update the polyfills array**

  In `apps/nestfolio-host/project.json`, locate `targets.esbuild.options.polyfills` (around line 44):

  ```json
          "polyfills": [],
  ```

  Replace with:

  ```json
          "polyfills": ["es-module-shims"],
  ```

- [ ] **Step 5.2: Rename `build` → `nf-build` and add new composite `build`**

  In the same file, locate the existing `build` target (around lines 79–92):

  ```json
      "build": {
        "executor": "@angular-architects/native-federation:build",
        "options": {},
        "configurations": {
          "production": {
            "target": "nestfolio-host:esbuild:production"
          },
          "development": {
            "target": "nestfolio-host:esbuild:development",
            "dev": true
          }
        },
        "defaultConfiguration": "production"
      },
  ```

  Replace with:

  ```json
      "nf-build": {
        "executor": "@angular-architects/native-federation:build",
        "options": {},
        "configurations": {
          "production": {
            "target": "nestfolio-host:esbuild:production"
          },
          "development": {
            "target": "nestfolio-host:esbuild:development",
            "dev": true
          }
        },
        "defaultConfiguration": "production"
      },
      "build": {
        "executor": "nx:run-commands",
        "dependsOn": ["nf-build"],
        "outputs": ["{workspaceRoot}/dist/apps/{projectName}"],
        "options": {
          "cwd": "{workspaceRoot}",
          "commands": [
            "node scripts/assert-shell-html.mjs dist/apps/nestfolio-host/browser --kind=shell"
          ]
        }
      },
  ```

- [ ] **Step 5.3: Update `serve-static.options.buildTarget` to bypass the assertion**

  Locate `targets["serve-static"].options.buildTarget` (around line 140):

  ```json
          "buildTarget": "nestfolio-host:build",
  ```

  Replace with:

  ```json
          "buildTarget": "nestfolio-host:nf-build",
      ```

  (Whitespace-preserved — match the existing indent.)

- [ ] **Step 5.4: Verify the build chain runs end-to-end**

  Run: `pnpm nx run nestfolio-host:build --configuration=production --skip-nx-cache 2>&1 | tail -10`
  Expected: succeeds. The last line of stdout from the assertion step must be:
  `assert-shell-html (shell) OK: all rules passed for dist/apps/nestfolio-host/browser/index.html`.

  If the assertion fails, read the rule-tagged error message and re-check the related task. Common causes:
  - `rule-1` / `rule-2`: polyfills array empty (re-check Step 5.1) or NF post-build didn't run (build chain misconfigured).
  - `rule-5`: `apps/nestfolio-host/csp.txt` hash drifted from the canonical `sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=` shipped in A1 — check `cat apps/nestfolio-host/csp.txt` and verify the hash token matches the file.

- [ ] **Step 5.5: Verify `polyfills-*.js` actually contains es-module-shims**

  Run: `grep -l 'es-module-shims' dist/apps/nestfolio-host/browser/polyfills-*.js >/dev/null && echo OK || echo FAIL`
  Expected: `OK`.

  If `FAIL`, the polyfill wasn't bundled — re-check `node_modules/es-module-shims` exists (Task 2) and the polyfills array was edited correctly.

- [ ] **Step 5.6: Verify import map advertises new entries**

  Find the import-map file (NF emits it under one of two names depending on patch level):
  ```bash
  IM=$(ls dist/apps/nestfolio-host/browser/_importmap.json dist/apps/nestfolio-host/browser/importmap.json 2>/dev/null | head -1)
  echo "Import map at: $IM"
  ```
  Expected: prints a path (one file exists). If neither does, NF's post-build didn't write the manifest — re-check the build succeeded.

  Then verify expected keys are present:
  ```bash
  node -e "
    const m = require('$IM');
    const need = ['url', '@nestfolio/shell/auth', '@nestfolio/shell/graphql', '@nestfolio/shell/i18n', '@primeuix/themes/aura'];
    const missing = need.filter(k => !(m.imports || m)[k]);
    if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(1); }
    console.log('OK: import map advertises all expected keys');
  "
  ```
  Expected: `OK: import map advertises all expected keys`.

  Note: NF v21.2 emits import-map data either at `imports.<key>` (top-level `{ "imports": {...} }`) or directly at `<key>` (top-level keys). The script above tolerates both.

  If keys are missing, the most likely cause is `frontend-deps/index.js` was not edited as Task 3 specifies. Re-verify with `node -e "console.log(Object.keys(require('./libs/frontend-deps').sharedFrontendDeps))"`.

- [ ] **Step 5.7: Commit**

  ```bash
  git add apps/nestfolio-host/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (shell)

  Adds es-module-shims to nestfolio-host's esbuild polyfills array.
  Renames the Native-Federation-build target to nf-build; introduces
  a new composite build target that depends on nf-build and runs
  scripts/assert-shell-html.mjs against the dist artefact in shell
  mode (all 5 rules). serve-static now targets nf-build so dev
  iteration skips the assertion gate.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — Five MFE `project.json` files — same edits, `--kind=mfe`

**Goal:** Apply the equivalent of Task 5 to each of the five MFEs. Identical changes except the assertion runs in `--kind=mfe` mode.

**Files (edit one per step):**
- Modify: `apps/investor-mfe/project.json`
- Modify: `apps/advisory-mfe/project.json`
- Modify: `apps/dashboard-mfe/project.json`
- Modify: `apps/ledger-mfe/project.json`
- Modify: `apps/onboarding-mfe/project.json`

> **Per-MFE recipe.** For each of the five files, apply the three edits below, then run the per-app verification, then commit. Do not batch all five into one commit — one MFE per commit so a regression can be bisected.

**Per-MFE edit recipe** (`<project>` is the project name, e.g. `investor-mfe`):

1. **Polyfills** — find `targets.esbuild.options.polyfills` and change `[]` → `["es-module-shims"]`.

2. **Build-chain rename** — find the existing `"build": { ... }` block (uses `@angular-architects/native-federation:build` executor). Rename the key to `"nf-build"`. Then add a new `"build"` block immediately after it:

   ```json
       "build": {
         "executor": "nx:run-commands",
         "dependsOn": ["nf-build"],
         "outputs": ["{workspaceRoot}/dist/apps/{projectName}"],
         "options": {
           "cwd": "{workspaceRoot}",
           "commands": [
             "node scripts/assert-shell-html.mjs dist/apps/<project>/browser --kind=mfe"
           ]
         }
       },
   ```

   (Replace `<project>` with the actual project name in the `commands` line.)

3. **Serve-static** — if a `serve-static` target exists in this MFE's `project.json`, update its `options.buildTarget` from `<project>:build` to `<project>:nf-build`. (If it doesn't exist, skip.)

**Per-MFE verification** (run after each edit, before its commit):

Run: `pnpm nx run <project>:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
Expected: ends with `assert-shell-html (mfe) OK: all rules passed for dist/apps/<project>/browser/index.html`.

- [ ] **Step 6.1: investor-mfe**

  Apply the recipe to `apps/investor-mfe/project.json`. The assertion command becomes:
  `node scripts/assert-shell-html.mjs dist/apps/investor-mfe/browser --kind=mfe`.

  Run: `pnpm nx run investor-mfe:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: `assert-shell-html (mfe) OK: all rules passed for dist/apps/investor-mfe/browser/index.html`.

  Commit:
  ```bash
  git add apps/investor-mfe/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (investor-mfe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6.2: advisory-mfe**

  Apply the recipe to `apps/advisory-mfe/project.json`. Assertion command:
  `node scripts/assert-shell-html.mjs dist/apps/advisory-mfe/browser --kind=mfe`.

  Run: `pnpm nx run advisory-mfe:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: `assert-shell-html (mfe) OK: all rules passed for dist/apps/advisory-mfe/browser/index.html`.

  Commit:
  ```bash
  git add apps/advisory-mfe/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (advisory-mfe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6.3: dashboard-mfe**

  Apply the recipe to `apps/dashboard-mfe/project.json`. Assertion command:
  `node scripts/assert-shell-html.mjs dist/apps/dashboard-mfe/browser --kind=mfe`.

  Run: `pnpm nx run dashboard-mfe:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: `assert-shell-html (mfe) OK: all rules passed for dist/apps/dashboard-mfe/browser/index.html`.

  Commit:
  ```bash
  git add apps/dashboard-mfe/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (dashboard-mfe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6.4: ledger-mfe**

  Apply the recipe to `apps/ledger-mfe/project.json`. Assertion command:
  `node scripts/assert-shell-html.mjs dist/apps/ledger-mfe/browser --kind=mfe`.

  Run: `pnpm nx run ledger-mfe:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: `assert-shell-html (mfe) OK: all rules passed for dist/apps/ledger-mfe/browser/index.html`.

  Commit:
  ```bash
  git add apps/ledger-mfe/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (ledger-mfe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6.5: onboarding-mfe**

  Apply the recipe to `apps/onboarding-mfe/project.json`. Assertion command:
  `node scripts/assert-shell-html.mjs dist/apps/onboarding-mfe/browser --kind=mfe`.

  Run: `pnpm nx run onboarding-mfe:build --configuration=production --skip-nx-cache 2>&1 | tail -5`
  Expected: `assert-shell-html (mfe) OK: all rules passed for dist/apps/onboarding-mfe/browser/index.html`.

  Commit:
  ```bash
  git add apps/onboarding-mfe/project.json
  git commit -m "$(cat <<'EOF'
  feat(b2): wire es-module-shims polyfill + assert build chain (onboarding-mfe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — End-to-end verification

**Goal:** Verify the integrated B2 work — all six apps build under one `run-many`; the affected graph triggers all six on `frontend-deps` edits; the shell renders `/login` locally with zero CSP violations; deliberate-mutation regression checks succeed.

- [ ] **Step 7.1: Single-source propagation check (`affected -t nf-build`)**

  Add a controlled, reverted mutation to verify Nx's affected graph picks up `frontend-deps`:

  ```bash
  echo "// touch" >> libs/frontend-deps/index.js
  pnpm nx affected -t nf-build --base=HEAD~1 --plain 2>/dev/null | tee /tmp/affected.txt
  ```
  Expected: `/tmp/affected.txt` contains `nestfolio-host` plus all five MFE project names. Confirm with:
  ```bash
  for p in nestfolio-host investor-mfe advisory-mfe dashboard-mfe ledger-mfe onboarding-mfe; do
    grep -q "$p" /tmp/affected.txt && echo "$p OK" || echo "$p MISSING"
  done
  ```
  Expected: every line ends `OK`.

  Then revert the mutation:
  ```bash
  git checkout -- libs/frontend-deps/index.js
  ```

  If any project is `MISSING` from the affected graph, `frontend-deps` may be missing from the workspace's `nx.json` `targetDefaults` or each app's `implicitDependencies`. Investigate before continuing.

- [ ] **Step 7.2: Run-many across all six apps**

  Run: `pnpm nx run-many -t build --projects=nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe,onboarding-mfe --configuration=production --skip-nx-cache`
  Expected: all six builds succeed; the final summary line reports `Successfully ran target build for 6 projects`.

- [ ] **Step 7.3: Local-serve render check (manual, ~2 minutes)**

  Run: `pnpm nx serve nestfolio-host`
  Wait for the dev server to print `serving via Native Federation`-style readiness output on port 4200.

  Open `http://localhost:4200/login` in Chrome.

  Verify in DevTools:
  - **Network tab**: `polyfills-*.js` is fetched and is type `module`; `main-*.js` is fetched and is type `module-shim`. (NF rewrote the script tags as designed.)
  - **Console**: zero `Refused to ...` CSP violation entries.
  - **DOM probe**: paste `document.querySelectorAll('input').length` into the console — must return ≥ 1 (login form is rendered).

  Stop the dev server (`Ctrl-C`).

  If any of the three checks fails, re-read the spec §6 and the relevant task step. Do not proceed to the regression-mutation check until local serve renders.

- [ ] **Step 7.4: Regression-mutation check (proves the gate works)**

  Build the shell production bundle if it isn't fresh:
  ```bash
  pnpm nx run nestfolio-host:nf-build --configuration=production --skip-nx-cache
  ```

  Copy the dist `index.html` to a tmp location and mutate it:
  ```bash
  cp dist/apps/nestfolio-host/browser/index.html /tmp/regression.html
  cp /tmp/regression.html dist/apps/nestfolio-host/browser/index.html.orig
  # Drop the polyfills script tag
  node -e "
    const fs = require('fs');
    const p = 'dist/apps/nestfolio-host/browser/index.html';
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/<script\s+type=\"module\"\s+src=\"polyfills-[^\"]+\.js\"\s*><\/script>/, ''));
  "
  ```

  Run the assertion against the mutated dist:
  ```bash
  node scripts/assert-shell-html.mjs dist/apps/nestfolio-host/browser --kind=shell
  echo "exit=$?"
  ```
  Expected: prints `assert-shell-html (shell) rule-1 FAILED: expected 1 <script ...>, found 0` and `exit=1`.

  Restore the original:
  ```bash
  mv dist/apps/nestfolio-host/browser/index.html.orig dist/apps/nestfolio-host/browser/index.html
  node scripts/assert-shell-html.mjs dist/apps/nestfolio-host/browser --kind=shell
  echo "exit=$?"
  ```
  Expected: `assert-shell-html (shell) OK: all rules passed for ...` and `exit=0`.

- [ ] **Step 7.5: No regression in jest tests**

  Run: `pnpm nx run-many -t test --projects=nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe,onboarding-mfe --skip-nx-cache 2>&1 | tail -20`
  Expected: all six test targets pass. (TS resolution must still work for `@nestfolio/shell/{auth,graphql,i18n}` imports inside specs.)

  If a test fails because a subpath import doesn't resolve, recheck Task 4 — the wildcard line was likely deleted.

- [ ] **Step 7.6: Final state check**

  Run: `git log --oneline main..HEAD`
  Expected: 9 commits (1 spec already on `main` before branch + 8 task commits: 1 assertion, 1 lockfile, 1 frontend-deps, 1 tsconfig, 1 shell project.json, 5 MFE project.json — that's 9. If anything else got committed inadvertently, investigate.)

  Run: `git diff main --stat | tail -20`
  Expected: only the files in the file-map at the top of this plan are modified or created.

- [ ] **Step 7.7: Push the branch (do NOT open a PR yet)**

  Run: `git push -u origin feat/b2-federation-mechanical-fixes`
  Expected: branch published.

  Do not open a PR or merge — that's a user-driven decision. The plan ends here.

---

## Self-review (executed by plan author at write-time, not by executor)

**Spec coverage:**
- §6.1 frontend-deps edits → Task 3 ✓
- §6.2 tsconfig keys → Task 4 ✓
- §6.3 project.json polyfills + build-chain rename → Tasks 5 + 6 ✓
- §6.4 assert-shell-html.mjs → Task 1 ✓
- §6.5 package.json devDeps → Task 2 ✓
- §7 verification steps 1–6 → Task 7 ✓
- §8 success criteria → all six map to Task 7 sub-steps ✓

**Placeholder scan:** No "TBD" / "TODO" / "implement later". Every code block is complete. Every command has expected output. The MFE recipe in Task 6 deliberately repeats the structure once (Step 6.1) rather than only describing it abstractly, then references the recipe for 6.2–6.5; this was a tradeoff against verbosity but stays within "engineer can read tasks out of order" — each step still names the exact file and the exact assertion command.

**Type consistency:** Build-target name `nf-build` used identically across Tasks 5 and 6 and the recipe. `--kind=shell` only on Task 5; `--kind=mfe` only on Task 6.

**No-action items found.**

---

## Out of scope (restated from spec)

- Federation manifest swap (`federation.manifest.json` dev/prod selection). B1 + B4.
- Per-app `config` and `deploy` Nx targets. A4 + B1 + B4.
- CDK stack changes in `services/investor/investor-web`. B1 + B4.
- `provideAuth` factory-injection refactor. A4.
- Native Federation v4 migration. Charter §3 non-goal.
- Playwright behavioural verification. Phase C.
