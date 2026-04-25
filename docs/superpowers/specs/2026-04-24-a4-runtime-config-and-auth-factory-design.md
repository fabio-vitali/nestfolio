# A4 — Runtime config producer + auth factory injection — design

## 1. Context

The MFE architecture charter (`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`) Pillar 3 requires runtime configuration to flow through a single producer/consumer chain rooted in SSM, with the shell as the only consumer that fetches it. Charter §8 ("Bootstrap discipline") explicitly forbids eager capture of placeholder `environment.ts` literals at provider-setup time, naming "deployed shell silently authenticates against a nonexistent Cognito pool" as the failure class to eliminate.

Currently:

- `apps/nestfolio-host/src/app/app.config.ts:95` calls `provideAuth(environment.auth)` — eager capture, the exact anti-pattern §8 calls out.
- `app.config.ts:46-64` (`loadRuntimeConfig`) silently falls back to `environment.ts` when fetch fails.
- `apps/nestfolio-host/public/assets/config.json` is checked into git with placeholder values.
- `apps/nestfolio-host/src/environments/{environment.ts, environment.prod.ts}` carry resource literals (`userPoolId`, `clientId`, AppSync endpoints, copilot URL) — Pillar 3 violation.
- `services/investor/investor-web/src/service.stack.ts` exports `auth/userPoolId` and `auth/userPoolClientId` but **not** `auth/region`.

A4 is the third migration step in the MFE charter roadmap (`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`), bundling the producer (script + Nx target) with the auth-side factory injection refactor. It realises §5 row 5, §8, and Pillar 3 of the charter.

## 2. Goals

- Eliminate every `environment.ts` resource literal read in the shell.
- Make all runtime-config consumption flow through a factory-resolved DI token (charter §8 bootstrap discipline).
- Establish the `fetch-runtime-config.sh` producer as the single source of truth for `apps/nestfolio-host/public/assets/config.json`.
- Adopt the abstract-class-as-DI-token pattern for `AuthConfig` (proven in `shape-frontends/libs/core/auth`), seeding the precedent for B3's `AppSyncConfig` flip and any future shell-core lib alignment.
- Fail hard on missing/malformed runtime config, with named remediation messages — no silent fallback.

## 3. Non-goals

- Refactoring `libs/shell/src/auth/auth.service.ts` from a functions module into an `@Injectable` class. (Out of A4 scope; future shell-core alignment plan.)
- Co-locating stores under their owning sub-lib (`libs/shell/src/stores/auth.store.ts` → `libs/shell/src/auth/`). (Same reason.)
- Flipping `AppSyncConfig` to abstract class or adopting factory injection for Apollo. **Deferred to B3.**
- Adding a `proxy.conf.json` for local CopilotKit dev or otherwise reshaping local dev mode beyond what falls out of the producer.
- Adding a per-BFF `api/region` SSM export. The single `auth/region` value is reused across all four BFF entries in the emitted `config.json` (all currently `us-east-1`).
- Touching `COPILOT_API_URL` (currently `InjectionToken<string>`) — single primitive doesn't justify abstract-class wrapping.

## 4. Architecture

Three-piece chain, single direction of dependency:

```
SSM (CDK-published)
        │
        ▼
scripts/fetch-runtime-config.sh   ←── invoked by `pnpm nx run nestfolio-host:config --prefix=<prefix>`
        │
        ▼
apps/nestfolio-host/public/assets/config.json   (gitignored)
        │
        ▼
loadRuntimeConfig (APP_INITIALIZER, fail-hard)
        │
        ▼
DI tokens
  - AuthConfig (this plan)
  - AppSyncConfig + Apollo factory (deferred to B3)
        │
        ▼
provideAuth() (no args) — APP_INITIALIZER reads inject(AuthConfig), configures Amplify
```

### 4.1 Producer

`scripts/fetch-runtime-config.sh` — bash, takes `--prefix=<prefix>` (required) and `--region=<region>` (optional, default `us-east-1`). Reads SSM via `aws ssm get-parameter`. Writes `apps/nestfolio-host/public/assets/config.json`. Fails non-zero with a named-path error if any param is missing or AWS creds are unavailable.

SSM paths read (subsystem-scoped under `<prefix>-investor`, service-scoped for BFFs):

