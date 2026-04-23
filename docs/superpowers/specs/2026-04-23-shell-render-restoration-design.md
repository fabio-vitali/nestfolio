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
- Pre-launch footprint: no new regression gate added by this spec. Fix the shell, resume the paused Playwright plan.

## Non-goals

- Migrating to Native Federation v4 (`@native-federation/*` — announced 2026-01-22, issue #1044). Version 21.2.x stays in maintenance on the current track; a migration is a future separate spec.
- Renaming / moving `services/investor/investor-web/`. Investor-domain ownership is retained (Cognito emits to InvestorBus, CopilotKit bridge targets the intra-domain `onboarding-bff`).
- Adding a custom domain / ACM certificate. The default `*.cloudfront.net` hostname stays.
- Extracting `Cdn` + `Identity` as reusable constructs à la shape-services. YAGNI — there is one web surface.
- `ParameterApi`-backed runtime manifest resolution. Same-origin + fixed prefixes make this unnecessary.
- A new regression gate. The paused Playwright plan is the gate; it resumes once this spec is implemented.
- Touching `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`. That plan is paused pending this work.

## High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Federation track | Fix Native Federation v21.2.x in place | v4 migration is a separate track; the current gap is mechanical |
| `es-module-shims` delivery | Add to esbuild `polyfills` array per app | Matches NF init schematic; gets bundled into `polyfills-*.js`; no `<script src>` in index.html |
| Subpath resolution for npm packages | `includeSecondaries: true` on selected shared entries | Native NF mechanism; covers `@primeuix/themes/aura`, `graphql/*`, aws-appsync-* |
| `url` bare specifier | Added to `shared` (it's the browser-safe `url@^0.11.0` npm package) | Not a Node shim issue — NF just needs to know to resolve it |
| Workspace subpath mapping | Explicit tsconfig keys + explicit `sharedMappings` entries | `mapped-paths.js:27` does literal string match; wildcards don't expand |
| CSP strategy | sha256 hash of NF's deterministic `{"shimMode":true}` esms-options inline | Stable across builds; no `'unsafe-inline'` |
| CSP source of truth | Both meta tag AND CF `ResponseHeadersPolicy`, kept in sync | Meta covers dev-server (no CF); CF overrides for prod |
| Deploy model | Per-app Nx `config` + `deploy` targets using AWS CLI + SSM | shape-frontends pattern; no CDK BucketDeployment cross-stack complexity |
| Bucket topology | Single shared bucket owned by `investor-web` | Analog of a shared EventBridge bus; each frontend app writes under its prefix |
| Distribution topology | Single CloudFront distribution owned by `investor-web`; one generic `/*` behavior | Same-origin eliminates CORS, keeps `federation.manifest.json` static |
| MFE bundle layout | Shell at bucket root; MFEs at `/mfe/<key>/` | Deterministic; manifest is a checked-in static JSON |
| Runtime config | Nx build-time SSM fetch writes JSON assets into `src/assets/config/` | shape-frontends pattern; replaces the (never-instantiated) CDK `RuntimeConfig` construct |
| Regression gate | None in this spec | Pre-launch; paused Playwright plan is the real gate |

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
│     }}                  │                      │ SSM:                         │
│   sharedMappings: [     │                      │   /frontend/bucketName       │
│     @nestfolio/ui,      │                      │   /frontend/distributionId   │
│     @nestfolio/ui/FF,   │                      │   /auth/userPoolId           │
│     @nestfolio/shell,   │                      │   /auth/userPoolClientId     │
│     @nestfolio/shell/*  │                      │   /web/distributionUrl       │
│   ] (explicit)          │                      │ FrontendDeploymentRole (IAM) │
│ project.json            │                      └──────────────────────────────┘
│   polyfills: [es-module-                                      │
│     shims]              │                                     │
│ src/index.html          │                          apps/<app>/project.json
│   meta CSP = match CF   │                          ┌──────────────────────────┐
│ src/assets/             │                          │ config target:           │
│   federation.manifest   │                          │   fetch-auth-config.sh   │
│     .json (static,      │                          │   fetch-bff-endpoints.sh │
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
Add `es-module-shims@^1.5.12` to workspace `package.json` (devDependencies or dependencies — matches NF init schematic at `src/schematics/init/schematic.js:88-92`).

Effect: `polyfills-*.js` bundle includes es-module-shims, which registers globally. NF's post-build `updateIndexHtml.js:37-38` rewrites the `<script>` tags so `polyfills-*.js` loads as `type="module"` and `main-*.js` loads as `type="module-shim"`. The browser picks up main.js via es-module-shims.

**1.2 `includeSecondaries: true` on npm packages with subpath imports**

Current: `federation.config.js` calls `share({ '@primeuix/themes': { ... }, 'graphql': { ... }, ... })` without `includeSecondaries`.
Fix: set `includeSecondaries: true` on:
- `@primeuix/themes` (subpath: `@primeuix/themes/aura`, imported by `libs/ui/src/theme/nestfolio-preset.ts`)
- `graphql` (subpaths: `graphql/index.js`, `graphql/language/printer.js`, imported by aws-appsync-*)
- `aws-appsync-auth-link` (internally imports `url`, others)
- `aws-appsync-subscription-link` (same)

Verified against `@softarc/native-federation` 3.5.4 `SharedConfig.includeSecondaries?: boolean` in `federation-config.d.ts:8`.

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

**1.5 `federation.manifest.json` with relative URLs**

Current: `apps/nestfolio-host/public/assets/federation.manifest.json` points at `http://localhost:4201..4205/remoteEntry.json` — unreachable from deployed CloudFront.

Fix: **two manifest files**, selected per configuration:
- `federation.manifest.json` (prod/static — same-origin, checked in):
  ```json
  {
    "investor-mfe":   "/mfe/investor/remoteEntry.json",
    "advisory-mfe":   "/mfe/advisory/remoteEntry.json",
    "dashboard-mfe":  "/mfe/dashboard/remoteEntry.json",
    "ledger-mfe":     "/mfe/ledger/remoteEntry.json",
    "onboarding-mfe": "/mfe/onboarding/remoteEntry.json"
  }
  ```
- `federation.manifest.dev.json` (dev-server only — keeps localhost ports, driven by `apps/*/project.json` MFE `serve-static` ports):
  ```json
  {
    "investor-mfe":   "http://localhost:4201/remoteEntry.json",
    ...
  }
  ```

Selection: Angular `fileReplacements` in `apps/nestfolio-host/project.json` swaps the dev file in for `serve` / `serve-static`. Prod build uses the static same-origin manifest directly.

### 2. CSP strategy

NF's post-build injects exactly: `<script type="esms-options">{"shimMode":true}</script>` — content is deterministic (`updateIndexHtml.js:30-35` with no `esmsInitOptions` passed in our `build` target).

Compute once: `echo -n '{"shimMode":true}' | openssl dgst -sha256 -binary | openssl base64`. That hash is stable unless NF bumps the injection shape.

Apply in two places:

**`apps/nestfolio-host/src/index.html`** — update meta tag:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-<hash>'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ...">
```

**`services/investor/investor-web/src/service.stack.ts`** — update `ResponseHeadersPolicy`:
```ts
contentSecurityPolicy: {
  contentSecurityPolicy: "default-src 'self'; script-src 'self' 'sha256-<hash>'; style-src 'self' 'unsafe-inline'; ...",
  override: true,
},
```

Hash stored as a constant in a shared location (e.g. `apps/nestfolio-host/src/esms-options-hash.ts`); both sites read from it to stay in sync. Build-time assertion is out of scope for this spec but natural future work.

### 3. Deploy model (Nx + AWS CLI + SSM)

Mirrors `shape-frontends/apps/*/project.json`. **Shell** (`nestfolio-host`) gains both `config` and `deploy` targets; **MFEs** gain only `deploy` (they are loaded into the federated shell at runtime and share its config — no per-MFE config file is needed in the current topology).

**`config` target** (shell only) — build-time SSM fetch:
```json
"config": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "commands": [
      "./scripts/fetch-auth-config.sh {projectName} {projectRoot}/src/assets/config/auth.json {args.region} {args.stage}",
      "./scripts/fetch-bff-endpoints.sh {projectName} {projectRoot}/src/assets/config/bff.json {args.region} {args.stage}"
    ]
  }
}
```

Scripts (new, in `scripts/`):
- `fetch-auth-config.sh` — reads `/nestfolio/<stage>-investor-web/auth/userPoolId`, `/auth/userPoolClientId`; writes JSON
- `fetch-bff-endpoints.sh` — reads `/nestfolio/<stage>-<bff>/api/graphqlUrl` for each BFF the shell consumes (investor-bff, advisory-bff, dashboard-bff, ledger-bff, onboarding-bff — the explicit list lives IN the shell since the shell already imports per-BFF GraphQL schemas); writes one merged JSON

`--stage local` branches write placeholder JSONs — unblocks local dev without AWS creds.

JSON assets live at `apps/nestfolio-host/src/assets/config/*.json`, gitignored, included by Angular's `assets:` directive in `apps/nestfolio-host/project.json`. Shell reads them at bootstrap via `fetch('/assets/config/auth.json')` + `fetch('/assets/config/bff.json')`, wiring results into the existing `RuntimeConfigService`.

**`deploy` target** — AWS CLI sync + CF invalidation:
```json
"deploy": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "commands": [
      "BUCKET=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor-web/frontend/bucketName --region {args.region} --query Parameter.Value --output text) && aws s3 sync dist/apps/{projectName}/browser s3://$BUCKET/<prefix> --region {args.region} --delete",
      "DIST=$(aws ssm get-parameter --name /nestfolio/{args.stage}-investor-web/frontend/distributionId --region {args.region} --query Parameter.Value --output text) && aws cloudfront create-invalidation --region {args.region} --distribution-id $DIST --paths '/<prefix>*'"
    ],
    "parallel": false
  }
}
```

`<prefix>`:
- Shell (`nestfolio-host`): empty (root)
- MFE (`<key>-mfe`): `mfe/<key>/`

Invalidation scoped per prefix (not `/*`) to keep cache thrash low when one app redeploys.

**Delete**: `libs/cdk-constructs/src/extensions/runtime-config.ts` (never instantiated; replaced by the Nx flow).

### 4. investor-web CDK refactor (minimal)

`services/investor/investor-web/src/service.stack.ts` changes:

**Add** `StringParameter` exports:
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

**Add** `FrontendDeploymentRole` (IAM) assumable by the deploy principal:
- Grants: `s3:PutObject`/`DeleteObject`/`ListBucket` on the bucket, `cloudfront:CreateInvalidation` on the distribution
- Assumed by: local dev's IAM principal (Leapp-resolved) for sandbox; CI role in future.

**Remove** the shell `BucketDeployment` added in commit `cb53a711`:
```ts
// DELETE:
// new BucketDeployment(this, 'ShellDeployment', { ... });
```

The shell now deploys itself via `nx run nestfolio-host:deploy`.

**Update** CSP in `ResponseHeadersPolicy` as per Section 2.

**Keep**: Cognito, triggers, `/api/copilotkit*` CopilotKit bridge, existing SSM parameters.

### 5. Regression gate

Per the pre-launch, no-users context: no separate gate is added by this spec. After shell render is verified (probe script at `/tmp/nf-amplify-spike/probe-cf.mjs`), the paused `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` resumes. That plan's Phase 1 smoke scenario serves as the ongoing gate.

A post-build `index.html` assertion (polyfills-as-module, main-as-module-shim, esms-options inline present) is a natural future addition but is explicitly **not in this spec's scope**.

## Success criteria

- `pnpm nx serve nestfolio-host` renders `/login` with visible `<input>` fields in Chrome within 10s.
- `pnpm nx serve-static nestfolio-host` renders `/login` identically in headless Chromium (verified via `/tmp/nf-amplify-spike/probe-cf.mjs` pattern).
- `pnpm nx run nestfolio-host:deploy --stage=dev --region=us-east-1` uploads the shell to S3 and invalidates; deployed CloudFront URL renders `/login`.
- `pnpm nx run investor-mfe:deploy --stage=dev --region=us-east-1` (and same for other 4 MFEs) uploads each MFE to `/mfe/<key>/` and invalidates.
- The shell `/onboarding` route successfully loads `onboarding-mfe` via `loadRemoteModule` with no federation errors in console.
- Browser Network tab shows: 1× `polyfills-*.js` (module), 1× `main-*.js` (module-shim), N× shared package imports resolved via the generated import map, 1× `remoteEntry.json` per MFE lazily fetched on route navigation.
- DevTools Console has zero CSP violation reports.
- Paused Playwright plan (`docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`) is unpaused; its Task 0 probe passes against the deployed URL.

## Out of scope (restated)

- Native Federation v4 migration
- Rename / relocation of `investor-web`
- Custom domain, ACM cert, Route53
- Reusable `Cdn` / `Identity` CDK constructs
- `ParameterApi`-backed runtime manifest resolution
- New regression tests (build-time `index.html` assertion, CSP header curl check, CI gate)
- Any change to `apps/e2e-feature-tests/` or the Playwright plan document itself

## Unblocks

- `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` (paused since 2026-04-22)
- All future frontend PRs — `nx serve` and `nx serve-static` become trustworthy again

## References

- `memory/project_shell_render_broken.md` — the 2026-04-22 diagnosis (corrected: url module is not a Node shim issue)
- `docs/superpowers/specs/2026-04-22-playwright-e2e-ui-design.md` — paused plan this unblocks
- `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md` — CopilotKit bridge precedent (CF Function + viewer-request rewrite on the same Distribution)
- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/schematics/init/schematic.js:88-92` — NF init schematic proves `es-module-shims` goes in `polyfills`
- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js:30-39` — post-build script tag rewriting + esms-options injection
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/config/federation-config.d.ts:8` — `SharedConfig.includeSecondaries`
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/utils/mapped-paths.js:27` — `sharedMappings` is literal string match
- `/Users/fabiovitali/WebstormProjects/shape-frontends/apps/editor/project.json` — Nx `config` + `deploy` target pattern
- `/Users/fabiovitali/WebstormProjects/shape-services/services/editor/editor-web/src/service.stack.ts` + `constructs/cdn.ts` — CDK counterpart: bucket + distribution + SSM exports + `FrontendDeploymentRole`
- GitHub `angular-architects/module-federation-plugin` issue #1044 — NF v4 migration announcement (deferred to future track)
