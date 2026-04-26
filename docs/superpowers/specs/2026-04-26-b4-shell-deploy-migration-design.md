# B4 — Shell deploy migration

**Status:** Proposed
**Date:** 2026-04-26
**References:**
- Roadmap: [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) §B4
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) §5 row 9a, §6 `investor-web`, Pillar 3

## 1. Context

Commit `cb53a711` (2026-04-23) added a CDK `BucketDeployment` construct inside `services/investor/investor-web/src/service.stack.ts` so that `cdk deploy` would upload the built shell to the assets bucket. It was a stop-gap: the bucket existed since the original investor-web stack but was never populated, so every CloudFront request returned `NoSuchKey`.

The charter (§5 row 9a + §6) says `investor-web` owns the *shell deploy pipeline*, but the charter also says (Pillar 1) "per-app `build` and `deploy` Nx targets — no central deploy orchestrator." `BucketDeployment` violates Pillar 1's spirit: shell upload is welded into CDK synthesis, runs every `cdk deploy` regardless of whether the shell changed, and uses a CloudFormation custom-resource Lambda for what is fundamentally an `aws s3 sync`.

B4 replaces that with an explicit, callable Nx target on `investor-web` that runs the shell pipeline as it should: `config → build → s3 sync → invalidate`.

## 2. Problem

Three concrete defects of the current state:

- **Coupling:** `cdk deploy` and shell upload are one operation. You cannot redeploy the shell without re-synthesizing the stack, and you cannot redeploy the stack without re-uploading the shell.
- **Cold-start waste:** the cold-start re-deploy pattern (Phase 4a in `deploy.sh` re-runs `investor-web` with `mfeBehaviors=true` after BFFs publish their SSM exports) currently re-uploads the shell on every cold start, doubling work.
- **Wrong invalidation surface:** the `BucketDeployment` invalidates `/*`, which clears MFE caches at `/mfe/<key>/*` — caches owned by other teams' BFF stacks, per charter §5 row 9b. Shell deploys should only invalidate shell-owned paths.

## 3. Goals and non-goals

### Goals

- Delete the `BucketDeployment` construct from `investor-web`.
- Add an explicit `deploy-shell` Nx target on `investor-web` that runs `config → build → s3 sync → invalidate`.
- Discover bucket name + distribution ID via SSM (consistent with Pillar 3).
- Wire shell upload into `infrastructure/scripts/deploy.sh` as Phase 4b.
- Keep invalidation paths surgical: only paths the shell owns; never `/mfe/<key>/*`.

### Non-goals

