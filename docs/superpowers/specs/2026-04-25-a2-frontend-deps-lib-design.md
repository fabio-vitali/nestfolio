# A2 — `@nestfolio/frontend-deps` lib extraction — design

**Status:** Approved
**Author:** fabio-vitali + Claude
**Date:** 2026-04-25
**Type:** Sub-plan design under the MFE charter migration roadmap.
**References:**
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) — Pillar 2 + §5 row 7
- Roadmap: [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) — A2

## 1. Problem

Six federation config files (`apps/nestfolio-host/federation.config.js` + the five `apps/*-mfe/federation.config.js`) each hand-declare a `share({...})` block of shared singleton packages. The blocks drift:

- Four configs (shell, `advisory-mfe`, `dashboard-mfe`, `ledger-mfe`) list the same 21 packages.
- `investor-mfe` and `onboarding-mfe` list those 21 + `@ag-ui/client` + `@copilotkitnext/angular`.
- The shell's list is **not** a superset of `onboarding-mfe`'s list — the shell lacks the two CopilotKit packages while `onboarding-mfe` requires them as singletons.

This directly violates the charter's Pillar 2 invariant:

> "The shell's set must be a *superset* of every MFE's set; this is enforced mechanically, not by convention."

It also violates §5 row 7:

> "Federation contract (singleton surface declaration, manifest schema) — workspace-lib (`@nestfolio/frontend-deps`) — One file controls drift; every app's federation.config requires it."

A2 closes both gaps in one move.

## 2. Goals

- One single-source-of-truth module declares the entire singleton surface + shared mappings.
- Every app's `federation.config.js` obtains both from that module; no ad-hoc `share(...)` block remains.
- Shell ⊇ every MFE holds **by identity** — all seven configs spread the same constant.
- Migration is a single atomic PR; zero runtime deploy coupling.

## 3. Non-goals

- Build-time superset assertion (deferred to B2 alongside `assert-shell-html.mjs`).
- Native Federation v4 migration (charter §3 non-goal; requires wrapper upgrade + CJS→ESM of every federation config; separate spec).
- Angular zoneless migration (orthogonal to the singleton surface; `@copilotkitnext/angular@1.54.x` is a real blocker for zoneless in `onboarding-mfe` but does not affect what A2 ships).
- `shareAll()` auto-wiring (rejected: root `package.json` mixes frontend + backend `dependencies`; a positive hand-list is the correct filter here).
- Apollo-per-MFE factory (B3).
- CSP/shell-deploy concerns (A1 shipped; B4 deploys).

## 4. Decisions

### 4.1 Lib physical shape

```
libs/frontend-deps/
├─ package.json      { "name": "@nestfolio/frontend-deps", "version": "0.0.1", "main": "index.js", "private": true }
├─ project.json      Nx library project with `lint` target only
└─ index.js          CJS module exporting { sharedFrontendDeps, sharedMappings }
```

- CJS, not TS. `federation.config.js` is CommonJS loaded by node at build time; resolution goes through pnpm's workspace symlink graph, not `tsconfig.base.json` paths. Matches the `@nestfolio/event-types` precedent.
- No `build` target (nothing to compile). No `test` target (nothing to unit-test — 23 declarative entries). `lint` target only, to catch syntax regressions.
- No `tsconfig.base.json` path entry. The package is discovered via `pnpm-workspace.yaml` (`libs/*` already covered).
- `"private": true` prevents accidental publication.
- `"version": "0.0.1"` pinned; workspace resolution is symlink-based, version has no practical effect.

### 4.2 Export surface

`libs/frontend-deps/index.js`:

```js
const { share } = require('@angular-architects/native-federation/config');

const sharedFrontendDeps = share({
  '@angular/animations':               { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/cdk':                      { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/common':                   { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/core':                     { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/forms':                    { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/platform-browser':         { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/platform-browser-dynamic': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/router':                   { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/service-worker':           { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngrx/signals':                     { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngx-translate/core':               { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngx-translate/http-loader':        { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@primeuix/themes':                  { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-amplify':                       { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@apollo/client':                    { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-appsync-auth-link':             { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-appsync-subscription-link':     { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'graphql':                           { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'primeicons':                        { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'primeng':                           { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'rxjs':                              { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ag-ui/client':                     { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@copilotkitnext/angular':           { singleton: true, strictVersion: true, requiredVersion: 'auto' },
});

const sharedMappings = ['@nestfolio/ui', '@nestfolio/shell'];

module.exports = { sharedFrontendDeps, sharedMappings };
```

23 singleton entries. `share()` is invoked once in the lib — all federation-metadata normalization happens in a single place. Call-site is a trivial spread.

### 4.3 Single flat union — no overlays, no builder

The 23-entry union is one flat set. Every app consumes the full set. No `baseDeps` + `copilotKitDeps` partitioning, no builder-function flags, no opt-in primitives.

