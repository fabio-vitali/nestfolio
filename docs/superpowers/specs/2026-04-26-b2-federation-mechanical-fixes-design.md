# B2 — Federation mechanical fixes — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-26
**Scope:** Phase B2 of the MFE charter migration roadmap.
**Charter invariants honoured:** Pillar 2 (isolation / singleton surface) — making "shell ⊇ every MFE" mechanical rather than conventional.
**Predecessors (already shipped):**
- A1 — `apps/nestfolio-host/csp.txt` single-source CSP (2026-04-24).
- A2 — `@nestfolio/frontend-deps` workspace lib + per-app `federation.config.js` consumption (2026-04-25, merge `3fabbf9c`).
**Predecessor (informational):** [`2026-04-23-shell-render-restoration-design.md`](./2026-04-23-shell-render-restoration-design.md) §1 + §5.

## 1. Problem

A1 and A2 collapsed the singleton surface to a single declared module. Every app's `federation.config.js` now spreads `sharedFrontendDeps` from `@nestfolio/frontend-deps`. But the runtime mechanics that make the federation actually load remain broken:

- Native Federation needs `es-module-shims` registered in the browser before `<script type="module-shim" src="main-*.js">` resolves. The polyfill is absent from every app's `project.json`.
- Several singleton-shared npm packages have subpath imports (`@primeuix/themes/aura`, `graphql/language/printer.js`, `aws-appsync-*` internals) that NF's import map will not advertise without `includeSecondaries: true`. Today none of them carry that flag — which means an MFE loaded into the shell can request a subpath the import map doesn't know about and trip a resolution throw.
- The `url` bare specifier (declared by `aws-appsync-subscription-link@4.0.1` as a runtime dep — it is the browser-safe `url@^0.11.0` npm package, not a Node built-in) is not in the singleton surface. NF refuses to resolve any bare specifier outside its declared `shared` set.
- The `sharedMappings` workspace-lib subpath bridge declares only `@nestfolio/ui` and `@nestfolio/shell`. NF's `mapped-paths.js:27` does literal string match against `tsconfig.compilerOptions.paths` keys, so `@nestfolio/shell/auth` is invisible to it. Three subpaths are actively imported at runtime by app code: `@nestfolio/shell/auth`, `@nestfolio/shell/graphql`, `@nestfolio/shell/i18n`. `@nestfolio/ui/feature-flags` is also imported but its tsconfig key is already explicit.
- There is no build-time guard that would catch a future regression in any of the above. The shell-render-broken family of bugs reached production precisely because the failure mode is silent: a CSP violation, a missing `<script>` tag, or a malformed `esms-options` payload all manifest as a blank page with one console line.

## 2. Goals

- `pnpm nx serve nestfolio-host` and `pnpm nx serve-static nestfolio-host` produce a renderable `/login` page independent of MFE resolution.
- A single edit to `libs/frontend-deps/index.js` propagates correctly to all six federation configs (verifiable via `pnpm nx affected --target=build`).
- A build-time assertion fails the build if any of the five Native Federation post-build invariants regress: polyfill `<script>` shape, main-shim `<script>` shape, esms-options `<script>` shape, esms-options JSON body, esms-options sha256-hash equality with the CSP meta tag.
- The fixes are mechanically derived from the 2026-04-23 spec §1; this spec adapts them to the post-A2 single-source state without re-deciding architecture.

## 3. Non-goals

- §1.5 manifest swap (`federation.manifest.json` dev-vs-prod selection via per-configuration `assets` entries). Tightly coupled to deploy topology and same-origin URLs; deferred to B1 + B4.
- §1.2a singleton parity. Already an identity guarantee from A2 — every app spreads the same `sharedFrontendDeps` object.
- §3 deploy targets, §4 CDK refactor, §3.0 factory-based `provideAuth`. Belong to A4 + B1 + B4.
- Native Federation v4 migration. Charter §3 keeps v21.2.x.
- Playwright behavioural verification. Deferred to Phase C.
- Removal of `@copilotkitnext/angular` from the singleton surface. A2 shipped it because at least one app imports `@ag-ui/client`. Per memory `feedback_no_deprecation.md`, dev is disposable; if a future audit confirms zero imports, removal is a one-line change. Out of scope here.

