# A2 — `@nestfolio/frontend-deps` lib — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Native Federation singleton-surface + sharedMappings declaration into a single workspace lib (`@nestfolio/frontend-deps`) and migrate all 6 `federation.config.js` files to consume it, making charter Pillar 2's "shell ⊇ every MFE" rule an identity by construction.

**Architecture:** New CJS-only workspace lib at `libs/frontend-deps/` (no TS, no build target, `lint` target only) exporting `{ sharedFrontendDeps, sharedMappings }`. Every `federation.config.js` imports this module and spreads the same two values — eliminating drift across shell + 5 MFEs. No build-time assertion yet (trust-the-constant; revisit in B2). No runtime behaviour change beyond the shell's singleton surface gaining `@ag-ui/client` + `@copilotkitnext/angular` (closing the existing Pillar 2 violation against `onboarding-mfe`).

**Tech Stack:** Nx 21.x, pnpm workspaces, `@angular-architects/native-federation@^21.2.0` (which transitively pins `@softarc/native-federation ~3.5.1`), CommonJS config files consumed at build time by the Angular-Architects esbuild-federation plugin.

**Spec:** [`docs/superpowers/specs/2026-04-25-a2-frontend-deps-lib-design.md`](../specs/2026-04-25-a2-frontend-deps-lib-design.md)

---

## File Structure

**Created:**
- `libs/frontend-deps/package.json` — workspace package manifest (name, version, main, private)
- `libs/frontend-deps/project.json` — Nx library project with `lint` target only
- `libs/frontend-deps/index.js` — CJS module exporting `{ sharedFrontendDeps, sharedMappings }`
- `libs/frontend-deps/README.md` — one-screen explainer: what it owns, the Pillar 2 invariant, the "no ad-hoc share() elsewhere" rule

**Modified:**
- `apps/nestfolio-host/federation.config.js` — replace hand-written `share({...})` + `sharedMappings` literal with imports from `@nestfolio/frontend-deps`
- `apps/advisory-mfe/federation.config.js` — same pattern
- `apps/dashboard-mfe/federation.config.js` — same pattern
- `apps/ledger-mfe/federation.config.js` — same pattern
- `apps/investor-mfe/federation.config.js` — same pattern
- `apps/onboarding-mfe/federation.config.js` — same pattern

**Possibly touched (lockfile):**
- `pnpm-lock.yaml` — pnpm records the new workspace package

**Not touched:**
- `tsconfig.base.json` (lib is consumed at build time by CJS configs, not by TS source — no path alias needed)
- `pnpm-workspace.yaml` (already globs `libs/*`)
- Any app's `project.json` (federation config is already wired via `@angular-architects/native-federation` builder)
- Shell's `index.html`, `csp.txt`, CDK stacks

---

## Task 1: Create `@nestfolio/frontend-deps` lib scaffolding

**Files:**
- Create: `libs/frontend-deps/package.json`
- Create: `libs/frontend-deps/project.json`
- Create: `libs/frontend-deps/index.js`
- Create: `libs/frontend-deps/README.md`

- [ ] **Step 1: Create `libs/frontend-deps/package.json`**

Write this exact content to `libs/frontend-deps/package.json`:

```json
{
  "name": "@nestfolio/frontend-deps",
  "version": "0.0.1",
  "main": "index.js",
  "private": true
}
```

- [ ] **Step 2: Create `libs/frontend-deps/project.json`**

Write this exact content to `libs/frontend-deps/project.json`:

```json
{
  "name": "frontend-deps",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/frontend-deps",
  "projectType": "library",
  "targets": {
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:shared", "type:lib"]
}
```

Notes for reviewer:
- `sourceRoot` points at the lib root (not `libs/frontend-deps/src`) because the lib is a single `index.js` file at root — there is no `src/` subdir.
- `scope:shared` matches `libs/shell` and `libs/ui`; workspace ESLint module-boundary rules allow `scope:shared` libs to depend on `scope:shared` + `scope:platform`.
- `lint` is the only target. No `build` (nothing to compile). No `test` (23 declarative entries have nothing to unit-test; build-time verification in Task 5 is the acceptance gate).