Rationale:
- Shell ⊇ every MFE becomes identity: all seven configs spread the same constant.
- Forward-looking: any MFE may adopt conversational AI (`@ag-ui/client` / `@copilotkitnext/angular`) without a federation-config edit.
- Zero runtime cost: federation singleton declarations are metadata — an MFE that never imports a declared singleton pays nothing for the declaration.
- `requiredVersion: 'auto'` resolves against the root `package.json` (which holds both deps), so the declaration resolves cleanly in every app.

### 4.4 Per-app migration — six configs collapse to one pattern

**Shell** (`apps/nestfolio-host/federation.config.js`):

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

**Each MFE** (`apps/<mfe>-mfe/federation.config.js`):

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: '<mfe>-mfe',
  exposes: { './routes': 'apps/<mfe>-mfe/src/app/remote-routes.ts' },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

The five MFE files become byte-identical except `name` and the path in `exposes.'./routes'`.

### 4.5 Enforcement strategy — trust the constant

No build-time assertion ships in A2. Enforcement is the fact that every `federation.config.js` spreads the same imported constant. Drift would require deliberately bypassing the import (a reviewable code-change signal, not a silent config drift).

A lightweight lint rule or build-time superset checker is a reasonable B2 addition, co-located with B2's `assert-shell-html.mjs` CSP-hash guard. Not worth the machinery in A2 where the constant *is* the enforcement.

## 5. Effects of the migration

### What changes in the emitted federation metadata

| App | Singleton-surface delta |
|---|---|
| `nestfolio-host` | **+2** — `@ag-ui/client`, `@copilotkitnext/angular` (closes the Pillar 2 violation) |
| `advisory-mfe`   | **+2** — same |
| `dashboard-mfe`  | **+2** — same |
| `ledger-mfe`     | **+2** — same |
| `investor-mfe`   | byte-identical (already declared them, though nothing imports them in its `src/`) |
| `onboarding-mfe` | byte-identical (actively imports them) |

`@ag-ui/client` and `@copilotkitnext/angular` will appear in the shell's and three non-CopilotKit MFEs' `federation-info.json`. This is intentional and desired — forward-looking coverage for future conversational-AI features.

### What shrinks

Each of the 6 `federation.config.js` files drops from ~38 lines to ~10 lines.

### What does NOT change

- Apollo topology (B3's job).
- CSP (A1 shipped).
- `sharedMappings` content (same two entries, now sourced from the lib).
- Build pipeline, Nx targets, CDK stacks, deploy scripts.

## 6. Verification

Confidence comes from build + diff inspection, not from unit tests.

1. `pnpm install` — verifies pnpm wires `@nestfolio/frontend-deps` as a workspace symlink; `pnpm-lock.yaml` records the new workspace package.
2. `pnpm nx build nestfolio-host advisory-mfe dashboard-mfe ledger-mfe investor-mfe onboarding-mfe` — all six builds succeed with no new warnings.
3. Compare `federation-info.json` (or equivalent emitted metadata) before vs after for each app — diffs match the table in §5.
4. `pnpm nx serve nestfolio-host` — shell renders without new federation console warnings about missing singletons.
5. Spot-check import: `node -e "console.log(Object.keys(require('@nestfolio/frontend-deps').sharedFrontendDeps).length)"` → `23`.

## 7. Rollout

One PR, atomic:

1. `libs/frontend-deps/{package.json,project.json,index.js}` — create the lib.
2. `pnpm install` — wires the workspace package.
3. Edit all 6 `apps/*/federation.config.js` — replace hand-written `share({...})` blocks with the lib import + spread.
4. In every app config, the require becomes `const { withNativeFederation } = require('@angular-architects/native-federation/config');` — `share` is no longer destructured at the call site (the lib internalizes it).
5. Run §6 verification locally.
6. Land to `main`. No deploy coupling — the lib is read only by the federation build-time config loader.

## 8. Open questions deferred to later specs

- **Zoneless migration.** `@copilotkitnext/angular@1.54.x` calls `NgZone.run()` / `runOutsideAngular()` internally (via CDK-derived scroll/resize helpers) and declares `@angular/cdk ^19` + `@angular/core ^19` peers — incompatible with Angular 21 zoneless in `onboarding-mfe`. The other four MFEs + shell are zoneless-feasible today. Separate spec.
- **Native Federation v4.** No Angular wrapper yet consumes `@softarc/native-federation@4.0.0`; v4 is pure ESM and would require migrating every `federation.config.js` (+ this lib) from CJS to ESM. Separate spec.
- **Build-time superset assertion.** Revisit in B2.
- **`shareAll()`-style auto-wiring.** Revisit if the monorepo ever splits `package.json` per-app (not planned).

## 9. Acceptance criteria

A2 is done when:

- `libs/frontend-deps/` exists with `package.json`, `project.json`, `index.js` matching §4.1–§4.2.
- All six `apps/*/federation.config.js` match the pattern in §4.4 — no hand-written `share({...})` blocks remain.
- All six app builds succeed.
- The shell's singleton surface includes `@ag-ui/client` and `@copilotkitnext/angular` (per emitted federation metadata).
- Charter Pillar 2 + §5 row 7 are satisfied: one module declares the surface; shell ⊇ every MFE by identity.