## 4. High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| `es-module-shims` delivery | Add to `esbuild.options.polyfills` array per app | Matches NF init schematic; bundles into `polyfills-*.js`; no `<script src>` in `index.html.tmpl` |
| `includeSecondaries` flag | Set on `@primeuix/themes`, `graphql`, `aws-appsync-auth-link`, `aws-appsync-subscription-link` in `frontend-deps` | NF `SharedConfig.includeSecondaries: boolean` is package-level — flips all subpaths on for the package. Single source via `frontend-deps` makes this one edit for six apps. |
| `url` specifier | Singleton-shared in `frontend-deps`; promoted from transitive to direct dep in root `package.json` | NF resolves bare specifiers via the import map only; transitive pnpm hoisting is non-deterministic |
| `sharedMappings` expansion | Add `@nestfolio/ui/feature-flags`, `@nestfolio/shell/auth`, `@nestfolio/shell/graphql`, `@nestfolio/shell/i18n` to `frontend-deps` | Literal-string match in NF; mirrors imports actually present in app code |
| `tsconfig.base.json` subpath keys | Three explicit keys for shell subpaths; existing `/* ` wildcard kept as Jest fallback | NF reads `paths` keys; Jest's `moduleNameMapper` keeps wildcard semantics for tests |
| `@nestfolio/shell/testing` | Not added to `sharedMappings` | Test-only export; must not bundle into a browser artefact |
| Build-time guard | `scripts/assert-shell-html.mjs` + Nx composite `build` target chain (`nf-build` → `assert`) | Spec §5 designed it to gate exactly the regression class A1+A2+B2 fix |
| Guard scope | Shell enforces all 5 rules; MFEs enforce rules 1–4 only | MFE `index.html` artefacts are not browser-served (loaded as `remoteEntry.json` deps), so no CSP meta tag |
| Rollout | All six apps in one branch | `frontend-deps` edits affect every app at the next build regardless; partial rollout is a fiction |

## 5. Architecture

```
libs/frontend-deps/index.js                 tsconfig.base.json
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ sharedFrontendDeps:          │            │ paths:                      │
│   …23 singletons…            │            │   "@nestfolio/shell"        │
│   url: singletonOpts         │ ◄─consume─ │   "@nestfolio/shell/auth"   │
│   includeSecondaries on:     │            │   "@nestfolio/shell/graphql"│
│     - @primeuix/themes       │            │   "@nestfolio/shell/i18n"   │
│     - graphql                │            │   "@nestfolio/shell/*"      │
│     - aws-appsync-auth-link  │            │     (Jest fallback)         │
│     - aws-appsync-           │            │   "@nestfolio/ui/           │
│       subscription-link      │            │     feature-flags"          │
│ sharedMappings:              │            │     (already present)       │
│   '@nestfolio/ui'            │            └─────────────────────────────┘
│   '@nestfolio/ui/            │
│     feature-flags'           │            apps/*/project.json
│   '@nestfolio/shell'         │            ┌─────────────────────────────┐
│   '@nestfolio/shell/auth'    │            │ esbuild.options.polyfills   │
│   '@nestfolio/shell/graphql' │            │   = ["es-module-shims"]     │
│   '@nestfolio/shell/i18n'    │            │ targets:                    │
└──────────────────────────────┘            │   nf-build (was 'build')    │
                                            │   build = composite:        │
                                            │     dependsOn ['nf-build']  │
                                            │     runs assert-shell-html  │
                                            │   serve-static.buildTarget  │
                                            │     → nf-build              │
                                            └─────────────────────────────┘

scripts/assert-shell-html.mjs              package.json (root)
┌──────────────────────────────┐           ┌─────────────────────────────┐
│ Args: <distDir> --kind=…     │           │ devDependencies:            │
│ Reads: dist/.../index.html   │           │   es-module-shims: ^1.5.12  │
│                              │           │   url: ^0.11.0              │
│ Rules (shell + mfe):         │           │     (promoted from          │
│   1. one polyfills.js,       │           │      transitive)            │
│      type=module             │           └─────────────────────────────┘
│   2. one main.js,
│      type=module-shim
│   3. one esms-options inline
│   4. body == {"shimMode":true}
│
│ Rule 5 (shell only):
│   sha256-base64(body) ==
│     CSP meta-tag hash token
│
│ Exits 0 on pass; 1 on fail
│ with a per-rule error line.
└──────────────────────────────┘
```