- [ ] **Step 3: Create `libs/frontend-deps/index.js`**

Write this exact content to `libs/frontend-deps/index.js`:

```js
const { share } = require('@angular-architects/native-federation/config');

const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };

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
  '@primeuix/themes': singletonOpts,
  'aws-amplify': singletonOpts,
  '@apollo/client': singletonOpts,
  'aws-appsync-auth-link': singletonOpts,
  'aws-appsync-subscription-link': singletonOpts,
  'graphql': singletonOpts,
  'primeicons': singletonOpts,
  'primeng': singletonOpts,
  'rxjs': singletonOpts,
  '@ag-ui/client': singletonOpts,
  '@copilotkitnext/angular': singletonOpts,
});

const sharedMappings = ['@nestfolio/ui', '@nestfolio/shell'];

module.exports = { sharedFrontendDeps, sharedMappings };
```

Notes for reviewer:
- 23 singleton entries. The `singletonOpts` constant deduplicates the repeated `{ singleton: true, strictVersion: true, requiredVersion: 'auto' }` — same semantics as the current per-app configs, just DRY.
- `share()` is invoked **once** here. Call sites in app configs spread `sharedFrontendDeps` without re-calling `share()`.
- `sharedMappings` lists `@nestfolio/ui` + `@nestfolio/shell` — byte-identical to what all 6 configs use today.

- [ ] **Step 4: Create `libs/frontend-deps/README.md`**

Write this exact content to `libs/frontend-deps/README.md`:

