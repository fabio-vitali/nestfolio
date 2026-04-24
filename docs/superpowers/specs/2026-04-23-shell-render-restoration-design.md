# Shell browser-render restoration — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-23
**Unblocks:** [Playwright UI e2e](./2026-04-22-playwright-e2e-ui-design.md) (paused since 2026-04-22 on this)

## Problem

`nestfolio-host/login` has never rendered in any browser on any commit of `main`. Empirically verified 2026-04-22 via `pnpm nx serve`, `pnpm nx serve-static`, and the deployed CloudFront URL: `main-*.js` is never fetched, `<app-root>` stays empty, zero `<input>` elements, no federation errors. All frontend PRs shipped since commit `98051e1a` (2026-03-08) have landed based on unit tests only.

Root cause is a stack of five mechanical gaps plus one deploy-topology gap and one CSP gap. The 2026-04-22 memory (`memory/project_shell_render_broken.md`) enumerates them; this spec incorporates one correction (the "node `url` shim" issue was misdiagnosed — `aws-appsync-subscription-link@4.0.1` declares `"url": "^0.11.0"` as a dependency, which is the browser-safe `url` npm package, not a Node built-in).

This spec restores the shell browser render on the minimum sustainable footprint and aligns the deploy model with the shape-frontends / shape-services pattern already familiar to the user.

## Goals

- Every browser target (`pnpm nx serve`, `pnpm nx serve-static nestfolio-host`, deployed CloudFront) renders a working `/login` page.
- Each frontend app (shell + 5 MFEs) self-deploys via Nx `config` + `deploy` targets, reading infrastructure identifiers from SSM — no cross-stack CDK coordination.
- `federation.manifest.json` is static, committed to the shell, same-origin with relative URLs.
- CSP remains strict (`script-src 'self' 'sha256-<hash>'`); no `'unsafe-inline'`.
- One new regression gate added by this spec: a build-time `index.html` assertion (§5). The behavioural gate remains the paused Playwright plan, which resumes once this spec lands.

## Non-goals