## 6. Detailed design

### 6.1 `libs/frontend-deps/index.js`

Current state (`A2` baseline):

```js
const { share } = require('@angular-architects/native-federation/config');

const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };

const sharedFrontendDeps = share({
  '@angular/animations': singletonOpts,
  // …22 more entries…
  '@copilotkitnext/angular': singletonOpts,
});

const sharedMappings = ['@nestfolio/ui', '@nestfolio/shell'];

module.exports = { sharedFrontendDeps, sharedMappings };
```

Target state (B2):

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

Verification after the edit:

```bash
pnpm nx build nestfolio-host --configuration=production
node -e "const m = require('./dist/apps/nestfolio-host/browser/importmap.json'); \
  for (const k of ['url', '@nestfolio/shell/auth', '@nestfolio/shell/graphql', '@nestfolio/shell/i18n', \
                   '@primeuix/themes/aura']) { \
    if (!m.imports[k]) { console.error('Missing import-map entry:', k); process.exit(1); } \
  } console.log('OK: import-map has all expected entries');"
```

(Path of `importmap.json` may differ — adjust to the NF emit location once `pnpm nx build` has run; the exact filename is determined by `@angular-architects/native-federation@21.2.1` and is one of `importmap.json` / `_importmap.json` under the browser dist root.)

### 6.2 `tsconfig.base.json`

Insert three explicit keys before the existing `@nestfolio/shell/*` wildcard (line 85). The wildcard stays — Jest's `moduleNameMapper` resolves through it for test-only `@nestfolio/shell/testing`:

```json
"@nestfolio/shell": ["libs/shell/src/index.ts"],
"@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
"@nestfolio/shell/auth": ["libs/shell/src/auth/index.ts"],
"@nestfolio/shell/graphql": ["libs/shell/src/graphql/index.ts"],
"@nestfolio/shell/i18n": ["libs/shell/src/i18n/index.ts"],
"@nestfolio/shell/*": ["libs/shell/src/*/index.ts"],
```

Verification: `ls libs/shell/src/{auth,graphql,i18n}/index.ts` — all three must exist (already verified during brainstorming).

### 6.3 `apps/*/project.json` — six identical edits

Two changes per app:

1. **Polyfills array.** Locate `targets.esbuild.options.polyfills: []` and replace with `["es-module-shims"]`.

2. **Build-target chain.** Rename the existing `build` target to `nf-build` (it remains the `@angular-architects/native-federation:build` executor invocation), then add a new composite `build` target:

   ```json
   "nf-build": {
     "executor": "@angular-architects/native-federation:build",
     "options": {},
     "configurations": {
       "production": { "target": "<project>:esbuild:production" },
       "development": { "target": "<project>:esbuild:development", "dev": true }
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
         "node scripts/assert-shell-html.mjs dist/apps/<project>/browser --kind=<shell|mfe>"
       ]
     }
   }
   ```

   Update `serve-static.options.buildTarget` from `<project>:build` to `<project>:nf-build` to skip the assertion during dev iteration (the assertion runs only on production-grade builds where it matters; dev `index.html` is regenerated before build by `prepare-index` and read live by `serve`/`serve-static`).

   The shell variant uses `--kind=shell`; each MFE uses `--kind=mfe`.

   The shell's existing composite `build` already chains `prepare-index` via `dependsOn` on `esbuild`. The new `build` continues that — `nf-build` still calls `esbuild` which still depends on `prepare-index`. No regression.