| Path | Maps to | Source today |
|------|---------|--------------|
| `/nestfolio/<prefix>-investor/auth/userPoolId` | `auth.userPoolId` | investor-web stack (existing) |
| `/nestfolio/<prefix>-investor/auth/userPoolClientId` | `auth.clientId` | investor-web stack (existing) |
| `/nestfolio/<prefix>-investor/auth/region` | `auth.region` and `appsync.*Bff.region` (all four) | **NEW** — A4 adds this export |
| `/nestfolio/<prefix>-investor/web/distributionUrl` | base for `copilotApiUrl` (= `<distributionUrl>/api/copilotkit`) | investor-web stack (existing) |
| `/nestfolio/<prefix>-investor-bff/api/graphqlUrl` | `appsync.investorBff.endpoint` | investor-bff Facade (existing) |
| `/nestfolio/<prefix>-advisory-bff/api/graphqlUrl` | `appsync.advisoryBff.endpoint` | advisory-bff Facade (existing) |
| `/nestfolio/<prefix>-ledger-bff/api/graphqlUrl` | `appsync.ledgerBff.endpoint` | ledger-bff Facade (existing) |
| `/nestfolio/<prefix>-dashboard-bff/api/graphqlUrl` | `appsync.dashboardBff.endpoint` | dashboard-bff Facade (existing) |

The agent runtime ARN (`/nestfolio/<prefix>-onboarding-bff/agent/runtimeUrl`) is **NOT** read by the producer. The frontend never sees it directly — it's a synth-time CDK fact used by `services/investor/investor-web/src/service.stack.ts:154-163` to build the `/api/copilotkit*` CloudFront behavior.

### 4.2 Nx config target

New target on `apps/nestfolio-host/project.json`:

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
}
```

`cache: false` because the script's output depends on AWS state, not just on the script's source. The target is a **manual prereq** — `serve` and `esbuild` do **not** declare `dependsOn: ["config"]`. Charter §8 pipeline order (`config → build → deploy`) is documented and enforced by convention, not by Nx coupling. Justification: coupling `serve` to `config` would mean every developer running `nx serve` without AWS creds gets an opaque error from inside Nx — too many ways to confuse the failure mode.

Workflow:

```bash
# Once after pulling / when prefix changes:
pnpm nx run nestfolio-host:config --prefix=dev

# Then normal dev:
pnpm nx serve nestfolio-host
```

### 4.3 Loader

The existing `loadRuntimeConfig` in `apps/nestfolio-host/src/app/app.config.ts` is rewritten:

- No `environment.production` short-circuit (the file no longer exists).
- No silent catch-fallback to `environment`.
- Always fetches `/assets/config.json`.
- On fetch 404, JSON parse error, or `validateEndpoints` failure, throws a named-remediation error (concrete messages enumerated in §6 below).

### 4.4 DI tokens

`libs/shell/src/auth/auth.config.ts` flips from `interface` to `abstract class`:

```ts
export abstract class AuthConfig {
  abstract userPoolId: string;
  abstract clientId: string;
  abstract region: string;
}
```

The class is both the type AND the DI token — consumers do `inject(AuthConfig)`. Pattern proven in `shape-frontends/libs/core/auth/src/lib/auth-config.ts`.

`provideAuth()` becomes no-args:

```ts
// libs/shell/src/auth/auth.provider.ts
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

App-level wiring in `apps/nestfolio-host/src/app/app.config.ts`:

```ts
{ provide: AuthConfig, useFactory: () => getRuntimeConfig().auth },
provideAuth(),
```

### 4.5 JSON payload shape

```json
{
  "auth": {
    "userPoolId": "us-east-1_XXX",
    "clientId": "YYY",
    "region": "us-east-1"
  },
  "appsync": {
    "investorBff":  { "endpoint": "https://...", "region": "us-east-1" },
    "advisoryBff":  { "endpoint": "https://...", "region": "us-east-1" },
    "dashboardBff": { "endpoint": "https://...", "region": "us-east-1" },
    "ledgerBff":    { "endpoint": "https://...", "region": "us-east-1" }
  },
  "copilotApiUrl": "https://<distribution-domain>/api/copilotkit"
}
```

The stale `portfolioBff` field present in the currently-checked-in `config.json` is removed.

## 5. File map

### Add

- `scripts/fetch-runtime-config.sh` — bash producer.
- `scripts/fetch-runtime-config.test.mjs` — `node:test` runner with a tmpdir-based sandbox; stubs `aws` on PATH (matches the existing pattern from `scripts/emit-index-html.test.mjs`).

### Modify