- Migrating other deploy patterns (BFF MFE-bundle uploads — that's part of the per-BFF deploy story, separate plan).
- Adding a runtime-config writer to MFEs (Pillar 3 corollary; A4 already shipped this for the shell).
- Consolidating the three scripts directories (`/scripts/`, `/infrastructure/scripts/`, `/tools/scripts/`) — flagged in brainstorming as mildly inconsistent, deferred.
- Adding `deploy.sh`-level automated tests (none exist today; not B4 scope).

## 4. Architecture

Three small additions, two small deletions, one CLAUDE.md update.

### 4.1 — Components added

**A. SSM export `web/shellBucketName`** in `services/investor/investor-web/src/service.stack.ts`.

Sits next to the existing `web/distributionId` and `web/distributionUrl` exports. Resolves the auto-generated CloudFormation bucket name to a discoverable parameter at deploy-time (same dynamic-reference pattern the existing `web/distributionUrl` uses for `distributionDomainName`).

**B. `infrastructure/scripts/deploy-shell.sh`** — new file, ~30 lines.

Inputs:
- `$1 = PREFIX` (required)
- `$2 = REGION` (optional; falls back to `${CDK_DEFAULT_REGION:-us-east-1}` — matches the convention at `infrastructure/scripts/deploy.sh:95`)
- `--dry-run` (optional flag, parsed independently of positional args)

Behavior:
1. `aws ssm get-parameter` to resolve `web/shellBucketName` and `web/distributionId`.
2. `aws s3 sync dist/apps/nestfolio-host/browser "s3://$BUCKET" --delete`.
3. `aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths /index.html "/assets/*" /remoteEntry.json`.

`set -euo pipefail` + ERR trap with a clear message.

**C. `deploy-shell` Nx target** in `services/investor/investor-web/project.json`:

```json
"deploy-shell": {
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "parallel": false,
    "commands": [
      "pnpm nx run nestfolio-host:config --prefix={args.prefix}",
      "pnpm nx run nestfolio-host:build",
      "bash infrastructure/scripts/deploy-shell.sh {args.prefix}"
    ]
  }
}
```

The three commands realize Pillar 3's `config → build → deploy` pipeline order. `config` is uncached (reads SSM with the current prefix); `build` is cached on inputs (re-runs when `config.json`, source, or CSP changes).

**D. Phase 4b block in `infrastructure/scripts/deploy.sh`** — after Phase 4a, before hub re-deploy, inside the per-target `for TARGET_IDX` loop:

```bash
# Phase 4b: Upload shell bundle to investor-web's S3 bucket.
if is_service_included "investor-web"; then
  echo ""
  echo "Phase 4b (shell upload):"
  if [ -n "$TARGET_REGION" ]; then
    export CDK_DEFAULT_REGION="$TARGET_REGION"
  fi
  if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY RUN] Would run: pnpm nx run investor-web:deploy-shell --prefix=$PREFIX"
  else
    pnpm nx run investor-web:deploy-shell --prefix="$PREFIX" || {
      echo "ERROR: Shell upload failed. Tier: $TIER, Prefix: $PREFIX." >&2
      exit 1
    }
  fi
fi
```

Gated on `is_service_included "investor-web"` so `deploy.sh sandbox --services=advisory-bff` is a no-op for the shell. The `CDK_DEFAULT_REGION` export ensures multi-region deploys (production loop) propagate the right region into the nx subprocess.

### 4.2 — Components deleted

**`services/investor/investor-web/src/service.stack.ts`:**

- Line 5 import: `import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';`
- Lines 240–249 construct + comment: the entire `new BucketDeployment(this, 'ShellDeployment', { ... })` block.

After the delete, the auto-generated CDKBucketDeployment Lambda + IAM role + custom resource handler all disappear from the synthesized template.

### 4.3 — Documentation

`services/investor/investor-web/CLAUDE.md` updated:

- "S3 AssetsBucket" section: the `BucketDeployment` line replaced with "Bundle uploaded by the `deploy-shell` Nx target via `infrastructure/scripts/deploy-shell.sh` (s3 sync + invalidation). Bucket name SSM-exported as `web/shellBucketName`."
- "SSM Parameters Published": new row `web/shellBucketName`.

## 5. Data flow

### Steady-state deploy

```
deploy.sh sandbox --prefix=dev
  Phase 1: hubs
  Phase 2: investor-web cdk deploy (mfeBehaviors=true)
           → publishes web/shellBucketName, web/distributionId
  Phase 3: BFFs
  Phase 4b: nx run investor-web:deploy-shell --prefix=dev
            ├─ nx run nestfolio-host:config --prefix=dev
            │  └─ scripts/fetch-runtime-config.sh writes config.json
            ├─ nx run nestfolio-host:build
            │  └─ dist/apps/nestfolio-host/browser/ produced
            └─ infrastructure/scripts/deploy-shell.sh dev
               ├─ aws ssm get-parameter web/shellBucketName, web/distributionId
               ├─ aws s3 sync ... --delete
               └─ aws cloudfront create-invalidation
                  --paths /index.html /assets/* /remoteEntry.json
```

### Cold-start deploy

Same as steady-state, except Phase 2 deploys `investor-web` with `mfeBehaviors=false` (BFF SSM exports don't yet exist). Phase 3 deploys BFFs which publish their `mfe/bucketName` + `api/apiId` exports. Phase 4a re-deploys `investor-web` with `mfeBehaviors=true`. Phase 4b uploads the shell once, against the now-final state.

### Local dev

`nx serve nestfolio-host` is unchanged. The deploy pipeline is irrelevant to dev-server operation.

## 6. Invalidation strategy

CloudFront has no exclude syntax — invalidation paths are include-only. The shell only owns root-behavior paths; everything else is owned by other behaviors:

| Path | Owner | Invalidate on shell deploy? |
|---|---|---|
| `/index.html` | shell (root behavior) | **yes** — unhashed; references new bundle hashes |
| `/assets/*` | shell (root behavior) | **yes** — `config.json`, favicons; unhashed |
| `/remoteEntry.json` | shell (root behavior) | **yes** — federation manifest; unhashed |
| `/main.<hash>.js`, `/polyfills.<hash>.js`, `/styles.<hash>.css` | shell | **no** — output hashing emits new filenames per build |
| `/mfe/<key>/*` | each BFF | **no** — owned by another team |
| `/graphql/<domain>` | each BFF (AppSync) | **no** — proxy, never cached |
| `/realtime/<domain>` | each BFF (AppSync WSS) | **no** — proxy, never cached |
| `/api/copilotkit*` | onboarding-bff | **no** — proxy |

Three invalidation paths per deploy. CloudFront's free tier is 1000 paths/month — operationally irrelevant cost.

## 7. Testing

Three surfaces, scaled to risk.

### 7.1 — CDK stack (jest, must-have)

`services/investor/investor-web/test/unit/service.stack.test.ts` adds two assertions:

```ts
it('does not create a BucketDeployment for the shell', () => {
  template.resourceCountIs('Custom::CDKBucketDeployment', 0);
});

it('exports the shell bucket name to SSM', () => {
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/nestfolio/test-investor/web/shellBucketName',
    Value: Match.anyValue(),
  });
});
```

Protects against accidental re-introduction of the construct + missing SSM export (which would make `deploy-shell.sh` fail with `ParameterNotFound`).

### 7.2 — `deploy-shell.sh` (lightweight, must-have)

- **Shellcheck smoke** — sibling `infrastructure/scripts/test-deploy-shell.sh` runs `shellcheck infrastructure/scripts/deploy-shell.sh`; skips with notice if shellcheck is missing (matches `scripts/test-assert-shell-html.sh` pattern).
- **`--dry-run` flag in the script itself** — when set, prints resolved bucket name + distribution ID + the s3 sync and invalidation commands without executing them. Lets `deploy.sh --dry-run` propagate cleanly.

A full bats/mock-aws unit test is overkill for a ~30-line script.

### 7.3 — `deploy.sh` integration (manual)

```
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --dry-run
```

Output must include `Phase 4b (shell upload):` + the dry-run echo. No automated test for `deploy.sh` exists today.

### 7.4 — Real-deploy verification

After merge: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev` must complete and the shell `/login` route must still serve from CloudFront.

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| First post-merge `cdk deploy` removes the BucketDeployment custom resource but leaves prior shell objects in the bucket. | Low | Phase 4b runs immediately after with `aws s3 sync --delete`, reconciling drift. |
| `web/shellBucketName` SSM param missing → `deploy-shell.sh` fails | Medium | Phase 4b runs **after** Phase 2/4a (which publishes it). Fail-loud is correct: never upload to a bucket we can't discover. |
| Angular toolchain absence in deploy environment | Medium | Existing `deploy.sh` already runs `pnpm nx run-many -t build-agent`; node toolchain assumption already holds. |
| Multi-region `CDK_DEFAULT_REGION` propagation | Low | Explicit `export CDK_DEFAULT_REGION="$TARGET_REGION"` before the nx call. |
| `--services=investor-web` post cold-start (no Phase 4a triggered) | None | Phase 4b is gated only on `is_service_included`; runs regardless of cold-start state. |

## 9. Charter conformance

- **§5 row 9a** (`investor-web` owns shell bucket + shell deploy + CSP delivery + SSM exports) — ✓ shell deploy now a first-class Nx target on `investor-web`.
- **§5 row 10** (per-app build + deploy targets) — ✓ `investor-web:deploy` (cdk) + `investor-web:deploy-shell` (s3 sync) are two explicit Nx targets owned by the same app.
- **§6 `investor-web` IS NOT** "a deploy orchestrator for app code other than the shell" — ✓ `deploy-shell` only handles the shell.
- **Pillar 1** (per-app deploy targets, no central orchestrator) — ✓ `deploy.sh` calls each target; doesn't synthesize them.
- **Pillar 3** (discovery via SSM) — ✓ bucket name + distribution ID both SSM-discovered.

## 10. Out of scope

- Removing other CDK-managed deploy paths (none exist in this repo today besides the one B4 deletes).
- Migrating per-BFF MFE-bundle uploads to the same pattern — that's a separate plan keyed off B1/B2 timing.
- Authoring `deploy.sh`-level integration tests.
- Resolving the `/scripts/` vs `/infrastructure/scripts/` vs `/tools/scripts/` split.