Verification:
- `pnpm nx run nestfolio-host:build` runs `prepare-index` → `esbuild` → `nf-build` → assertion. Passes.
- `pnpm nx run-many -t build -p '*-mfe'` runs the MFE chain for all five MFEs. Passes.
- A deliberate mutation of `index.html.tmpl` (e.g. delete `{{ESMS_HASH}}` placeholder) makes shell `build` fail with a rule-5 error.
- A deliberate mutation of any MFE's `nf-build` artefact (e.g. swap `module-shim` → `module`) makes that MFE's `build` fail with a rule-2 error.

### 6.4 `scripts/assert-shell-html.mjs`

New file. ~40 lines. Stdlib only.

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [distDir, ...rest] = process.argv.slice(2);
const kindArg = rest.find((a) => a.startsWith('--kind='));
const kind = kindArg ? kindArg.slice('--kind='.length) : 'shell';
if (!distDir || !['shell', 'mfe'].includes(kind)) {
  console.error('Usage: assert-shell-html.mjs <dist-dir> --kind=<shell|mfe>');
  process.exit(2);
}

const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const fail = (rule, msg) => { console.error(`assert-shell-html (${kind}) ${rule} FAILED: ${msg}`); process.exit(1); };

// Rule 1
const polyfills = [...html.matchAll(/<script\s+type="module"\s+src="(polyfills-[^"]+\.js)">/g)];
if (polyfills.length !== 1) fail('rule-1', `expected 1 polyfills.js script, found ${polyfills.length}`);

// Rule 2
const mainShim = [...html.matchAll(/<script\s+type="module-shim"\s+src="(main-[^"]+\.js)">/g)];
if (mainShim.length !== 1) fail('rule-2', `expected 1 main.js module-shim script, found ${mainShim.length}`);

// Rule 3 + 4
const esmsTags = [...html.matchAll(/<script\s+type="esms-options">([^<]*)<\/script>/g)];
if (esmsTags.length !== 1) fail('rule-3', `expected 1 esms-options script, found ${esmsTags.length}`);
let esmsBody;
try { esmsBody = JSON.parse(esmsTags[0][1]); } catch (e) { fail('rule-3', `esms-options body is not valid JSON: ${e.message}`); }
if (JSON.stringify(esmsBody) !== '{"shimMode":true}') fail('rule-4', `esms-options body must equal {"shimMode":true}, got ${JSON.stringify(esmsBody)}`);

// Rule 5 — shell only
if (kind === 'shell') {
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!cspMatch) fail('rule-5', 'no CSP meta tag found');
  const hashTokenMatch = cspMatch[1].match(/script-src[^;]*'sha256-([A-Za-z0-9+/=]+)'/);
  if (!hashTokenMatch) fail('rule-5', `no sha256-<hash> token in CSP script-src: ${cspMatch[1]}`);
  const expected = createHash('sha256').update(esmsTags[0][1]).digest('base64');
  if (hashTokenMatch[1] !== expected) fail('rule-5', `CSP hash mismatch — meta has '${hashTokenMatch[1]}', body sha256 is '${expected}'`);
}