- `services/investor/investor-web/src/service.stack.ts` — add `auth/region` SSM export (sources value from `Stack.region`).
- `services/investor/investor-web/test/unit/service.stack.test.ts` — assert new SSM resource for `auth/region`.
- `services/investor/investor-web/CLAUDE.md` — add `auth/region` to "SSM Parameters Published".
- `apps/nestfolio-host/project.json` — add `config` target.
- `apps/nestfolio-host/src/app/app.config.ts`:
  - Drop `import { environment } from '../environments/environment'`.
  - Rewrite `loadRuntimeConfig`: always fetch, fail-hard, no env fallback.
  - Replace `provideAuth(environment.auth)` with `provideAuth()` (no args).
  - Add `{ provide: AuthConfig, useFactory: () => getRuntimeConfig().auth }` provider entry (placed BEFORE the `loadRuntimeConfig` APP_INITIALIZER — but Angular evaluates `useFactory` lazily on first `inject(AuthConfig)`, so ordering of the provider entry doesn't matter; ordering of APP_INITIALIZERs does, see §6.4).
- `libs/shell/src/auth/auth.config.ts` — flip `interface AuthConfig` → `abstract class AuthConfig`.
- `libs/shell/src/auth/auth.provider.ts` — rewrite per §4.4.
- `libs/shell/src/auth/index.ts` — `export { AuthConfig }` becomes a value-export (was type-only). The `export type { AuthConfig }` line changes to `export { AuthConfig }`.
- `apps/nestfolio-host/test/app/app.config.spec.ts` — adjust for new failure semantics.
- `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` — adjust for fail-hard.
- `apps/nestfolio-host/test/app/provide-graphql.spec.ts` — verify whether it reads `environment` directly (likely no, but to be confirmed in plan); update if so.
- `.gitignore` — add `apps/nestfolio-host/public/assets/config.json`.

### Delete

- `apps/nestfolio-host/src/environments/environment.ts`
- `apps/nestfolio-host/src/environments/environment.prod.ts`
- `apps/nestfolio-host/src/environments/` (resulting empty directory)
- `apps/nestfolio-host/public/assets/config.json` (currently checked-in placeholder; replaced by gitignored producer output)

## 6. Failure modes

### 6.1 Producer (`fetch-runtime-config.sh`)

| Failure | Behavior | Message |
|---------|----------|---------|
| `aws` CLI not installed | exit 127 | `aws CLI not found. Install via your package manager.` |
| AWS credentials unset/expired | exit 1 | `Missing AWS credentials. Run \`leapp session start\` or set AWS_PROFILE.` |
| Required SSM param missing | exit 1 | `SSM param not found: <full-path>. Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=<prefix> --services=<owning-service>\` first.` |
| Unknown CLI flag | exit 2 | usage string |
| Write to output path fails | exit 1 | `Failed to write apps/nestfolio-host/public/assets/config.json: <reason>.` |

### 6.2 Loader (`loadRuntimeConfig` in app.config.ts)

| Failure | Behavior | Message |
|---------|----------|---------|
| `fetch('/assets/config.json')` returns non-200 | throws | `Runtime config not found at /assets/config.json. Run \`pnpm nx run nestfolio-host:config --prefix=<prefix>\`.` |
| Response body is not valid JSON | throws | `Runtime config malformed at /assets/config.json. Re-run \`pnpm nx run nestfolio-host:config --prefix=<prefix>\`.` |
| `validateEndpoints` rejects an endpoint | throws | existing message (`Invalid endpoint URL: ...`) preserved |

`<prefix>` is not known at runtime in the browser (build doesn't bake it in — Pillar 3). The error message uses the literal `<prefix>` and a trailing hint: ``(<prefix> is the value passed to your last `deploy.sh` invocation, typically `dev` for local)``.

### 6.3 Schema validation

The existing `validateEndpoints` (https-or-localhost check) is preserved and continues to gate the loader. **No new schema validator (Zod/typia) is introduced** — TypeScript narrowing at the `RuntimeConfig` boundary plus `validateEndpoints` is sufficient. Adding a runtime schema validator is its own future improvement.

### 6.4 APP_INITIALIZER ordering

The shell registers three APP_INITIALIZERs in `app.config.ts` (after A4):

1. `loadRuntimeConfig` — populates `runtimeConfig`, must run first.
2. `initializeAuth` — calls `getAuthUser()`, depends on Amplify being configured.
3. `inject(FeatureFlagService)` — feature flag bootstrap.

Plus the implicit one inside `provideAuth()` that calls `Amplify.configure(inject(AuthConfig))`.

Angular runs all `APP_INITIALIZER` factories in **registration order**, awaiting each in turn. The `AuthConfig` factory is invoked lazily when the `provideAuth()` initializer calls `inject(AuthConfig)`. As long as `loadRuntimeConfig` is registered **before** `provideAuth()` in the `providers` array, the chain is sound. The plan must lock this ordering and the test in `app.config.spec.ts` must assert it.

## 7. Charter alignment

| Charter section | Realised by |
|-----------------|-------------|
| §5 row 5 ("MFEs consume runtime config via DI tokens; shell is the only producer/loader") | Producer Nx target on shell only; `AuthConfig` token exposed by `@nestfolio/shell/auth`. |
| §8 Producer | `scripts/fetch-runtime-config.sh` + `nestfolio-host:config` target. |
| §8 SSM path convention | All paths via `NamingService.ssmParameterPath()` / `ssmServicePath()` — no new convention introduced. |
| §8 Pipeline order (`config → build → deploy`) | Manual ordering documented; no Nx `dependsOn` coupling. |
| §8 Payload shape | Producer emits the `RuntimeConfig` shape verbatim. |
| §8 MFE consumption | `AuthConfig` injectable via `@nestfolio/shell/auth`. (B3 will add the Apollo factory side.) |
| §8 Bootstrap discipline (Pillar 3 corollary) | `provideAuth()` no-args + factory-bound `AuthConfig` provider. |
| §8 Adding a runtime-config field | The producer + loader are the single touchpoints; precedent set for future fields. |
| Pillar 3 | No `environment.ts` resource literals anywhere. |

## 8. Testing

### 8.1 Producer script

Test harness: `node:test` runner with a `tmpdir`-based sandbox. The test stubs `aws` on PATH (a `mock-aws` script that emits canned responses) and asserts the producer's stdout/exit code and the produced `config.json`.

Harness choice rationale: the workspace already uses `node:test` for `scripts/emit-index-html.test.mjs` (added in A1) — same pattern.

Cases:
- Happy path: all SSM params present → exit 0, valid `config.json` matching the documented shape.
- Missing `auth/userPoolId` → exit 1, error names the missing path AND the remediation command.
- `aws` returns non-zero (creds expired) → exit 1, error names creds remediation.
- `--prefix` flag missing → exit 2, usage string.

### 8.2 Loader (`loadRuntimeConfig` in app.config.ts)

Existing spec at `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` is rewritten:

- Happy path: `fetch` returns valid JSON → `getRuntimeConfig()` returns it.
- 404 response → throws with named remediation.
- Malformed JSON → throws with named remediation.
- `validateEndpoints` rejects → existing throw preserved.
- The "no environment fallback" property: even if fetch fails, `getRuntimeConfig()` does NOT silently return placeholders.

### 8.3 `provideAuth()`

New cases in `libs/shell/test/auth/auth.provider.spec.ts` (or alongside existing tests):

- `Amplify.configure` is called with values from `inject(AuthConfig)`.
- The factory is **not** captured at provider-setup time — confirmed by injecting an `AuthConfig` whose `userPoolId` is set AFTER providers are created (e.g. via a deferred factory).

### 8.4 `service.stack.test.ts` (investor-web)

Assert that `auth/region` SSM parameter resource is created with the expected name pattern.

### 8.5 `app.config.spec.ts`

Assert that:
- `loadRuntimeConfig` APP_INITIALIZER appears in the providers list **before** `provideAuth()`.
- `AuthConfig` provider uses a factory (not `useValue`).

## 9. Pattern adoption survey (informational)

The abstract-class-as-DI-token pattern is used by ~10 core libs in `shape-frontends/libs/core/` (auth, analytics, graphql, media, storage, tracker, etc.). A4 is the first nestfolio adoption.

Other current nestfolio configs that should adopt the same flip in future plans:

| File | Plan |
|------|------|
| `libs/shell/src/graphql/appsync.config.ts` (currently `interface AppSyncConfig` + `InjectionToken<AppSyncConfig>`) | **B3** — same flip, alongside Apollo factory injection. |

Out of scope for both A4 and B3 (worth a dedicated plan):

- `libs/shell/src/auth/auth.service.ts` is currently a functions module, not an `@Injectable` class. shape-frontends has it as `@Injectable` with `constructor() { const cfg = inject(AuthConfig); Amplify.configure(...) }`. Migrating to that shape is a structural change.
- Stores live flat under `libs/shell/src/stores/` rather than co-located under `auth/`, `tenant/`, etc. shape-frontends co-locates them.

These are tracked here for traceability but not actioned in A4.

## 10. References

- Charter: `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` — Pillar 3, §5 row 5, §8.
- Roadmap: `docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md` — A4 entry.
- Naming convention: `libs/cdk-constructs/src/utils/naming-service.ts` — used as-is.
- Pattern reference: `/Users/fabiovitali/WebstormProjects/shape-frontends/libs/core/auth/` — auth-config + provider + service shape.
- A1 precedent (Nx target with custom inputs/outputs): `apps/nestfolio-host/project.json` `prepare-index` target.
- Onboarding/CopilotKit chain: `services/investor/onboarding-bff/src/service.stack.ts:99-107` (SSM publish), `services/investor/investor-web/src/service.stack.ts:150-219` (CloudFront `/api/copilotkit*` behavior).