- Migrating to Native Federation v4 (`@native-federation/*` — announced 2026-01-22, issue #1044). Version 21.2.x stays in maintenance on the current track; a migration is a future separate spec.
- Renaming / moving `services/investor/investor-web/`. Investor-domain ownership is retained (Cognito emits to InvestorBus, CopilotKit bridge targets the intra-domain `onboarding-bff`).
- Adding a custom domain / ACM certificate. The default `*.cloudfront.net` hostname stays.
- Extracting `Cdn` + `Identity` as reusable constructs à la shape-services. YAGNI — there is one web surface.
- `ParameterApi`-backed runtime manifest resolution. Same-origin + fixed prefixes make this unnecessary.
- A bespoke `FrontendDeploymentRole` IAM role. Deferred to a future CI spec together with the PR pipeline work; local dev uses ambient Leapp credentials.
- Service worker registration / `ngsw-config.json` cleanup. SW is not currently registered (verified: no `provideServiceWorker` in `app.config.ts`). When SW is turned on, asset-group scopes must be audited against the new `/mfe/<key>/` prefixes — out of scope here, but flagged. Note: `@angular/service-worker` is declared as singleton-shared in every app's `federation.config.js:12` today. Declaring a shared package does not invoke its side effects — NF only resolves it lazily when an import appears. Since no code imports `@angular/service-worker`, the declaration is inert but misleading. Leave it for now (removing it is a no-op at runtime but would need to be re-added when SW is turned on); revisit in the SW-enablement spec.
- Touching `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`. That plan is paused pending this work — Playwright remains the behavioural gate and resumes after this spec lands.

## High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Federation track | Fix Native Federation v21.2.x in place | v4 migration is a separate track; the current gap is mechanical |
| `es-module-shims` delivery | Add to esbuild `polyfills` array per app | Matches NF init schematic; gets bundled into `polyfills-*.js`; no `<script src>` in index.html |
| Subpath resolution for npm packages | `includeSecondaries: true` on selected shared entries | Native NF mechanism; covers `@primeuix/themes/aura`, `graphql/*`, aws-appsync-* |
| Shared singleton surface | Shell's `shared` map must be a superset of every MFE's `shared` map | Anything singleton in an MFE but absent in the shell throws at `loadRemoteModule` time |
| `url` bare specifier | Added to `shared` (it's the browser-safe `url@^0.11.0` npm package) | Not a Node shim issue — NF just needs to know to resolve it |
| Workspace subpath mapping | Explicit tsconfig keys + explicit `sharedMappings` entries | `mapped-paths.js:27` does literal string match; wildcards don't expand |
| CSP strategy | sha256 hash of NF's deterministic `{"shimMode":true}` esms-options inline | Stable across builds; no `'unsafe-inline'`; **guarded by a build-time assertion** (see §5) |
| CSP directive set | Single source-of-truth string at `apps/nestfolio-host/csp.txt`, read by both `index.html` meta injection AND CDK `ResponseHeadersPolicy` | Today they disagree (meta has full set; CF has only 3 directives); alignment is mandatory |
| Deploy model | Per-app Nx `deploy` targets using AWS CLI + SSM; **no** bespoke deployment IAM role in this spec | shape-frontends pattern; role-based CI deploy is deferred to a CI spec |
| Runtime config shape | Keep existing single `/assets/config.json` (shape matches `RuntimeConfig` in `app.config.ts:12`); split-file idea dropped | Avoids restructuring `RuntimeConfigService` bootstrap; preserves `copilotApiUrl` wiring |
| Manifest dev/prod swap | Per-configuration `assets` entries in `esbuild.configurations.{development,production}` | `fileReplacements` only swaps TS/JS compile-time modules — it does **not** touch the `assets:` pipeline |
| Bucket topology | Single shared bucket owned by `investor-web` | Analog of a shared EventBridge bus; each frontend app writes under its prefix |
| Distribution topology | Single CloudFront distribution owned by `investor-web`; one generic `/*` behavior | Same-origin eliminates CORS, keeps `federation.manifest.json` static |
| MFE bundle layout | Shell at bucket root; MFEs at `/mfe/<key>/` | Deterministic; manifest is a checked-in static JSON |
| Runtime config | Nx build-time SSM fetch writes `config.json` into the shell's assets folder | shape-frontends pattern; replaces the (never-instantiated) CDK `RuntimeConfig` construct |
| Regression gate | Post-build `index.html` assertion **is** in scope; Playwright plan remains the behavioural gate | Silent blank-page regression is exactly what this spec exists to prevent |

## Architecture

```
apps/nestfolio-host                              services/investor/investor-web
┌─────────────────────────┐                      ┌──────────────────────────────┐
│ federation.config.js    │                      │ Cognito (investor-scoped)    │
│   shared: { ..., url,   │                      │ S3 bucket (shared assets)    │
│     graphql: {          │                      │ CloudFront Distribution      │
│       includeSecondaries│                      │   • /*                → S3   │
│     }, aws-appsync-*:{  │                      │   • /api/copilotkit*  → AC   │
│       includeSecondaries│                      │ CSP: 'self' + sha256-<hash>  │
│     }}                  │                      │ SSM (subsystem=investor):    │
│   sharedMappings: [     │                      │   /…-investor/frontend/      │
│     @nestfolio/ui,      │                      │     bucketName               │
│     @nestfolio/ui/FF,   │                      │     distributionId           │
│     @nestfolio/shell,   │                      │   /…-investor/auth/          │
│     @nestfolio/shell/*  │                      │     userPoolId, clientId     │
│   ] (explicit)          │                      │   /…-investor/web/           │
│ project.json            │                      │     distributionUrl          │
│   polyfills: [es-module-│                      │ (deploy role: deferred → CI) │
│     shims]              │                      └──────────────────────────────┘
│ src/index.html          │                                     │
│   meta CSP = match CF   │                          apps/<app>/project.json
│ public/assets/          │                          ┌──────────────────────────┐
│   federation.manifest   │                          │ config target (shell):   │
│     .json (static,      │                          │   fetch-runtime-config.sh│
│     relative URLs)      │                          │ deploy target:           │
└─────────────────────────┘                          │   aws s3 sync ...        │
                                                     │   aws cloudfront invalidate│
                                                     └──────────────────────────┘
bucket layout (single bucket):
  /                             ← shell (nestfolio-host)
  /mfe/investor/                ← investor-mfe
  /mfe/advisory/                ← advisory-mfe
  /mfe/dashboard/               ← dashboard-mfe
  /mfe/ledger/                  ← ledger-mfe
  /mfe/onboarding/              ← onboarding-mfe
```

## Detailed design

### 1. Native Federation plumbing (5 mechanical fixes)

**1.1 `es-module-shims` in polyfills (all six apps)**

Current: `apps/*/project.json` → `esbuild.options.polyfills: []`.
Fix: `polyfills: ["es-module-shims"]`.
Add `es-module-shims@^1.5.12` to workspace `package.json` (devDependencies or dependencies — matches NF init schematic at `src/schematics/init/schematic.js:89-94`).

Effect: `polyfills-*.js` bundle includes es-module-shims, which registers globally. NF's post-build `updateIndexHtml.js:37-38` rewrites the `<script>` tags so `polyfills-*.js` loads as `type="module"` and `main-*.js` loads as `type="module-shim"`. The browser picks up main.js via es-module-shims.

**1.2 `includeSecondaries: true` on npm packages with subpath imports**

Current: `federation.config.js` calls `share({ '@primeuix/themes': { ... }, 'graphql': { ... }, ... })` without `includeSecondaries`.
Fix: set `includeSecondaries: true` on:
- `@primeuix/themes` (subpath: `@primeuix/themes/aura`, imported by `libs/ui/src/theme/nestfolio-preset.ts`)
- `graphql` (subpaths: `graphql/index.js`, `graphql/language/printer.js`, imported by aws-appsync-*)
- `aws-appsync-auth-link` (internally imports `url`, others)
- `aws-appsync-subscription-link` (same)

Verified against `@softarc/native-federation` 3.5.4 `SharedConfig.includeSecondaries?: boolean` in `federation-config.d.ts:8` — the flag is a plain boolean, there is no per-subpath opt-in. Consequence for `@primeuix/themes`: `includeSecondaries: true` pulls **all** theme presets (aura, lara, nora, material, etc.) into the import map, not just `aura`. Accepted as an acceptable bundle-size cost — the presets are code-split and lazy-loaded per import, so only the bundle consumed (`aura`) actually lands on the wire. If bundle-size metrics later regret this, move `nestfolio-preset.ts` to import `@primeuix/themes/aura` through a workspace lib wrapper and share that wrapper via `sharedMappings` instead.

**1.2a Shared singleton parity (shell ⊇ every MFE)**

Current gap: `apps/investor-mfe/federation.config.js:25` and `apps/onboarding-mfe/federation.config.js:25` declare `@ag-ui/client` as singleton-shared. `apps/nestfolio-host/federation.config.js` does **not**. When the onboarding MFE is loaded into the shell at runtime, its bare imports for `@ag-ui/client` resolve through the shell's import map — which doesn't advertise it. Result: either singleton breakage (MFE ships its own copy and trips `strictVersion`) or outright resolution throw. Only real production consumer today is `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts` (imports `HttpAgent`).

Fix — two parts:

1. **Add `@ag-ui/client`** to `apps/nestfolio-host/federation.config.js` `shared`: `{ singleton: true, strictVersion: true, requiredVersion: 'auto' }`.
2. **Remove `@copilotkitnext/angular`** from `apps/investor-mfe/federation.config.js:26` and `apps/onboarding-mfe/federation.config.js:26`. Grep-verified 2026-04-23: zero TypeScript imports in the repo. Leaving it declared as a singleton asks NF to resolve a package no app consumes; the shared declaration bloats the import map and, if `includeSecondaries: true` is ever toggled on it, walks a subpath tree that exists only in `node_modules`. **Do not add it to the shell.** If the CopilotKit rewrite later adds a real import, re-add it to all three configs in the same commit that adds the import.

To prevent drift, extract the common `share({ ... })` block into a single module and have every app's `federation.config.js` require it. Recommended layout: `apps/shared-frontend-deps.js` exporting an object (plain `module.exports = {...}` — `share()` must be invoked by each app's config because `withNativeFederation` expects concrete config; invoking `share()` inside the shared module would need identical `requiredVersion` resolution context and breaks when copied). Shell-only additions (none today) can be overlaid.

Verification: after the edit, run `pnpm nx build nestfolio-host` and `pnpm nx build onboarding-mfe`, then diff the two generated `importmap` blocks for any package present in one but missing from the other. Also grep the built `importmap.json` for `@copilotkitnext/angular` — must be absent from all three apps.

**1.3 `url` bare specifier**

Corrects the 2026-04-22 memory misdiagnosis.
`aws-appsync-subscription-link@4.0.1/package.json` declares `"url": "^0.11.0"` as a dependency. `url@0.11.4` is installed; it's the browser-safe port from Browserify, not a Node built-in.
Fix: add `'url': { singleton: true, strictVersion: true, requiredVersion: 'auto' }` to `shared` in each app's `federation.config.js`. NF then resolves the bare `url` specifier via the import map.

**1.4 Workspace subpath mapping (`sharedMappings`)**

Current: `sharedMappings: ['@nestfolio/ui', '@nestfolio/shell']`.
`mapped-paths.js:27` does a **literal string match** against `tsconfig.compilerOptions.paths` keys. `@nestfolio/shell/*` (wildcard) is not matched as `@nestfolio/shell/auth`.

Fix, in two parts:
- **`tsconfig.base.json`**: add explicit keys for every subpath actually imported at runtime:
  - `@nestfolio/shell/auth`, `@nestfolio/shell/graphql`, `@nestfolio/shell/i18n` (existing wildcard stays as fallback for Jest's `moduleNameMapper`)
  - `@nestfolio/ui/feature-flags` is already explicit — no tsconfig change
- **`apps/*/federation.config.js`**: expand `sharedMappings` to:
  ```js
  sharedMappings: [
    '@nestfolio/ui',
    '@nestfolio/ui/feature-flags',
    '@nestfolio/shell',
    '@nestfolio/shell/auth',
    '@nestfolio/shell/graphql',
    '@nestfolio/shell/i18n',
  ]
  ```
  (Intentionally excluded: `@nestfolio/shell/testing` → `libs/shell/test/testing/index.ts`. Test-only; must not be bundled into a browser artifact. `tsconfig.base.json:84` keeps it available to Jest's `moduleNameMapper`.)

**1.5 `federation.manifest.json` with relative URLs**

Current: `apps/nestfolio-host/public/assets/federation.manifest.json` points at `http://localhost:4201..4205/remoteEntry.json` — unreachable from deployed CloudFront.

Fix: **two manifest files**, selected per configuration:
- `apps/nestfolio-host/public/assets/federation.manifest.json` (prod/static — same-origin, checked in, becomes the default):
  ```json
  {
    "investor-mfe":   "/mfe/investor/remoteEntry.json",
    "advisory-mfe":   "/mfe/advisory/remoteEntry.json",
    "dashboard-mfe":  "/mfe/dashboard/remoteEntry.json",
    "ledger-mfe":     "/mfe/ledger/remoteEntry.json",
    "onboarding-mfe": "/mfe/onboarding/remoteEntry.json"
  }
  ```
- `apps/nestfolio-host/src/assets-dev/federation.manifest.json` (dev-only — ports **must** equal the `serve-static.options.port` declared in each MFE's `project.json`; that file is the authority, this manifest mirrors it):
  ```json
  {
    "investor-mfe":   "http://localhost:4201/remoteEntry.json",
    "dashboard-mfe":  "http://localhost:4202/remoteEntry.json",
    "advisory-mfe":   "http://localhost:4203/remoteEntry.json",
    "ledger-mfe":     "http://localhost:4204/remoteEntry.json",
    "onboarding-mfe": "http://localhost:4205/remoteEntry.json"
  }
  ```

Port consistency check before committing: `pnpm nx show projects --projects='*-mfe' --json | xargs -I{} cat apps/{}/project.json | jq '.targets["serve-static"].options.port'` — output must match the manifest values above. Commit `945de28e` (2026-04-22) already aligned these; any future MFE port change must update both files in the same commit.

Selection mechanism: **per-configuration `assets` entries in `apps/nestfolio-host/project.json`**, *not* `fileReplacements`.

Why not `fileReplacements`: verified against `@angular/build@21.2.3` `src/builders/application/schema.json` (*"Replace compilation source files with other compilation source files in the build."*). The option is plumbed to the esbuild compiler plugin as a TS/JS module-replacement map. It does not touch the `assets:` pipeline. `federation.manifest.json` is an asset — `fileReplacements` would silently ignore it.

Correct wiring in `apps/nestfolio-host/project.json` `esbuild.configurations`:
```json
"development": {
  "optimization": false,
  "extractLicenses": false,
  "sourceMap": true,
  "assets": [
    { "glob": "**/*", "input": "apps/nestfolio-host/public", "ignore": ["assets/federation.manifest.json"] },
    { "glob": "federation.manifest.json", "input": "apps/nestfolio-host/src/assets-dev", "output": "assets" }
  ]
}
```
Production inherits the base `assets:` (which copies the static same-origin manifest from `public/`). `nx serve` + `nx serve-static` both pass through the `development` configuration.

Verification: after `pnpm nx serve nestfolio-host`, open DevTools → Network, filter `federation.manifest.json`, confirm payload URLs start with `http://localhost:420`. After `pnpm nx build nestfolio-host --configuration=production`, assert the built manifest has zero localhost references: `! grep -q localhost dist/apps/nestfolio-host/browser/assets/federation.manifest.json` (exit 0 = pass; exit 1 = either the file is missing or localhost is present — inspect before assuming pass). Add this as a second assertion in `scripts/assert-shell-html.mjs` (§5) so a missing build artefact is a hard failure.

### 2. CSP strategy

NF's post-build injects exactly: `<script type="esms-options">{"shimMode":true}</script>` — content is deterministic *as long as no `esmsInitOptions` is passed to the build target*. Verified at `updateIndexHtml.js:30-35`:
```js
const esmsOptions = { shimMode: true, ...nfOptions.esmsInitOptions };
```
This is a silent footgun: a future developer who sets `esmsInitOptions` (e.g. to enable polyfill-mode debugging) regenerates a different payload, the hash no longer matches, and the page goes blank with only a single CSP-violation console line. §5 adds a build-time assertion that enforces both invariants (shape + hash match) so this cannot regress silently.

Compute once: `echo -n '{"shimMode":true}' | openssl dgst -sha256 -binary | openssl base64`.

**2.1 Single source of truth**

Today `apps/nestfolio-host/src/index.html:10` (full directive set) and `services/investor/investor-web/src/service.stack.ts:103` (three directives: `default-src`, `script-src`, `style-src`) disagree. They must be the same string, source-controlled once.

New file `apps/nestfolio-host/csp.txt` (plain text, trailing newline stripped at read time) — canonical CSP value. Both consumers read from it:
- `apps/nestfolio-host/src/index.html` — build-time injection via an **Nx `run-commands` pre-step** on the `build` target (one mechanism, not two). The pre-step runs `node scripts/emit-index-html.mjs` which reads `src/index.html.tmpl`, substitutes `{{CSP}}` and `{{ESMS_HASH}}` placeholders, and writes `src/index.html`. `src/index.html` is gitignored; `src/index.html.tmpl` is the tracked source. The assertion in §5 then reads the emitted `dist/…/index.html`.
- `services/investor/investor-web/src/service.stack.ts` — `readFileSync(join(__dirname, '../../../../apps/nestfolio-host/csp.txt'), 'utf-8').trim()`. Path depth: `services/investor/investor-web/src/` → up 4 to workspace root → `apps/nestfolio-host/csp.txt`.

(Rationale for plain text vs TS constant: the CDK stack and the Angular build operate under different tsconfig/module graphs; a TS re-export is possible but not portable — a text file is read trivially by both.)

**Nx graph wiring:** because the CDK build reads `apps/nestfolio-host/csp.txt` at synth-time, add `"apps/nestfolio-host/csp.txt"` to `implicitDependencies` (or the `build` target `inputs` array with `{ "input": "^production" }` extended) of `services/investor/investor-web/project.json`. Without this, `pnpm nx affected` will not re-synth investor-web when csp.txt changes and CloudFront + meta tag can drift apart silently.

**2.2 Full directive set**

Must match today's `index.html` meta plus the `'sha256-<hash>'` addition:
```
default-src 'self';
script-src 'self' 'sha256-<hash>';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:;
connect-src 'self' https://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com;
worker-src 'self' blob:;
manifest-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

Additions vs today's `index.html`:
- `'sha256-<hash>'` added to `script-src` — required for the NF inline `esms-options` script.
- `wss://*.appsync-realtime-api.*.amazonaws.com` added to `connect-src` — AppSync subscriptions today are only indirectly covered by `https://*.amazonaws.com`, which some browsers refuse to extend to WSS.
- `cognito-idp` / `cognito-identity` pinned explicitly — Amplify's Auth calls go here; again WSS-safe and narrower than `*.amazonaws.com`.
- `worker-src 'self' blob:` and `manifest-src 'self'` — service-worker registration and `manifest.webmanifest` are `default-src 'self'` by fallback today, but browsers vary on fallback behavior. `blob:` kept in `worker-src` for defensive coverage of any future use: `@aws-amplify/auth@6.19.1` bundle does not spawn blob workers today (grep-verified 2026-04-23: no `new Worker`/`URL.createObjectURL` hits in `node_modules/.pnpm/@aws-amplify+auth*/dist/esm`), but `@aws-amplify/storage@6.13.1` does (`providers/s3/apis/internal/uploadData/*.mjs`). If storage is ever imported by the shell or an MFE, the CSP would block it without `blob:`. Cost of keeping it is near-zero. `manifest.webmanifest` is served from `public/manifest.webmanifest` (verified: exists on disk today) so `'self'` covers it.

CDK CSP string must be character-for-character identical to the meta tag (minus whitespace — CloudFront accepts the same single-line form as the meta).

### 3. Deploy model (Nx + AWS CLI + SSM)

Mirrors `shape-frontends/apps/*/project.json`. **Shell** (`nestfolio-host`) gains both `config` and `deploy` targets; **MFEs** gain only `deploy` (they are loaded into the federated shell at runtime and read the shell's runtime config — no per-MFE config file).

**Runtime-config shape is unchanged.** Verified at `apps/nestfolio-host/src/app/app.config.ts:12-21,53`: the shell fetches a single `/assets/config.json` whose shape is `{ auth, appsync: { investorBff, advisoryBff, dashboardBff, ledgerBff }, copilotApiUrl }`. Do **not** split into `auth.json` + `bff.json` — that would require restructuring `RuntimeConfigService` bootstrap and would drop `copilotApiUrl` (which feeds `COPILOT_API_URL` at `app.config.ts:89-91` — the onboarding bridge shipped 2026-04-22 depends on it). Single file, existing shape.

**3.0 Mandatory load-order refactor in `app.config.ts` (prerequisite for prod deploys)**

Current `app.config.ts:95` wires `provideAuth(environment.auth)` eagerly at provider-setup time. The `loadRuntimeConfig` APP_INITIALIZER (line 100) runs *after* providers are resolved, so in production the `/assets/config.json` fetch populates `runtimeConfig` but the already-resolved `provideAuth` call has captured `environment.ts` values — which are `us-east-1_PLACEHOLDER` / `PLACEHOLDER_CLIENT_ID`. Deployed shell would authenticate against a nonexistent Cognito pool.

Only `COPILOT_API_URL` (line 89-91) is safe today because it uses `useFactory: () => getRuntimeConfig().copilotApiUrl` — the factory is invoked lazily, after `loadRuntimeConfig` has populated `runtimeConfig`.

Apply the same pattern to `auth` — and (forward-looking) to every AppSync endpoint that downstream MFEs will consume:

```ts
// Replace line 95:
// provideAuth(environment.auth),
// With:
{
  provide: AUTH_CONFIG, // new InjectionToken exported from @nestfolio/shell/auth
  useFactory: () => getRuntimeConfig().auth,
},
provideAuth(),  // reads AUTH_CONFIG from DI instead of a direct argument
```

Implementation requires a small edit to `libs/shell/src/auth/provide-auth.ts` (or wherever `provideAuth` lives) to accept zero args and inject `AUTH_CONFIG`, plus reordering the `APP_INITIALIZER` array so `loadRuntimeConfig` is the **first** initialiser (it already appears before `initializeAuth` and the `FeatureFlagService` trigger at line 99-114, which is correct — keep that ordering). The factory-based `COPILOT_API_URL` wiring remains unchanged.

Without this refactor, §3's "Dev renders" and "Static renders" success criteria will pass (dev short-circuits via `environment.ts` at `app.config.ts:48-51`) but the "Deployed shell renders" criterion will fail silently at Amplify's `signIn` call.

**`config` target** (shell only) — build-time SSM fetch, writes one file:
```json
"config": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "commands": [
      "./scripts/fetch-runtime-config.sh {projectRoot}/src/assets/config.json {args.region} {args.stage}"
    ]
  }
}
```

Script (new, in `scripts/`):
- `fetch-runtime-config.sh` — reads the SSM parameters below and writes a single `config.json` matching the `RuntimeConfig` shape. **All investor-web parameters are subsystem-scoped (`-investor`), not service-scoped (`-investor-web`)**: the existing `NamingService.ssmParameterPath()` resolves to `/nestfolio/{prefix}-{subsystem}/{resourcePath}` (see `libs/cdk-constructs/src/utils/naming-service.ts:67`), and `services/investor/investor-web/src/main.ts:6-9` passes `subsystem: 'investor'`. The `auth/userPoolId`, `auth/userPoolClientId`, and `web/distributionUrl` parameters are already written at `/nestfolio/<stage>-investor/…` today (`service.stack.ts:217,221,225`); the new `frontend/…` params added in §4 follow the same convention:
  - `/nestfolio/<stage>-investor/auth/userPoolId` → `auth.userPoolId`
  - `/nestfolio/<stage>-investor/auth/userPoolClientId` → `auth.clientId`
  - `/nestfolio/<stage>-investor-bff/api/graphqlUrl` → `appsync.investorBff.endpoint`
  - `/nestfolio/<stage>-advisory-bff/api/graphqlUrl` → `appsync.advisoryBff.endpoint`
  - `/nestfolio/<stage>-dashboard-bff/api/graphqlUrl` → `appsync.dashboardBff.endpoint`
  - `/nestfolio/<stage>-ledger-bff/api/graphqlUrl` → `appsync.ledgerBff.endpoint`
  - `/nestfolio/<stage>-investor/web/distributionUrl` + `/api/copilotkit` → `copilotApiUrl` (same-origin, already wired via CF function)

BFF subsystems (`investor-bff`, `advisory-bff`, etc.) are already service-scoped in their own stacks — do not rewrite. Verify by running `aws ssm describe-parameters --region us-east-1 --parameter-filters 'Key=Name,Option=BeginsWith,Values=/nestfolio/dev-' --query 'Parameters[].Name'` before wiring the fetcher.

Note: **four** BFFs, not five. `onboarding-bff` is consumed via `copilotApiUrl` (CloudFront path rewrite), not GraphQL — verified against the `appsync` shape in `app.config.ts:14-19` and `environment.ts`.

Local dev: the `config` target is **not** needed. `app.config.ts:48-51` short-circuits in non-production mode and uses `environment.ts` values directly. The target is only invoked before a production build that will be deployed.

`config.json` lives at **`apps/nestfolio-host/public/assets/config.json`** — the existing `assets` glob in `project.json:19-24` has `input: 'apps/nestfolio-host/public'`, so this path is the only one picked up without adding a new assets entry. Writing to `src/assets/config.json` would require a second `assets:` input and is unnecessary. Gitignored (`apps/nestfolio-host/public/assets/config.json` added to `.gitignore`); regenerated by the `config` target before each production build.

**`deploy` target** — AWS CLI sync + CF invalidation (assumes the current shell/CI principal already has deploy permissions; see §4 for why no bespoke IAM role is introduced here). `<prefix>` is **not** an Nx interpolation — it is substituted by the spec implementer at authoring time, per-app, following the shape-frontends pattern (one concrete `project.json` per app). Shell uses empty prefix (`dist` syncs to bucket root); each MFE hardcodes `mfe/<key>/`.

Shell (`apps/nestfolio-host/project.json`):
```json
"deploy": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "parallel": false,
    "commands": [
      "BUCKET=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor/frontend/bucketName --region {args.region} --query Parameter.Value --output text) && aws s3 sync dist/apps/nestfolio-host/browser s3://$BUCKET/ --region {args.region} --delete --exclude 'mfe/*'",
      "DIST=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor/frontend/distributionId --region {args.region} --query Parameter.Value --output text) && aws cloudfront create-invalidation --region {args.region} --distribution-id $DIST --paths '/*'"
    ]
  }
}
```

MFE example (`apps/investor-mfe/project.json` — same shape for advisory/dashboard/ledger/onboarding, with `<key>` substituted):
```json
"deploy": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "parallel": false,
    "commands": [
      "BUCKET=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor/frontend/bucketName --region {args.region} --query Parameter.Value --output text) && aws s3 sync dist/apps/investor-mfe/browser s3://$BUCKET/mfe/investor/ --region {args.region} --delete --exclude 'ngsw-*.js' --exclude 'ngsw.json'",
      "DIST=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor/frontend/distributionId --region {args.region} --query Parameter.Value --output text) && aws cloudfront create-invalidation --region {args.region} --distribution-id $DIST --paths '/mfe/investor/*'"
    ]
  }
}
```

Notes:
- Shell sync: `--exclude 'mfe/*'` so redeploying the shell never wipes MFE prefixes. MFE redeploys write under their own `/mfe/<key>/` prefix and do not touch shell bundles.
- Shell invalidation: `/*` is intentional because the shell's `main-*.js`, `polyfills-*.js`, and `federation.manifest.json` hashes all rotate on every build.
- MFE invalidation: scoped to `/mfe/<key>/*` so one MFE redeploy does not thrash the whole distribution.
- `ngsw-*.js` / `ngsw.json` excluded from MFE sync — emitted at each app's root when SW is enabled; would collide with the shell's SW scope. SW is not registered today (verified: no `provideServiceWorker` in `app.config.ts`) — defensive for when it is.
- **Nx arg passing:** invoke as `pnpm nx run nestfolio-host:deploy --stage=dev --region=us-east-1` (positional `--flag=value`). Do **not** wrap in `--args="--stage=…"`; `run-commands` only interpolates `{args.*}` from direct flags, not from a nested `--args` string.

**Delete**: the (never-instantiated) CDK runtime-config construct and its re-export:
- `libs/cdk-constructs/src/extensions/runtime-config.ts` — file removal
- `libs/cdk-constructs/src/extensions/index.ts:12` — remove `export { RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths } from './runtime-config';`

### 4. investor-web CDK refactor (minimal)

`services/investor/investor-web/src/service.stack.ts` changes:

**Add** `StringParameter` exports (discovered by the Nx `deploy` target). These use `ssmParameterPath()` — subsystem-scoped — to match the existing `auth/userPoolId`, `auth/userPoolClientId`, and `web/distributionUrl` params already emitted by this stack at `service.stack.ts:217,221,225`. Resulting names: `/nestfolio/<prefix>-investor/frontend/bucketName` and `/nestfolio/<prefix>-investor/frontend/distributionId`:
```ts
new StringParameter(this, 'FrontendBucketNameParam', {
  parameterName: this.naming.ssmParameterPath('frontend/bucketName'),
  stringValue: assetsBucket.bucketName,
});
new StringParameter(this, 'FrontendDistributionIdParam', {
  parameterName: this.naming.ssmParameterPath('frontend/distributionId'),
  stringValue: distribution.distributionId,
});
```

**No `FrontendDeploymentRole` in this spec.** Local dev already has admin credentials via Leapp and `aws s3 sync` / `aws cloudfront` calls resolve against the ambient principal; adding a role the Nx deploy target never assumes would be write-only documentation. A properly wired CI role (with `sts:AssumeRole` in the deploy script) belongs in a future CI spec together with the PR pipeline work.

**Remove** the shell `BucketDeployment` added in commit `cb53a711`:
```ts
// DELETE:
// new BucketDeployment(this, 'ShellDeployment', { ... });
```

The shell now deploys itself via `pnpm nx run nestfolio-host:deploy`.

**Update** CSP in `ResponseHeadersPolicy` as per §2 — read from `apps/nestfolio-host/csp.txt`, emit the full directive set, keep identical to the meta-tag form.

**Keep**: Cognito + triggers, `/api/copilotkit*` CopilotKit bridge, existing SSM parameters (`auth/userPoolId`, `auth/userPoolClientId`, `web/distributionUrl`).

### 5. Regression gate — build-time `index.html` assertion (IN scope)

The whole spec exists because silent blank-page regressions shipped repeatedly. Deferring the build-time guard while shipping the fix invites the same class of bug to return. Promoted into scope:

**`scripts/assert-shell-html.mjs`** — runs as a post-build step of `nestfolio-host:build` (and all MFE builds, since they also carry the NF post-build rewrite). Fails the build unless all of the following hold against `dist/apps/<project>/browser/index.html`:

1. Exactly one `<script type="module" src="polyfills-*.js">` tag present.
2. Exactly one `<script type="module-shim" src="main-*.js">` tag present.
3. Exactly one `<script type="esms-options">…</script>` tag present, with content that parses as valid JSON.
4. The JSON body equals `{"shimMode":true}` (matches the hash committed to `csp.txt`). Detects any future `esmsInitOptions` drift.
5. Base64-sha256 of the esms-options body equals the `sha256-<hash>` token in the `<meta http-equiv="Content-Security-Policy">` tag. Detects CSP drift even if the inline shape stays the same.

~40 lines of Node, no new deps (`crypto` + `fs` from stdlib). **Single hooking mechanism**: Nx composite target `build` that chains `esbuild` → `assert-shell-html`. Concretely, in each app's `project.json`:
```json
"build": {
  "executor": "nx:run-commands",
  "dependsOn": ["esbuild"],
  "options": {
    "cwd": "{workspaceRoot}",
    "commands": ["node scripts/assert-shell-html.mjs dist/apps/{projectName}/browser"]
  }
}
```
MFE-vs-shell behaviour: the script accepts a `--kind=shell|mfe` flag. Shell builds enforce all five rules (including the `<meta http-equiv="Content-Security-Policy">` sha256-match in rule 5). MFE builds enforce rules 1–4 only — MFE `index.html` artefacts are not served to browsers (they are loaded as `remoteEntry.json` imports), so a CSP meta tag is not required, but the polyfill/module-shim shape must still be intact because NF's post-build rewrites them identically.

Behavioural gate (Playwright Phase 1 smoke) remains the paused plan `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`, which resumes after this spec lands.

### 6. Verification order

Applying the fixes in arbitrary order leaves different blank-page symptoms mid-way. Recommended sequence — each step has a clear pass signal:

1. **§1.1 + §1.3** (`es-module-shims` polyfill + `url` share, shell only). Expected: `pnpm nx serve nestfolio-host` now fetches `main-*.js` (Network tab confirms). Page may still fail to bootstrap — MFE resolution not yet fixed.
2. **§1.2 + §1.2a + §1.4** (`includeSecondaries`, shared-package parity, sharedMappings + tsconfig subpaths). Expected: `/login` renders locally in dev-server with visible `<input>` fields. Federation-level MFE loads still may fail.
3. **§1.5** (manifest strategy with per-configuration `assets`). Expected: `/onboarding` in `nx serve` loads the onboarding MFE via `http://localhost:4205/remoteEntry.json` with no `federation.manifest.json` fetch errors.
4. **§2** (CSP alignment). Expected: zero CSP violations in DevTools Console on `/login` and `/onboarding`.
5. **§5** (build-time assertion). Expected: `pnpm nx build nestfolio-host --configuration=production` passes; a deliberate mutation (swap `module-shim` → `module` in `index.html.tmpl`) must cause the build to fail.
6. **§3.0** (factory-based `provideAuth` refactor). Expected: `pnpm nx build nestfolio-host --configuration=production`; grep the built `main-*.js` for `PLACEHOLDER_CLIENT_ID` — must be absent (eager-read of `environment.auth` is gone); instead the built bundle references `AUTH_CONFIG` injection-token lookups. Only after this step is prod-deploy safe.
7. **§3 + §4** (Nx deploy + CDK changes + BucketDeployment removal). Expected: `pnpm nx run nestfolio-host:deploy --stage=dev --region=us-east-1` succeeds; deployed CloudFront URL renders `/login` **and** Amplify `signIn` succeeds against the real Cognito pool (prerequisite: step 6 above); subsequent MFE deploys light up each route.

Each step is independently mergeable — a half-applied sequence does not regress prior steps.

## Success criteria

Each criterion is paired with a concrete command or check — the spec is implementer-ready only if each is falsifiable.

- **Dev server renders.** `pnpm nx serve nestfolio-host`; open `http://localhost:4200/login` in Chrome within 10s; at least one `<input>` element visible (DOM probe: `document.querySelectorAll('input').length > 0`).
- **Static serve renders.** `pnpm nx serve-static nestfolio-host`; headless-Chromium probe (pattern at `/tmp/nf-amplify-spike/probe-cf.mjs`) confirms `<input>` elements present.
- **Build-time assertion blocks silent regressions.** `pnpm nx build nestfolio-host --configuration=production` passes. Mutating `index.html.tmpl` (e.g. remove the `esms-options` placeholder) must cause the build to fail with a clear error from `scripts/assert-shell-html.mjs`.
- **Deployed shell renders (MFE-independent).** `pnpm nx run nestfolio-host:config --stage=dev --region=us-east-1 && pnpm nx build nestfolio-host --configuration=production && pnpm nx run nestfolio-host:deploy --stage=dev --region=us-east-1`. Deployed CloudFront URL renders `/login` — this route does not load any MFE, so it passes even if MFE prefixes are empty. It's the unambiguous render-restoration signal.
- **Deployed MFEs load (second pass, after shell is green).** `pnpm nx run-many --target=deploy --projects='*-mfe' --stage=dev --region=us-east-1`. Navigating to `/onboarding`, `/investor`, `/advisory`, `/dashboard`, `/ledger` on the deployed shell successfully `loadRemoteModule`s each MFE with zero federation errors in console. Order matters: if this runs before the shell deploy, the shell still renders `/login` but MFE routes 404 on `remoteEntry.json` — which is recoverable by the subsequent shell deploy, not a hard failure.
- **Expected network waterfall.** DevTools Network: 1× `polyfills-*.js` (module), 1× `main-*.js` (module-shim), N× shared package imports resolved via the generated import map, 1× `remoteEntry.json` per MFE lazily fetched on route navigation.
- **Zero CSP violations.** DevTools Console on `/login`, `/onboarding`, and one post-auth route has no `Refused to …` CSP violation entries.
- **Paused plan resumes.** `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` Task 0 probe passes against the deployed URL.

## Out of scope (restated)

- Native Federation v4 migration
- Rename / relocation of `investor-web`
- Custom domain, ACM cert, Route53
- Reusable `Cdn` / `Identity` CDK constructs
- `ParameterApi`-backed runtime manifest resolution
- Bespoke `FrontendDeploymentRole` IAM role + `sts:AssumeRole` deploy wiring (deferred to CI spec)
- Service worker registration / `ngsw-config.json` scope audit
- CSP header `curl` regression check / CI gate
- Any change to `apps/e2e-feature-tests/` or the Playwright plan document itself

## Unblocks

- `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` (paused since 2026-04-22)
- All future frontend PRs — `nx serve` and `nx serve-static` become trustworthy again

## References

- `memory/project_shell_render_broken.md` — the 2026-04-22 diagnosis (corrected: url module is not a Node shim issue)
- `docs/superpowers/specs/2026-04-22-playwright-e2e-ui-design.md` — paused plan this unblocks
- `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md` — CopilotKit bridge precedent (CF Function + viewer-request rewrite on the same Distribution)
- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/schematics/init/schematic.js:89-94` — NF init schematic proves `es-module-shims` goes in `polyfills`
- `node_modules/.pnpm/@angular+build@21.2.3/.../src/builders/application/schema.json` — `fileReplacements` definition ("Replace compilation source files with other compilation source files") — evidence that asset files are not in scope
- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js:30-39` — post-build script tag rewriting + esms-options injection
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/config/federation-config.d.ts:8` — `SharedConfig.includeSecondaries`
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/utils/mapped-paths.js:27` — `sharedMappings` is literal string match
- `/Users/fabiovitali/WebstormProjects/shape-frontends/apps/editor/project.json` — Nx `config` + `deploy` target pattern
- `/Users/fabiovitali/WebstormProjects/shape-services/services/editor/editor-web/src/service.stack.ts` + `constructs/cdn.ts` — CDK counterpart reference (pattern inspiration only; this spec does **not** extract `Cdn` / `Identity` as reusable constructs — see non-goals). Useful fields to borrow verbatim: bucket + distribution wiring, SSM export names. Skip the `FrontendDeploymentRole` — deferred to CI spec per §4.
- GitHub `angular-architects/module-federation-plugin` issue #1044 — NF v4 migration announcement (deferred to future track)