console.log(`assert-shell-html (${kind}) OK: all rules passed`);
```

Notes:
- Reads `dist/.../index.html`, never the source template — that's the build artefact post-NF rewrite.
- Rule 5 hashes the literal text content of the `esms-options` `<script>` tag (`{"shimMode":true}` exactly, no surrounding whitespace beyond what NF emits). The same string was hashed at A1 time and committed into `apps/nestfolio-host/csp.txt` as `sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=`. If A1's hash matches the value the assertion derives, this confirms the chain `csp.txt → emit-index-html.mjs → index.html → NF post-build → CSP meta tag` is intact.
- Exit code 1 on any rule failure; 2 on argument error. Differentiates "wrong invocation" from "actual regression".
- No new deps. CI already runs Node ≥24 (`engines.node` in `package.json`).

### 6.5 `package.json` (root)

Two devDependency additions:

```json
"es-module-shims": "^1.5.12",
"url": "^0.11.0"
```

`es-module-shims` is the runtime polyfill NF expects in the build's `polyfills` array. `url` is promoted from a transitive dep (already at `node_modules/.pnpm/url@0.11.4/...` via `aws-appsync-subscription-link@4.0.1`'s `"url": "^0.11.0"`) to a direct devDep so pnpm's symlink layout always resolves it from the root `node_modules`. NF resolves bare specifiers through the generated import map — the import map is generated against root-resolvable paths.

Lockfile change: `pnpm install` regenerates `pnpm-lock.yaml`. Per memory `feedback_pnpm_install_after_lockfile_change.md`, run `pnpm install --frozen-lockfile` in CI before integration tests.

## 7. Verification order (B2-scoped)

Each step has an unambiguous pass signal that can be run locally before moving on.

1. **Frontend-deps + tsconfig + package.json edits applied.**
   - `pnpm install` succeeds.
   - `pnpm nx graph` shows no broken dependency edges.
2. **Polyfill registered (all six apps).**
   - `pnpm nx run-many -t nf-build -p nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe,onboarding-mfe --configuration=production` succeeds.
   - For each app: `grep -q 'es-module-shims' dist/apps/<project>/browser/polyfills-*.js` → exit 0.
3. **Import map advertises new keys (shell only — sufficient because `frontend-deps` is single-source).**
   - Run the verification snippet from §6.1 (the inline `node -e "..."` block) and confirm `OK: import-map has all expected entries`.
4. **Local dev render.**
   - `pnpm nx serve nestfolio-host`; open `http://localhost:4200/login` in Chrome.
   - DevTools Console: zero CSP violations.
   - DOM probe (DevTools console): `document.querySelectorAll('input').length > 0` → returns ≥ 1.
5. **Build assertion blocks regressions.**
   - `pnpm nx run nestfolio-host:build` passes.
   - Apply a deliberate mutation (e.g. delete the `<script type="esms-options">` block from a copy of the dist `index.html`); re-run `node scripts/assert-shell-html.mjs <copy-dir> --kind=shell` → exits 1 with rule-3 error.
   - Apply a CSP-hash drift mutation: edit the dist `index.html` `<meta http-equiv="Content-Security-Policy">` content to swap one base64 char in the sha256 token; re-run → exits 1 with rule-5 error.
6. **MFE assertion enforces rules 1–4.**
   - `pnpm nx run-many -t build -p '*-mfe' --configuration=production` passes.
   - Apply a deliberate mutation to any MFE dist `index.html` (e.g. drop the `polyfills-*.js` script tag); re-run that MFE's build — assertion exits 1 with rule-1 error.
7. **No `provideAuth` regression yet.** Out of B2 scope. Deployed-shell auth verification waits for A4 and B1 + B4.

## 8. Success criteria

Each criterion is paired with the falsifiable check.

- **Six apps build.** `pnpm nx run-many -t build --configuration=production` exits 0 across `nestfolio-host`, `investor-mfe`, `advisory-mfe`, `dashboard-mfe`, `ledger-mfe`, `onboarding-mfe`.
- **Single-source propagation.** A controlled mutation to `libs/frontend-deps/index.js` (e.g. add a fake `'unused-pkg': singletonOpts` then revert) causes `pnpm nx affected -t nf-build` to schedule all six apps.
- **Local shell renders.** `pnpm nx serve nestfolio-host` → `/login` shows visible `<input>` elements within 10 s of page load. DevTools console has zero CSP violations.
- **Static shell renders.** `pnpm nx serve-static nestfolio-host` (after a production build) → same DOM probe passes.
- **Build assertion catches regressions.** Each of the five rules fails the build under a deliberate mutation, with a rule-tagged error line.
- **No deployed-shell criterion.** Intentionally out of scope — that's A4 + B1 + B4.

