# B4 — Shell Deploy Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CDK `BucketDeployment` construct in `investor-web` with an explicit `deploy-shell` Nx target backed by `infrastructure/scripts/deploy-shell.sh`, and wire it into `infrastructure/scripts/deploy.sh` as Phase 4b.

**Architecture:** Two new files (`deploy-shell.sh`, `test-deploy-shell.sh`); one new SSM export (`web/shellBucketName`); one new Nx target (`deploy-shell` chaining `nestfolio-host:config → nestfolio-host:build → deploy-shell.sh`); one new phase in `deploy.sh`. Discovery is SSM-only (Pillar 3). Invalidation paths are surgical and exclude `/mfe/<key>/*`.

**Tech Stack:** AWS CDK (TypeScript), Nx 21.5, pnpm, bash, AWS CLI v2, jest with `aws-cdk-lib/assertions`.

**Spec:** [`docs/superpowers/specs/2026-04-26-b4-shell-deploy-migration-design.md`](../specs/2026-04-26-b4-shell-deploy-migration-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `services/investor/investor-web/src/service.stack.ts` | Modify | Remove `BucketDeployment` import + construct; add `web/shellBucketName` SSM export |
| `services/investor/investor-web/test/unit/service.stack.test.ts` | Modify | Two new assertions: no BucketDeployment, SSM export exists |
| `services/investor/investor-web/project.json` | Modify | Add `deploy-shell` target |
| `services/investor/investor-web/CLAUDE.md` | Modify | Doc: replace BucketDeployment ref; add SSM row |
| `infrastructure/scripts/deploy-shell.sh` | Create | s3 sync + invalidation via SSM-discovered bucket + distribution |
| `infrastructure/scripts/test-deploy-shell.sh` | Create | shellcheck wrapper (skip-if-unavailable) |
| `infrastructure/scripts/deploy.sh` | Modify | Add Phase 4b block after Phase 4a |

Tests live in `test/unit/` per workspace convention. Bash tests sit alongside the scripts they test, mirroring the `scripts/test-assert-shell-html.sh` pattern.

---

## Task 1: Add `web/shellBucketName` SSM export (TDD)

**Files:**
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts`
- Modify: `services/investor/investor-web/src/service.stack.ts:346-358` (SSM exports block)

- [ ] **Step 1: Add the failing test**

Open `services/investor/investor-web/test/unit/service.stack.test.ts`. After the existing top-level `describe('InvestorWebStack — CopilotKit bridge', ...)` block (around the file's last closing `});`), append a new describe block. Make sure `Match` is already imported at the top — it is (line 3).

```ts
describe('InvestorWebStack — shell bucket SSM export (B4)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStack', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('exports the shell bucket name to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/web/shellBucketName',
      Value: Match.anyValue(),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-web:test -t shell\\ bucket\\ SSM\\ export`

Expected: FAIL — assertion finds no SSM parameter with `Name: '/nestfolio/test-investor/web/shellBucketName'`.

- [ ] **Step 3: Add the SSM export**

Open `services/investor/investor-web/src/service.stack.ts`. Find the existing `DistributionIdParam` SSM export at lines 363-366. Immediately after it (before the closing `}` of the constructor, line 367), insert:

```ts
    new StringParameter(this, 'ShellBucketNameParam', {
      parameterName: this.naming.ssmParameterPath('web/shellBucketName'),
      stringValue: assetsBucket.bucketName,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-web:test`

Expected: all tests PASS, including the new "exports the shell bucket name to SSM" assertion.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "feat(investor-web): SSM-export shell bucket name as web/shellBucketName

The new deploy-shell Nx target (B4) needs to discover the bucket name at
deploy time. Pillar 3 says discovery via SSM, so this exports the
auto-generated CDK bucket name alongside the existing web/distributionId
+ web/distributionUrl exports.

B4 plan: docs/superpowers/plans/2026-04-26-b4-shell-deploy-migration.md"
```

---

## Task 2: Delete the `BucketDeployment` construct (TDD)

**Files:**
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts`
- Modify: `services/investor/investor-web/src/service.stack.ts:5` (import) and lines 240-249 (construct)

- [ ] **Step 1: Add the failing test**

In the same `describe('InvestorWebStack — shell bucket SSM export (B4)', ...)` block from Task 1, add a second `it` after the SSM-export assertion:

```ts
  it('does not create a BucketDeployment for the shell', () => {
    // Shell upload is handled by the deploy-shell Nx target, not by CDK.
    template.resourceCountIs('Custom::CDKBucketDeployment', 0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-web:test`

Expected: FAIL — `Custom::CDKBucketDeployment` count is 1 (the existing `BucketDeployment` synthesizes one custom resource).

- [ ] **Step 3: Delete the BucketDeployment block**

Open `services/investor/investor-web/src/service.stack.ts`.

a) Remove line 5 (the import):
```ts
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
```

b) Remove lines 240-249 (the construct + its leading comment), which currently read:
```ts
    // Upload the built nestfolio-host shell to the assets bucket. The build must be run
    // before `cdk deploy` — the deploy script handles this. CloudFront's 404→/index.html
    // error response takes care of SPA routing.
    new BucketDeployment(this, 'ShellDeployment', {
      sources: [Source.asset(join(__dirname, '../../../../dist/apps/nestfolio-host/browser'))],
      destinationBucket: assetsBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });
```

Leave a single blank line between the `Distribution` declaration (ending at line 238) and the next block ("CopilotKit bridge" comment).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-web:test`

Expected: all tests PASS, including both new assertions.

- [ ] **Step 5: Run lint to verify the unused import removal is clean**

Run: `pnpm nx run investor-web:lint`

Expected: PASS. (If FAIL, the failure should explain — most likely an unrelated pre-existing issue, in which case re-check the diff before proceeding.)

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "refactor(investor-web): remove BucketDeployment from stack (B4)

The construct (added in cb53a711) coupled cdk deploy to shell upload.
Replaced by the deploy-shell Nx target (next commits). The bucket itself
+ autoDeleteObjects behavior + the CloudFront/OAI wiring are unchanged.

B4 spec: docs/superpowers/specs/2026-04-26-b4-shell-deploy-migration-design.md"
```

---

## Task 3: Create `infrastructure/scripts/deploy-shell.sh`

**Files:**
- Create: `infrastructure/scripts/deploy-shell.sh`

- [ ] **Step 1: Write the script**

Create `infrastructure/scripts/deploy-shell.sh` with this exact content:

```bash
#!/usr/bin/env bash
# deploy-shell.sh — Upload built nestfolio-host shell to investor-web's S3
# bucket and invalidate the CloudFront paths the shell owns.
#
# Discovery: SSM (web/shellBucketName, web/distributionId) under the
# investor subsystem (Pillar 3 — see MFE charter §5 row 9a).
#
# Region resolution mirrors deploy.sh:95 — $2 takes precedence, then
# $CDK_DEFAULT_REGION, then us-east-1.
#
# Invalidation paths are surgical: only paths the shell owns under the
# default CloudFront behavior. /mfe/<key>/* is owned by per-BFF stacks
# and is NEVER invalidated by this script.

set -euo pipefail

PREFIX=${1:?Usage: deploy-shell.sh <prefix> [region] [--dry-run]}
shift

REGION_ARG=""
DRY_RUN="false"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="true" ;;
    *) REGION_ARG="$arg" ;;
  esac
done

REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: Shell deploy failed. Prefix: $PREFIX, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/nestfolio-host/browser"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: Shell bundle not found at $DIST_DIR." >&2
  echo "Run 'pnpm nx run nestfolio-host:build' first." >&2
  exit 1
fi

BUCKET_PARAM="/nestfolio/${PREFIX}-investor/web/shellBucketName"
DIST_ID_PARAM="/nestfolio/${PREFIX}-investor/web/distributionId"

BUCKET=$(aws ssm get-parameter --name "$BUCKET_PARAM" --region "$REGION" \
  --query 'Parameter.Value' --output text)
DIST_ID=$(aws ssm get-parameter --name "$DIST_ID_PARAM" --region "$REGION" \
  --query 'Parameter.Value' --output text)

echo "Shell deploy: prefix=$PREFIX region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /index.html /assets/* /remoteEntry.json"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths /index.html "/assets/*" /remoteEntry.json >/dev/null
echo "Shell deployed."
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x infrastructure/scripts/deploy-shell.sh`

- [ ] **Step 3: Smoke-test the script's argument parsing with --dry-run**

This step does NOT actually call AWS — `--dry-run` short-circuits before the AWS calls. Wait — re-read the script: `--dry-run` runs AFTER the `aws ssm get-parameter` calls, so it does need real AWS access. Skip the live-AWS smoke until Task 8 (full end-to-end manual verify).

For now, just sanity-check the script parses arguments with bash:

Run: `bash -n infrastructure/scripts/deploy-shell.sh`

Expected: no output (bash parse OK).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/scripts/deploy-shell.sh
git commit -m "feat: add infrastructure/scripts/deploy-shell.sh (B4)

s3 sync + cloudfront invalidation for the shell bundle. SSM-discovers
bucket name + distribution ID from the investor subsystem. Surgical
invalidation paths exclude /mfe/<key>/* per charter row 9a.

Used by the deploy-shell Nx target (next commit) and deploy.sh Phase 4b."
```

---

## Task 4: Create `infrastructure/scripts/test-deploy-shell.sh`

**Files:**
- Create: `infrastructure/scripts/test-deploy-shell.sh`

- [ ] **Step 1: Write the test runner**

Create `infrastructure/scripts/test-deploy-shell.sh` with this exact content:

```bash
#!/usr/bin/env bash
# test-deploy-shell.sh — Lint deploy-shell.sh with shellcheck.
# Skips with a notice if shellcheck is not installed (matches the pattern
# used by scripts/test-assert-shell-html.sh).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck not installed — skipping. Install with: brew install shellcheck"
  exit 0
fi

shellcheck "$SCRIPT_DIR/deploy-shell.sh"
echo "deploy-shell.sh: shellcheck OK"
```

- [ ] **Step 2: Make the test runner executable**

Run: `chmod +x infrastructure/scripts/test-deploy-shell.sh`

- [ ] **Step 3: Run it**

Run: `bash infrastructure/scripts/test-deploy-shell.sh`

Expected: either "shellcheck not installed — skipping" OR "deploy-shell.sh: shellcheck OK". If shellcheck IS installed and reports issues, fix them in `deploy-shell.sh` before continuing.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/scripts/test-deploy-shell.sh
git commit -m "test: add shellcheck wrapper for deploy-shell.sh (B4)

Mirrors scripts/test-assert-shell-html.sh: lint when shellcheck is
available, skip cleanly otherwise. Catches the realistic failure modes
of a 30-line straight-line bash script."
```

---

## Task 5: Add `deploy-shell` Nx target to `investor-web/project.json`

**Files:**
- Modify: `services/investor/investor-web/project.json`

- [ ] **Step 1: Add the target**

Open `services/investor/investor-web/project.json`. Find the existing `deploy` target (lines 7-12). Immediately after the closing brace of `deploy`'s definition (line 12, the `},` after `"command": "..."` closes), insert a new target:

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
    },
```

The full `targets` block, after the edit, should look like:

```json
{
  "name": "investor-web",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/investor/investor-web/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
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
    },
    "destroy": { ... },
    "synth": { ... },
    "test": { ... },
    "lint": { ... }
  },
  "tags": ["scope:investor", "type:web"]
}
```

(`destroy`, `synth`, `test`, `lint` are unchanged; `...` is shorthand here, do NOT replace their bodies.)

- [ ] **Step 2: Verify Nx parses the project**

Run: `pnpm nx show project investor-web --json | jq '.targets | keys'`

Expected output (key order may vary):
```json
[
  "deploy",
  "deploy-shell",
  "destroy",
  "lint",
  "synth",
  "test"
]
```

- [ ] **Step 3: Verify the new target's command list**

Run: `pnpm nx show project investor-web --json | jq '.targets["deploy-shell"]'`

Expected output:
```json
{
  "executor": "nx:run-commands",
  "options": {
    "cwd": "{workspaceRoot}",
    "parallel": false,
    "commands": [
      "pnpm nx run nestfolio-host:config --prefix={args.prefix}",
      "pnpm nx run nestfolio-host:build",
      "bash infrastructure/scripts/deploy-shell.sh {args.prefix}"
    ]
  },
  "configurations": {}
}
```

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-web/project.json
git commit -m "feat(investor-web): add deploy-shell Nx target (B4)

Chains nestfolio-host:config -> nestfolio-host:build ->
infrastructure/scripts/deploy-shell.sh. Realizes Pillar 3's
config -> build -> deploy pipeline order for the shell.

Invocation: pnpm nx run investor-web:deploy-shell --prefix=<prefix>"
```

---

## Task 6: Wire Phase 4b into `infrastructure/scripts/deploy.sh`

**Files:**
- Modify: `infrastructure/scripts/deploy.sh:309` (insert new block after Phase 4a, before Phase 4 hub re-deploy)

- [ ] **Step 1: Add the Phase 4b block**

Open `infrastructure/scripts/deploy.sh`. Locate the closing `fi` of the Phase 4a block (currently at line 309, immediately before the `# Phase 4: Re-deploy hubs` comment on line 311).

Insert the following block on a new line AFTER line 309 (the closing `fi`) and BEFORE line 311 (the `# Phase 4: Re-deploy hubs` comment), keeping one blank line of separation on each side:

```bash
  # Phase 4b: Upload shell bundle to investor-web's S3 bucket. Runs after
  # investor-web is in its final state (Phase 2 steady-state OR Phase 4a
  # cold-start re-deploy). Reads bucket name + distribution ID from SSM
  # (web/shellBucketName, web/distributionId).
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

The two-space indent matches the surrounding `for TARGET_IDX` loop body.

- [ ] **Step 2: Verify with `bash -n` syntax check**

Run: `bash -n infrastructure/scripts/deploy.sh`

Expected: no output (bash parse OK).

- [ ] **Step 3: Verify Phase 4b appears in the dry-run output**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --dry-run`

Expected output includes (among other dry-run lines):
```
Phase 4b (shell upload):
  [DRY RUN] Would run: pnpm nx run investor-web:deploy-shell --prefix=dev
```

If the Phase 4b line does NOT appear, re-check insertion location — it must be inside the `for TARGET_IDX` loop, after Phase 4a, before Phase 4 hub re-deploy.

- [ ] **Step 4: Verify Phase 4b is SKIPPED when investor-web is excluded**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff --dry-run`

Expected: NO `Phase 4b` line in output. (`is_service_included "investor-web"` returns false because `advisory-bff` is the only service in the filter.)

- [ ] **Step 5: Run the existing shellcheck-equivalent (if any)**

Run: `shellcheck infrastructure/scripts/deploy.sh || echo "shellcheck not available or warnings exist"`

Expected: existing warnings allowed (don't fix unrelated pre-existing issues); the new block must not introduce NEW shellcheck warnings. If you see new warnings from the new block, fix them before committing.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/scripts/deploy.sh
git commit -m "feat: wire shell upload as Phase 4b in deploy.sh (B4)

Runs after Phase 4a (cold-start re-deploy) — at this point investor-web
is in its final state and web/shellBucketName + web/distributionId are
guaranteed published. Gated on is_service_included so --services
filters propagate. Honors --dry-run. Multi-region: CDK_DEFAULT_REGION
is exported per target before the nx call."
```

---

## Task 7: Update `services/investor/investor-web/CLAUDE.md`

**Files:**
- Modify: `services/investor/investor-web/CLAUDE.md`

- [ ] **Step 1: Update the S3 AssetsBucket section**

Open `services/investor/investor-web/CLAUDE.md`. Find the `### S3 AssetsBucket` heading. The current bullet list reads:

```
### S3 AssetsBucket
- Shell static assets (S3-managed encryption, block all public access)
- BucketDeployment from `dist/apps/nestfolio-host/browser`; invalidates `/*` on deploy
```

Replace with:

```
### S3 AssetsBucket
- Shell static assets (S3-managed encryption, block all public access)
- Bundle uploaded by the `deploy-shell` Nx target via `infrastructure/scripts/deploy-shell.sh` (s3 sync + invalidation of `/index.html`, `/assets/*`, `/remoteEntry.json`). Bucket name SSM-exported as `web/shellBucketName`.
```

- [ ] **Step 2: Add the new SSM parameter to the published list**

Find the `## SSM Parameters Published` heading. Current list:

```
- `auth/userPoolId`
- `auth/userPoolClientId`
- `auth/region`
- `web/distributionUrl`
- `web/distributionId`  ← consumed by the per-BFF `MfeBucket` construct to scope the CloudFront OAC bucket policy
```

Add a new bullet at the end (after `web/distributionId`):

```
- `web/shellBucketName`  ← consumed by `infrastructure/scripts/deploy-shell.sh` to discover the upload target
```

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-web/CLAUDE.md
git commit -m "docs(investor-web): update CLAUDE.md for B4 shell deploy migration

S3 AssetsBucket section: replace BucketDeployment reference with the
new deploy-shell Nx target. SSM Parameters Published: add
web/shellBucketName."
```

---

## Task 8: End-to-end manual verification

**Files:** none modified — purely verification.

- [ ] **Step 1: Run all unit tests for investor-web**

Run: `pnpm nx run investor-web:test`

Expected: all tests PASS, including the two new B4 assertions ("does not create a BucketDeployment for the shell" + "exports the shell bucket name to SSM").

- [ ] **Step 2: Run lint for investor-web**

Run: `pnpm nx run investor-web:lint`

Expected: PASS. New unused-import warnings on `BucketDeployment`/`Source` would surface here; resolve by re-checking Task 2 step 3 if so.

- [ ] **Step 3: Run shellcheck on the new script**

Run: `bash infrastructure/scripts/test-deploy-shell.sh`

Expected: "deploy-shell.sh: shellcheck OK" (or skip notice).

- [ ] **Step 4: Synthesize the investor-web stack to confirm no synth errors**

Run: `pnpm nx run investor-web:synth --prefix=dev`

Expected: `cdk synth` completes without errors. Confirms the SSM export wiring + the BucketDeployment removal don't break synthesis.

- [ ] **Step 5: Verify Phase 4b dry-run output**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --dry-run`

Expected output includes:
```
Phase 4b (shell upload):
  [DRY RUN] Would run: pnpm nx run investor-web:deploy-shell --prefix=dev
```

- [ ] **Step 6: STOP — handoff to user for real-deploy verification**

Real deploy + browser verification are not automated steps. Print this message and stop:

```
B4 implementation complete. The next step is a real sandbox deploy:

  bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web

After the deploy completes:
  1. Read web/distributionUrl from SSM:
     aws ssm get-parameter --name /nestfolio/dev-investor/web/distributionUrl \
       --query Parameter.Value --output text
  2. Open <distribution-url>/login in a browser; expect the shell to render.

Note: the C1 plan (paused Playwright) is the canonical behavioural gate
for the full charter; B4 alone does not unblock it.
```

Wait for user confirmation before doing anything else.

---

## Self-review

**Spec coverage:**
- §4.1.A SSM export → Task 1 ✓
- §4.1.B `deploy-shell.sh` → Task 3 ✓
- §4.1.C Nx target → Task 5 ✓
- §4.1.D Phase 4b in deploy.sh → Task 6 ✓
- §4.2 BucketDeployment removal → Task 2 ✓
- §4.3 CLAUDE.md update → Task 7 ✓
- §6 surgical invalidation paths → encoded in Task 3's script ✓
- §7.1 jest assertions → Tasks 1 + 2 ✓
- §7.2 shellcheck wrapper + `--dry-run` flag → Task 4 + Task 3 ✓
- §7.3 deploy.sh dry-run check → Task 6 step 3 ✓
- §7.4 real-deploy verification → Task 8 step 6 ✓

**Placeholder scan:** none.

**Type consistency:** `web/shellBucketName` SSM param name used identically in `service.stack.ts` (Task 1), `deploy-shell.sh` (Task 3), and `CLAUDE.md` (Task 7). Invalidation path list (`/index.html`, `/assets/*`, `/remoteEntry.json`) used identically in the script (Task 3) and the doc (Task 7). The Nx target name `deploy-shell` is consistent across `project.json` (Task 5), `deploy.sh` Phase 4b (Task 6), and `CLAUDE.md` (Task 7). The script path `infrastructure/scripts/deploy-shell.sh` is consistent across `project.json` (Task 5), `deploy.sh` (implied via the Nx target it calls), `test-deploy-shell.sh` (Task 4), and `CLAUDE.md` (Task 7).

**Scope:** all tasks are within B4. No drift into B1, B2, B3, or other migration phases.