```markdown
# @nestfolio/frontend-deps

Single source of truth for the Native Federation singleton surface consumed by every frontend app in this workspace (shell + 5 MFEs).

## Exports

- `sharedFrontendDeps` — the 23-entry `share({...})` result declaring every singleton package.
- `sharedMappings` — the `['@nestfolio/ui', '@nestfolio/shell']` array consumed by `withNativeFederation`'s `sharedMappings` option.

## Usage

Every `apps/*/federation.config.js` imports both values and spreads them:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  // ...app-specific name/exposes...
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

## Invariant — enforced by construction

Charter Pillar 2 (`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`) requires:

> The shell's singleton set must be a *superset* of every MFE's.

Because every `federation.config.js` in the workspace spreads the same `sharedFrontendDeps`, the sets are **identical** — the superset relation holds trivially. Do not add ad-hoc `share({...})` blocks in any `federation.config.js`; add the dependency here instead. Drift is only possible by bypassing this module.

## Adding a new shared singleton

1. Ensure the package is in the root `package.json` `dependencies`.
2. Add a line to `sharedFrontendDeps` here: `'<package>': singletonOpts`.
3. Rebuild every app (`pnpm nx run-many -t build -p nestfolio-host,advisory-mfe,dashboard-mfe,investor-mfe,ledger-mfe,onboarding-mfe`).

## Why not `shareAll()`?

`@softarc/native-federation/config` exposes `shareAll()` which auto-declares every `dependencies` entry from the nearest `package.json`. Rejected for this monorepo because the root `package.json` is a union of frontend + backend deps — `shareAll()` would over-share. The hand-curated list here **is** the singleton contract.
```

- [ ] **Step 5: Verify the lib is syntactically valid**

Run:
```bash
node --check libs/frontend-deps/index.js
```

Expected output: (silent — exit code 0). A syntax error would print a stack trace.

- [ ] **Step 6: Commit**

```bash
git add libs/frontend-deps/
git commit -m "feat(a2-frontend-deps): scaffold @nestfolio/frontend-deps lib

Single source of truth for the federation singleton surface + sharedMappings.
Consumed by every apps/*/federation.config.js (wired in follow-up commits).
No Nx build target; lint only. See README for the Pillar 2 invariant."
```

---

## Task 2: Wire the workspace package

**Files:**
- Modify: `pnpm-lock.yaml` (mechanical — `pnpm install` writes it)

- [ ] **Step 1: Install workspace dependencies**

Run:
```bash
pnpm install
```

Expected output: ends with a "done" line. `pnpm-lock.yaml` may be updated to record `@nestfolio/frontend-deps` as a workspace package. No npm registry fetches should happen for this package (it's workspace-resolved).

- [ ] **Step 2: Verify node can resolve the package from an app directory**

Run:
```bash
node -e "const m = require('@nestfolio/frontend-deps'); console.log('keys:', Object.keys(m.sharedFrontendDeps).length, 'mappings:', m.sharedMappings.length);"
```

Expected output:
```
keys: 23 mappings: 2
```

If the count isn't 23 or require fails, the install didn't wire the package — check `pnpm-workspace.yaml` globs (should already include `libs/*`) and re-run `pnpm install`.

- [ ] **Step 3: Verify Nx picks up the new project**

Run:
```bash
pnpm nx show project frontend-deps --json
```

Expected output: JSON containing `"name": "frontend-deps"`, `"projectType": "library"`, and a `targets.lint` entry. If Nx says the project doesn't exist, Nx's project graph cache may need a reset: `pnpm nx reset` then retry.

- [ ] **Step 4: Commit any lockfile changes**

Check for changes:
```bash
git status pnpm-lock.yaml
```

If `pnpm-lock.yaml` changed:
```bash
git add pnpm-lock.yaml
git commit -m "chore(a2-frontend-deps): record @nestfolio/frontend-deps workspace package in lockfile"
```

If unchanged, skip the commit and move on.

---

## Task 3: Migrate `nestfolio-host` federation config

**Files:**
- Modify: `apps/nestfolio-host/federation.config.js` (full rewrite — ~34 lines → ~9 lines)

- [ ] **Step 1: Rewrite the shell's federation config**

Replace the entire contents of `apps/nestfolio-host/federation.config.js` with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

Notes for reviewer:
- The shell config has no `name` and no `exposes` (it's the host, not a remote). That matches the current file.
- The `share` named import is removed (no longer destructured at the call site — the lib internalizes `share()`).
- The spread-into-a-new-object (`{ ...sharedFrontendDeps }`) preserves existing call-site shape; `withNativeFederation` expects a plain object in `shared`.

- [ ] **Step 2: Build the shell**

Run:
```bash
pnpm nx build nestfolio-host
```

Expected output: successful build, no errors. Warnings about shared singletons (if any) should be identical in kind to pre-migration — no *new* warnings about missing singleton declarations.

If the build fails with "Cannot find module '@nestfolio/frontend-deps'", Task 2's `pnpm install` didn't wire the package — re-run it.

- [ ] **Step 3: Inspect the emitted federation info for the shell**

Find and read the emitted manifest:
```bash
find dist/apps/nestfolio-host -name 'federation.manifest.json' -o -name 'remoteEntry.json' -o -name 'federation-info.json' 2>/dev/null | head -5
```

Then read the first file found and confirm `@ag-ui/client` and `@copilotkitnext/angular` appear in the shell's shared-packages list. Pre-migration the shell lacked both — gaining them is the actual Pillar 2 violation being closed by A2.

If no federation-info file exists in `dist/`, the build output location may differ — check `apps/nestfolio-host/project.json` `build.options.outputPath`. The exact filename varies by `@angular-architects/native-federation` version; the goal is just to confirm the two packages now appear in the shell's emitted shared surface.

- [ ] **Step 4: Commit**

```bash
git add apps/nestfolio-host/federation.config.js
git commit -m "feat(a2-frontend-deps): migrate nestfolio-host federation config to @nestfolio/frontend-deps

Shell's singleton surface now includes @ag-ui/client + @copilotkitnext/angular
(previously declared only in investor-mfe and onboarding-mfe), closing the
Pillar 2 violation against onboarding-mfe which actively imports CopilotKit."
```

---

## Task 4: Migrate all 5 MFE federation configs

**Files:**
- Modify: `apps/advisory-mfe/federation.config.js`
- Modify: `apps/dashboard-mfe/federation.config.js`
- Modify: `apps/investor-mfe/federation.config.js`
- Modify: `apps/ledger-mfe/federation.config.js`
- Modify: `apps/onboarding-mfe/federation.config.js`

All five MFE configs collapse to the same template — only `name` and `exposes.'./routes'` vary.

- [ ] **Step 1: Rewrite `apps/advisory-mfe/federation.config.js`**

Replace the entire contents with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'advisory-mfe',
  exposes: {
    './routes': 'apps/advisory-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

- [ ] **Step 2: Rewrite `apps/dashboard-mfe/federation.config.js`**

Replace the entire contents with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'dashboard-mfe',
  exposes: {
    './routes': 'apps/dashboard-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

- [ ] **Step 3: Rewrite `apps/investor-mfe/federation.config.js`**

Replace the entire contents with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'investor-mfe',
  exposes: {
    './routes': 'apps/investor-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

Note for reviewer: investor-mfe's pre-migration config declared `@ag-ui/client` + `@copilotkitnext/angular` directly. Post-migration those declarations move into `sharedFrontendDeps` (via the lib). Net singleton surface for this app is unchanged.

- [ ] **Step 4: Rewrite `apps/ledger-mfe/federation.config.js`**

Replace the entire contents with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'ledger-mfe',
  exposes: {
    './routes': 'apps/ledger-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

- [ ] **Step 5: Rewrite `apps/onboarding-mfe/federation.config.js`**

Replace the entire contents with:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'onboarding-mfe',
  exposes: {
    './routes': 'apps/onboarding-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

Note for reviewer: onboarding-mfe's pre-migration config also declared `@ag-ui/client` + `@copilotkitnext/angular`. Same migration dynamics as investor-mfe — net surface unchanged.

- [ ] **Step 6: Verify all five rewritten files are syntactically valid**

Run:
```bash
node --check apps/advisory-mfe/federation.config.js && \
  node --check apps/dashboard-mfe/federation.config.js && \
  node --check apps/investor-mfe/federation.config.js && \
  node --check apps/ledger-mfe/federation.config.js && \
  node --check apps/onboarding-mfe/federation.config.js && \
  echo "all five federation configs valid"
```

Expected output: `all five federation configs valid`. Any syntax error will print a stack trace and abort the chain.

- [ ] **Step 7: Build all five MFEs together**

Run:
```bash
pnpm nx run-many -t build -p advisory-mfe,dashboard-mfe,investor-mfe,ledger-mfe,onboarding-mfe
```

Expected output: all five targets succeed. Watch for any *new* federation singleton warnings that were not present pre-migration.

If a single MFE build fails with "Cannot find module '@nestfolio/frontend-deps'" while the shell build from Task 3 succeeded, the project graph may be stale: `pnpm nx reset` and retry.

- [ ] **Step 8: Commit**

```bash
git add apps/advisory-mfe/federation.config.js \
        apps/dashboard-mfe/federation.config.js \
        apps/investor-mfe/federation.config.js \
        apps/ledger-mfe/federation.config.js \
        apps/onboarding-mfe/federation.config.js
git commit -m "feat(a2-frontend-deps): migrate all 5 MFE federation configs to @nestfolio/frontend-deps

Every MFE config now collapses to {name, exposes, shared: {...sharedFrontendDeps}, sharedMappings}.
Pillar 2's shell ⊇ every MFE rule is now an identity: all six configs spread the
same constant. No ad-hoc share({...}) blocks remain in the workspace."
```

---

## Task 5: Final verification — all six apps build together

**Files:**
- No file changes. Verification-only task.

- [ ] **Step 1: Full affected build**

Run:
```bash
pnpm nx run-many -t build -p nestfolio-host,advisory-mfe,dashboard-mfe,investor-mfe,ledger-mfe,onboarding-mfe
```

Expected output: all six targets succeed in one run. Nx may serve cached results for apps already built in Tasks 3–4 — that's fine, it means no state has drifted since.

- [ ] **Step 2: Verify no ad-hoc `share(` calls remain in `apps/*/federation.config.js`**

Run:
```bash
grep -l 'share(' apps/*/federation.config.js || echo "no ad-hoc share() calls — good"
```

Expected output: `no ad-hoc share() calls — good`.

If any file is listed, that file still has a hand-written `share({...})` block — re-check Task 3 or Task 4 for that app.

- [ ] **Step 3: Verify every `apps/*/federation.config.js` requires the lib**

Run:
```bash
grep -L "require('@nestfolio/frontend-deps')" apps/*/federation.config.js || echo "every app consumes the lib — good"
```

Expected output: `every app consumes the lib — good`.

If any file is listed, that file does not import from `@nestfolio/frontend-deps` — re-check Task 3 (for `nestfolio-host`) or Task 4 (for MFEs).

- [ ] **Step 4: Verify emitted federation metadata (shell gains 2 singletons)**

Locate the shell's emitted federation manifest:
```bash
find dist/apps/nestfolio-host -name 'federation*.json' 2>/dev/null
```

Read each file found and confirm both `@ag-ui/client` and `@copilotkitnext/angular` appear in the shell's shared-packages list. (Pre-migration the shell lacked both.)

Also confirm the shell's shared set is a superset of every MFE's:
```bash
for app in advisory-mfe dashboard-mfe investor-mfe ledger-mfe onboarding-mfe; do
  echo "=== $app ==="
  find "dist/apps/$app" -name 'federation*.json' 2>/dev/null
done
```

For each MFE manifest found, visually confirm the set of `sharedPackages` is ⊆ the shell's. Because every config spreads the same `sharedFrontendDeps`, the sets should in fact be identical. If any MFE shows a singleton the shell lacks, Task 3 (shell) did not land correctly.

- [ ] **Step 5: Clean up dist if desired**

Optional — remove build output before pushing:
```bash
rm -rf dist/apps/nestfolio-host dist/apps/advisory-mfe dist/apps/dashboard-mfe dist/apps/investor-mfe dist/apps/ledger-mfe dist/apps/onboarding-mfe
```

- [ ] **Step 6: Acceptance checklist (from spec §9)**

Confirm each is satisfied:
- [x] `libs/frontend-deps/` exists with `package.json`, `project.json`, `index.js`, `README.md` — created in Task 1.
- [x] All six `apps/*/federation.config.js` match the pattern — enforced by Task 5 Step 2 + Step 3.
- [x] All six app builds succeed — Task 5 Step 1.
- [x] Shell's singleton surface includes `@ag-ui/client` + `@copilotkitnext/angular` — Task 5 Step 4.
- [x] Charter Pillar 2 + §5 row 7 satisfied: one module declares the surface; shell ⊇ every MFE by identity — enforced by Tasks 3 + 4 + verified by Task 5 Step 4.

- [ ] **Step 7: Final commit (if any stragglers)**

Check for any remaining unstaged or untracked changes:
```bash
git status
```

If everything is clean, nothing to commit. If a lockfile change or stray file appeared, stage and commit with:
```bash
git add <files>
git commit -m "chore(a2-frontend-deps): finalize migration"
```

Otherwise the four existing commits (Task 1, optional Task 2 lockfile, Task 3, Task 4) form the complete landing unit.

---

## Rollback

If anything is unrecoverable mid-plan, revert cleanly:

```bash
git reset --hard HEAD~4   # back to the pre-A2 commit (adjust N if fewer commits landed)
pnpm install               # restore lockfile state
pnpm nx reset              # clear Nx project graph cache
```

The lib is additive; reverting removes it entirely with no residue.