## 9. Risks / trade-offs

- **`includeSecondaries: true` on `@primeuix/themes`** pulls all theme presets into the import map (only `aura` is consumed by `libs/ui/src/theme/nestfolio-preset.ts`). Per `2026-04-23-shell-render-restoration-design.md` §1.2, this is acceptable — the presets are code-split and lazy-loaded; only `aura` lands on the wire. Future cost-reducer (out of scope here): introduce a `@nestfolio/ui/themes` wrapper lib that imports `@primeuix/themes/aura` and is shared via `sharedMappings` instead.
- **Build-target rename (`build` → `nf-build` + composite `build`)** changes the meaning of `pnpm nx build <app>`. Anyone with muscle memory hitting `nf-build` directly skips the assertion — that's intentional for dev iteration speed but must be kept off the deploy path. B4's `deploy` target must invoke `build`, not `nf-build`.
- **`url` as direct devDep** pins the version explicitly. If `aws-appsync-subscription-link` ever bumps its declared `"url"` range, both must move together. Detection mechanism: `pnpm install` will surface a peer-resolution warning if they drift.
- **Assertion script hardcodes `index.html` in `<distDir>`.** If NF v4 (or a future v21.x patch) emits the file under a different name, the script will fail with an opaque error. Acceptable — the test matrix today is one file at one path; charter §3 keeps NF v21.2.x.
- **`@nestfolio/shell/testing` deliberately not in `sharedMappings`.** Anyone adding a runtime import of `@nestfolio/shell/testing` from app code would silently bundle test-only code into a browser artefact. The pre-commit `scripts/verify-structure.sh` covers test-dir conventions but not this specific shape; a follow-up lint rule (out of scope for B2) would close the gap.

## 10. Out of scope (restated)

- Federation manifest swap (§1.5 of the predecessor spec). B1 + B4.
- Deploy targets (`config`, `deploy` per app). A4 (config target on shell) + B1 (CloudFront topology) + B4 (per-app deploy targets).
- CDK stack changes in `services/investor/investor-web`. B1 + B4.
- `provideAuth` factory-injection refactor. A4.
- Native Federation v4 migration. Charter §3 non-goal.
- Service worker registration audit. Predecessor §3 non-goal.
- Playwright behavioural verification. Phase C.

## 11. References

### This workspace

- [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](2026-04-24-mfe-architecture-charter.md) — Pillar 2 source of truth.
- [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) — sequencing.
- [`docs/superpowers/specs/2026-04-23-shell-render-restoration-design.md`](2026-04-23-shell-render-restoration-design.md) — predecessor: §1 (mechanical fixes), §5 (build-time guard).
- `apps/nestfolio-host/csp.txt` — A1 single-source CSP.
- `libs/frontend-deps/index.js` — A2 single-source singleton surface.
- `libs/cdk-constructs/src/utils/naming-service.ts` — out of scope here, referenced by sibling specs.

### External

- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/schematics/init/schematic.js:89-94` — proves `es-module-shims` belongs in `polyfills`.
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/config/federation-config.d.ts:8` — `SharedConfig.includeSecondaries: boolean` package-level flag.
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/utils/mapped-paths.js:27` — literal-string match against tsconfig `paths` keys.
- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js:30-39` — post-build `<script>` rewriting + esms-options injection (deterministic when no `esmsInitOptions` is passed).
- `node_modules/.pnpm/aws-appsync-subscription-link@4.0.1/.../package.json` — `"url": "^0.11.0"` runtime dep.
