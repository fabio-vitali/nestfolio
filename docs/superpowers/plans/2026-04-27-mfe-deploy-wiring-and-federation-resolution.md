# MFE Deploy Wiring & Federation Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two pre-existing bugs surfaced by Phase C's `cf-smoke` probe so charter graduation can be claimed: (a) deployed `federation.manifest.json` still has `http://localhost:4201..4205` URLs because no deploy step rewrites it and per-BFF MFE buckets are empty; (b) `@primeuix/themes/aura` fails runtime resolution because Native Federation's `includeSecondaries: true` does not enumerate glob-exports (`"./*"` in the package's `exports` map).

**Architecture:** One feature branch (`feat/d-mfe-deploy-wiring`). Two independent fix tracks executed sequentially. Track 1 (small, frontend-only): add an explicit `@primeuix/themes/aura` entry to `libs/frontend-deps/index.js`. Track 2 (deploy-pipeline, larger): each MFE gets a `deploy-mfe` Nx target that uploads its bundle to its per-BFF bucket; `infrastructure/scripts/deploy-mfes.sh` orchestrates all 5; `tools/scripts/build-prod-manifest.mjs` emits the production federation manifest from `MFE_CATALOG`; `infrastructure/scripts/deploy-shell.sh` swaps the dev manifest with the prod one before `aws s3 sync`; `infrastructure/scripts/deploy.sh` adds a new Phase 4b (MFE uploads, parallel) before the existing shell-upload phase (renumbered 4c).

**Tech Stack:** Node 20 (`mjs` scripts + `node:test` siblings); bash (deploy orchestration); `aws s3 sync` (bundle upload); `aws cloudfront create-invalidation` (per-MFE invalidation); existing Nx + `MFE_CATALOG` + per-BFF bucket SSM exports infrastructure (A3, B1, B4 shipped).

**References:**
- Phase C plan (predecessor): [`docs/superpowers/plans/2026-04-26-c-cleanup-and-playwright.md`](./2026-04-26-c-cleanup-and-playwright.md)
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](../specs/2026-04-24-mfe-architecture-charter.md) §5 row 9b, §7 R6, Pillar 3
- B4 deploy-shell pattern: `infrastructure/scripts/deploy-shell.sh`, `services/investor/investor-web/project.json` `deploy-shell` target

---

## Bug evidence (recorded for the executor)

### Bug 1 — Federation manifest

`apps/nestfolio-host/public/assets/federation.manifest.json` is the **dev** manifest:

```json
{
  "investor-mfe": "http://localhost:4201/remoteEntry.json",
  "dashboard-mfe": "http://localhost:4202/remoteEntry.json",
  "advisory-mfe": "http://localhost:4203/remoteEntry.json",
  "ledger-mfe": "http://localhost:4204/remoteEntry.json",
  "onboarding-mfe": "http://localhost:4205/remoteEntry.json"
}
```

Angular CLI's `assets: [{glob:'**/*', input:'apps/nestfolio-host/public'}]` copies it verbatim into `dist/apps/nestfolio-host/browser/assets/federation.manifest.json`. `deploy-shell.sh` `aws s3 sync`s the dist to the shell bucket unchanged. Verified by `aws s3 cp s3://dev-investor-web-assetsbucket5cb76180-szlooqlmryzh/assets/federation.manifest.json -` — deployed manifest matches dev byte-for-byte.

The 5 per-BFF MFE buckets exist (verified via SSM):
- `771924376645-dev-nestfolio-mfe-investor` (owned by `investor-bff`)
- `771924376645-dev-nestfolio-mfe-advisory` (owned by `advisory-bff`)
- `771924376645-dev-nestfolio-mfe-ledger` (owned by `ledger-bff`)
- `771924376645-dev-nestfolio-mfe-dashboard` (owned by `dashboard-bff`)
- `771924376645-dev-nestfolio-mfe-onboarding` (owned by `onboarding-bff`)

CloudFront has the `/mfe/<key>/*` behaviors (B1 shipped). The buckets are empty — no deploy step ever uploaded the MFE bundles. Charter §5 row 9b says BFFs own their MFE bucket; they need a deploy target that uploads.

### Bug 2 — `@primeuix/themes/aura`

`libs/ui/src/theme/nestfolio-preset.ts:2` does `import Aura from '@primeuix/themes/aura'`. The package's `exports` map (`node_modules/@primeuix/themes/package.json` v2.0.3):

```json
"exports": {
  ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs", "default": "./dist/index.mjs" },
  "./types": { ... },
  "./types/*": { ... },
  "./tokens": { ... },
  "./*": { "types": "./dist/*/index.d.ts", "import": "./dist/*/index.mjs", "default": "./dist/*/index.mjs" }
}
```

The `"./*"` glob pattern is what makes `@primeuix/themes/aura` resolve to `./dist/aura/index.mjs` at TS-compile time. But:
- Native Federation's `includeSecondaries: true` walks the package's `exports` map at federation-build time and emits one importmap entry per **enumerable** subpath. Glob exports are not enumerable.
- Result: federation runtime importmap has `@primeuix/themes` (root) but no `@primeuix/themes/aura`, and the runtime error `Unable to resolve specifier '@primeuix/themes/aura' imported from .../_nestfolio_ui-*.js` follows.

Confirmation: `node_modules/@primeuix/themes/aura/` directory does NOT exist (Bash `ls` returned "No such file or directory"). The subpath is purely virtual via the glob `exports` map.

Fix: add an explicit `'@primeuix/themes/aura': singletonOpts` entry to `libs/frontend-deps/index.js`. This forces a concrete importmap entry alongside the existing parent `'@primeuix/themes': singletonWithSecondaries`.

---

## File Structure (end state)

**Files created:**
- `tools/scripts/build-prod-manifest.mjs` — emits prod `federation.manifest.json` from `MFE_CATALOG`
- `tools/scripts/build-prod-manifest.test.mjs` — node:test sibling (3 cases)
- `infrastructure/scripts/deploy-mfes.sh` — orchestrates `nx run <mfe>:deploy-mfe` for all 5 MFEs in parallel
- `infrastructure/scripts/deploy-mfe.sh` — uploads ONE MFE bundle to its per-BFF bucket; invalidates `/mfe/<key>/*`
- `infrastructure/scripts/test-deploy-mfe-shellcheck.sh` — shellcheck wrapper test (matches B4's `test-deploy-shell-shellcheck.sh` pattern)

**Files modified:**
- `libs/frontend-deps/index.js` — add `'@primeuix/themes/aura': singletonOpts`
- `apps/{investor,advisory,ledger,dashboard,onboarding}-mfe/project.json` — add `deploy-mfe` Nx target chained on `build`
- `infrastructure/scripts/deploy-shell.sh` — call `tools/scripts/build-prod-manifest.mjs` to overwrite `dist/.../federation.manifest.json` before `aws s3 sync`; extend invalidation paths to include `/federation.manifest.json` and `/assets/federation.manifest.json`
- `infrastructure/scripts/deploy.sh` — insert new Phase 4b (MFE uploads via `deploy-mfes.sh`) BEFORE existing Phase 4b (renumbered Phase 4c, shell upload)

**Files unchanged but referenced:**
- `services/investor/investor-web/src/mfe-catalog.ts` — single source of truth for `(key, service, hasFacade)` triples
- `tools/scripts/list-mfe-catalog.mjs` — existing helper for bash to read the catalog as JSON
- `apps/nestfolio-host/public/assets/federation.manifest.json` — stays as dev manifest (used by `pnpm nx serve nestfolio-host`); replaced in dist at deploy time, never edited

---

## Pre-flight (do once, not a commit)

- [ ] **Step 1: Create branch from `main`**

Run:
```bash
cd /Users/fabiovitali/WebstormProjects/nestfolio
git checkout main
git pull --ff-only
git checkout -b feat/d-mfe-deploy-wiring
git status --short
git log --oneline -3
```

Expected: clean tree on `feat/d-mfe-deploy-wiring`. The most recent commit on main should be `888b0561 Merge branch 'feat/c-cleanup-and-playwright'` (Phase C merge).

- [ ] **Step 2: Capture baseline cf-smoke failure for the bisect record**

Run (Leapp session must be active for AWS account 771924376645):
```bash
pnpm cf-smoke --prefix=dev 2>&1 | tail -30
```

Expected: FAILS on all 5 routes with two error classes:
1. `Failed to fetch http://localhost:4204/remoteEntry.json` (and 4201..4205 variants)
2. `Unable to resolve specifier '@primeuix/themes/aura' imported from https://.../_nestfolio_ui-*.js`

This is the regression bar this plan must clear. Save the output in scratch (not committed).

---

## Task 1: Fix `@primeuix/themes/aura` resolution in `frontend-deps`

**Files:**
- Modify: `libs/frontend-deps/index.js`

**Why:** Smallest, fastest fix; isolates the @primeuix/themes/aura class of bugs from the deploy-pipeline track. Ships as its own commit so a smoke regression bisect is mechanical.

- [ ] **Step 1: Read the current `frontend-deps/index.js`**

Run:
```bash
cat libs/frontend-deps/index.js
```

Expected current shape (relevant excerpt):
```js
const sharedFrontendDeps = share({
  ...
  '@primeuix/themes': singletonWithSecondaries,
  ...
});
```

- [ ] **Step 2: Add an explicit `@primeuix/themes/aura` entry**

Edit `libs/frontend-deps/index.js`. Find the line `'@primeuix/themes': singletonWithSecondaries,` and add a sibling line for the explicit subpath. The full surrounding block should become:

```js
  '@primeuix/themes': singletonWithSecondaries,
  '@primeuix/themes/aura': singletonOpts,
```

(Use `singletonOpts`, not `singletonWithSecondaries` — `aura` is a leaf subpath; it has no further sub-secondaries.)

**Why this works:** the package's `exports` field uses a glob `"./*"` pattern that maps any subpath to `./dist/<subpath>/index.mjs`. Native Federation's `includeSecondaries: true` walks the `exports` map at build time and emits one importmap entry per enumerable subpath, but glob patterns are not enumerable — they require explicit declaration. Adding an explicit `'@primeuix/themes/aura'` entry forces the federation builder to emit a concrete importmap entry that resolves at runtime.

- [ ] **Step 3: Rebuild the shell + a sample MFE; verify importmap contains the subpath**

Run:
```bash
pnpm nx run nestfolio-host:build
pnpm nx run investor-mfe:build
```

Expected: both green (assert-shell-html OK).

Verify the emitted importmap on the shell side:
```bash
node -e "
const r = require('./dist/apps/nestfolio-host/browser/remoteEntry.json');
const k = Object.keys(r.shared || {}).filter(s => s.includes('primeuix') || s.includes('aura'));
console.log(k.join('\n'));
"
```

Expected: includes `@primeuix/themes/aura` as a separate entry. (Also includes `@primeuix/themes` and any `@primeuix/themes/*` entries `includeSecondaries` did happen to capture.)

If the listed keys do NOT include `@primeuix/themes/aura`, the explicit entry didn't take. Re-read `libs/frontend-deps/index.js` and confirm the line was inserted exactly as shown in Step 2 (no typos in the package name, no missing comma).

- [ ] **Step 4: Verify the federation builder hasn't regressed**

Run:
```bash
pnpm nx run-many -t build --projects=nestfolio-host,investor-mfe,advisory-mfe,ledger-mfe,dashboard-mfe,onboarding-mfe
```

Expected: all 6 green; `assert-shell-html` passes for the shell (5 CSP rules + frame-ancestors absence).

- [ ] **Step 5: Verify the charter-invariants gate is unaffected**

Run:
```bash
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: `OK (0 hits)` (the gate is unchanged — `@primeuix/themes/aura` has no `appsync-api`/`amazonaws.com` substring, so it's outside the gate's pattern).

- [ ] **Step 6: Commit**

Run:
```bash
git add libs/frontend-deps/index.js
git commit -m "$(cat <<'EOF'
fix(frontend-deps): explicit @primeuix/themes/aura entry for federation importmap

cf-smoke against deployed dev CloudFront caught:
  Unable to resolve specifier '@primeuix/themes/aura'
  imported from https://.../_nestfolio_ui-*.js

Root cause: @primeuix/themes v2.0.3's exports map uses a glob `"./*"` that
maps any subpath to `./dist/<subpath>/index.mjs`. Native Federation's
includeSecondaries: true walks the exports map at build time but does not
enumerate glob patterns — only literal subpaths. The federation runtime's
importmap therefore had no `@primeuix/themes/aura` entry.

Fix: explicit `'@primeuix/themes/aura': singletonOpts` alongside the parent
`@primeuix/themes`. Forces a concrete importmap entry. libs/ui's
nestfolio-preset.ts (the only consumer) now resolves at runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `tools/scripts/build-prod-manifest.mjs` (TDD)

**Files:**
- Create: `tools/scripts/build-prod-manifest.mjs`
- Create: `tools/scripts/build-prod-manifest.test.mjs`

**Why:** Single source of truth for production federation manifest. Reads `MFE_CATALOG` (via the existing `list-mfe-catalog.mjs` helper) and emits a manifest mapping `<mfe-name>` (e.g. `investor-mfe`) to a CloudFront-relative path `/mfe/<key>/remoteEntry.json` (e.g. `/mfe/investor/remoteEntry.json`). The mapping `<mfe-name> ↔ <key>` is mechanical: drop the `-mfe` suffix.

- [ ] **Step 1: Write the failing test**

Create `tools/scripts/build-prod-manifest.test.mjs`:

```js
// node:test sibling for build-prod-manifest.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'tools/scripts/build-prod-manifest.mjs');

function run(out) {
  return spawnSync('node', [SCRIPT, '--out', out], { encoding: 'utf8' });
}

test('emits a manifest with /mfe/<key>/remoteEntry.json for every catalog entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-prod-manifest-'));
  const out = join(dir, 'federation.manifest.json');
  try {
    const r = run(out);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    const manifest = JSON.parse(readFileSync(out, 'utf8'));

    // The 5 expected entries (matching MFE_CATALOG keys + the -mfe suffix)
    const expected = {
      'investor-mfe':   '/mfe/investor/remoteEntry.json',
      'advisory-mfe':   '/mfe/advisory/remoteEntry.json',
      'ledger-mfe':     '/mfe/ledger/remoteEntry.json',
      'dashboard-mfe':  '/mfe/dashboard/remoteEntry.json',
      'onboarding-mfe': '/mfe/onboarding/remoteEntry.json',
    };
    assert.deepEqual(manifest, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exit 2 when --out is missing', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out/);
});

test('output is stable JSON (deterministic key order, single trailing newline)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-prod-manifest-'));
  const a = join(dir, 'a.json');
  const b = join(dir, 'b.json');
  try {
    run(a);
    run(b);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
    const text = readFileSync(a, 'utf8');
    assert.ok(text.endsWith('\n'), 'manifest should end with a single newline');
    // Two-space indent (matches the dev manifest committed to the repo)
    assert.match(text, /^\{\n {2}"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
node --test tools/scripts/build-prod-manifest.test.mjs
```

Expected: 3 tests fail because the script doesn't exist (`spawnSync` returns non-zero with stderr complaining about the missing file).

- [ ] **Step 3: Create the script**

Create `tools/scripts/build-prod-manifest.mjs`:

```js
#!/usr/bin/env node
// build-prod-manifest.mjs — emit production federation.manifest.json
// from MFE_CATALOG. Maps each <mfe-name> to /mfe/<key>/remoteEntry.json
// (CloudFront-relative paths discovered via the unified topology — see
// charter §7 R6).
//
// Usage:
//   node tools/scripts/build-prod-manifest.mjs --out <path>
//
// MFE_CATALOG is read via the existing list-mfe-catalog.mjs helper. The
// mapping <mfe-name> ↔ <key> is mechanical: <key>-mfe.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogScript = join(here, 'list-mfe-catalog.mjs');

function parseArgs(argv) {
  let out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i].startsWith('--out=')) out = argv[i].slice('--out='.length);
  }
  if (!out) {
    console.error('build-prod-manifest: --out <path> is required');
    process.exit(2);
  }
  return { out };
}

function readCatalog() {
  const r = spawnSync('node', [catalogScript], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`build-prod-manifest: failed to read MFE catalog: ${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return JSON.parse(r.stdout);
}

function buildManifest(catalog) {
  const manifest = {};
  for (const entry of catalog) {
    const mfeName = `${entry.key}-mfe`;
    manifest[mfeName] = `/mfe/${entry.key}/remoteEntry.json`;
  }
  return manifest;
}

function main() {
  const { out } = parseArgs(process.argv);
  const catalog = readCatalog();
  const manifest = buildManifest(catalog);
  // Two-space indent + trailing newline — matches the committed dev manifest.
  const text = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(out, text, 'utf8');
  console.log(`build-prod-manifest: wrote ${Object.keys(manifest).length} entries to ${out}`);
}

main();
```

- [ ] **Step 4: Re-run the test — all 3 cases pass**

Run:
```bash
node --test tools/scripts/build-prod-manifest.test.mjs
```

Expected: 3 tests pass.

If any test fails, paste the failure and adjust. Common pitfalls:
- `list-mfe-catalog.mjs` is invoked with the wrong cwd — the script uses `dirname(fileURLToPath(import.meta.url))` to anchor relative to itself, not cwd.
- `--out` parsing: support both `--out path` and `--out=path` (test 2 uses no flag at all, expects exit 2).

- [ ] **Step 5: Smoke test — run the script and inspect output**

Run:
```bash
node tools/scripts/build-prod-manifest.mjs --out /tmp/nf-prod-manifest.json
cat /tmp/nf-prod-manifest.json
```

Expected:
```json
{
  "investor-mfe": "/mfe/investor/remoteEntry.json",
  "advisory-mfe": "/mfe/advisory/remoteEntry.json",
  "ledger-mfe": "/mfe/ledger/remoteEntry.json",
  "dashboard-mfe": "/mfe/dashboard/remoteEntry.json",
  "onboarding-mfe": "/mfe/onboarding/remoteEntry.json"
}
```

(Order matches `MFE_CATALOG` source order.)

- [ ] **Step 6: Verify the charter-invariants gate is unaffected**

Run:
```bash
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: `OK (0 hits)`. (The new files live under `tools/scripts/` which is outside the gate's scope — gate scans `apps/**` and `libs/{shell,frontend-deps,ui}/**` only.)

- [ ] **Step 7: Commit**

```bash
git add tools/scripts/build-prod-manifest.mjs tools/scripts/build-prod-manifest.test.mjs
git commit -m "$(cat <<'EOF'
feat(d): add build-prod-manifest.mjs to emit production federation.manifest.json

Reads MFE_CATALOG (via the existing list-mfe-catalog.mjs helper) and emits
a manifest mapping each <key>-mfe to /mfe/<key>/remoteEntry.json — the
CloudFront-relative path served by the per-BFF MFE bucket behind the
unified-topology distribution (charter §7 R6).

Single source of truth, deterministic output, 3 node:test cases. Used by
deploy-shell.sh in a follow-up commit to overwrite the committed dev
manifest before s3 sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `infrastructure/scripts/deploy-mfe.sh` (single-MFE upload)

**Files:**
- Create: `infrastructure/scripts/deploy-mfe.sh`
- Create: `infrastructure/scripts/test-deploy-mfe-shellcheck.sh`

**Why:** One script per pattern. `deploy-mfe.sh` uploads ONE MFE bundle to its per-BFF bucket and invalidates that MFE's CloudFront paths. Mirrors `deploy-shell.sh`'s shape exactly so an engineer reading either can transfer their understanding.

- [ ] **Step 1: Create `infrastructure/scripts/deploy-mfe.sh`**

```bash
#!/usr/bin/env bash
#
# deploy-mfe.sh — Upload one built MFE bundle to its BFF's S3 bucket
# and invalidate the matching CloudFront /mfe/<key>/* paths.
#
# Discovery:
#   - bucket  → SSM /nestfolio/<prefix>-<bff>/mfe/bucketName
#   - distId  → SSM /nestfolio/<prefix>-investor/web/distributionId
#                (single distribution per charter §5 row 9a)
#
# Region resolution mirrors deploy.sh: $3 takes precedence, then
# $CDK_DEFAULT_REGION, then us-east-1.
#
# Invalidation paths are surgical: only /mfe/<key>/* — the shell's paths
# are owned by deploy-shell.sh and are NEVER invalidated by this script.
#
# Usage:
#   deploy-mfe.sh <prefix> <key> [region] [--dry-run]
#
# Where <key> is an MFE_CATALOG key (investor, advisory, ledger,
# dashboard, onboarding) and matches the BFF service via <key>-bff.

set -euo pipefail

PREFIX=${1:?Usage: deploy-mfe.sh <prefix> <key> [region] [--dry-run]}
KEY=${2:?Usage: deploy-mfe.sh <prefix> <key> [region] [--dry-run]}
shift 2

REGION_ARG=""
DRY_RUN="false"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="true" ;;
    *) REGION_ARG="$arg" ;;
  esac
done

REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: MFE deploy failed. Prefix: $PREFIX, Key: $KEY, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/${KEY}-mfe/browser"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: MFE bundle not found at $DIST_DIR." >&2
  echo "Run 'pnpm nx run ${KEY}-mfe:build' first." >&2
  exit 1
fi

BFF_SERVICE="${KEY}-bff"
BUCKET_PARAM="/nestfolio/${PREFIX}-${BFF_SERVICE}/mfe/bucketName"
DIST_ID_PARAM="/nestfolio/${PREFIX}-investor/web/distributionId"

resolve_param() {
  local name="$1"
  local owner="$2"
  if ! aws ssm get-parameter --name "$name" --region "$REGION" \
       --query 'Parameter.Value' --output text 2>/dev/null; then
    echo "ERROR: SSM parameter $name not found in $REGION." >&2
    echo "Has $owner been deployed for prefix '$PREFIX'?" >&2
    echo "  bash infrastructure/scripts/deploy.sh sandbox --prefix=$PREFIX --services=$owner" >&2
    exit 1
  fi
}

BUCKET=$(resolve_param "$BUCKET_PARAM" "$BFF_SERVICE")
DIST_ID=$(resolve_param "$DIST_ID_PARAM" "investor-web")

echo "MFE deploy: prefix=$PREFIX key=$KEY region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /mfe/$KEY/*"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"

aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/mfe/$KEY/*" \
  >/dev/null

echo "MFE deployed: $KEY → s3://$BUCKET (invalidated /mfe/$KEY/*)."
```

Make it executable:
```bash
chmod +x infrastructure/scripts/deploy-mfe.sh
```

- [ ] **Step 2: Create the shellcheck wrapper test**

Create `infrastructure/scripts/test-deploy-mfe-shellcheck.sh`:

```bash
#!/usr/bin/env bash
# Shellcheck wrapper for deploy-mfe.sh. Mirrors test-deploy-shell-shellcheck.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/deploy-mfe.sh"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck not installed; skipping." >&2
  exit 0
fi

shellcheck -x "$TARGET"
```

Make it executable:
```bash
chmod +x infrastructure/scripts/test-deploy-mfe-shellcheck.sh
```

- [ ] **Step 3: Run shellcheck**

Run:
```bash
bash infrastructure/scripts/test-deploy-mfe-shellcheck.sh
```

Expected: exit 0 (either passes shellcheck cleanly, or shellcheck is not installed and the script skips). If shellcheck flags issues, fix them before committing.

- [ ] **Step 4: Smoke-test the no-bundle error path**

Run:
```bash
bash infrastructure/scripts/deploy-mfe.sh dev investor 2>&1 | head -5
```

Expected (assuming `dist/apps/investor-mfe/browser/` exists from earlier builds): success, would do real upload — interrupt with Ctrl-C if you don't want to actually deploy yet, OR run with `--dry-run`:

```bash
bash infrastructure/scripts/deploy-mfe.sh dev investor --dry-run 2>&1 | head -10
```

Expected:
```
MFE deploy: prefix=dev key=investor region=us-east-1
  Bucket:        771924376645-dev-nestfolio-mfe-investor
  Distribution:  E... (some CloudFront ID)
  Dist dir:      .../dist/apps/investor-mfe/browser
  [DRY RUN] Would: aws s3 sync ... s3://771924376645-dev-nestfolio-mfe-investor --delete --region us-east-1
  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id ... --paths /mfe/investor/*
```

- [ ] **Step 5: Smoke-test the missing-bundle error path**

Run:
```bash
bash infrastructure/scripts/deploy-mfe.sh dev nonexistent --dry-run 2>&1 | head -5
```

Expected: exit 1 with `ERROR: MFE bundle not found at .../dist/apps/nonexistent-mfe/browser.` and the remediation `Run 'pnpm nx run nonexistent-mfe:build' first.`

- [ ] **Step 6: Commit**

```bash
git add infrastructure/scripts/deploy-mfe.sh infrastructure/scripts/test-deploy-mfe-shellcheck.sh
git commit -m "$(cat <<'EOF'
feat(d): add deploy-mfe.sh — upload one MFE bundle to its BFF bucket

Mirrors deploy-shell.sh's shape exactly. Per charter §5 row 9b each BFF
owns its MFE's S3 bucket; this script discovers the bucket via SSM
/nestfolio/<prefix>-<bff>/mfe/bucketName, syncs the built MFE bundle, and
invalidates only /mfe/<key>/* on the investor-web CloudFront distribution.

Includes shellcheck wrapper test matching the B4 deploy-shell pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `deploy-mfe` Nx target on each MFE app

**Files:**
- Modify: `apps/investor-mfe/project.json`
- Modify: `apps/advisory-mfe/project.json`
- Modify: `apps/ledger-mfe/project.json`
- Modify: `apps/dashboard-mfe/project.json`
- Modify: `apps/onboarding-mfe/project.json`

**Why:** Each MFE app gets a `deploy-mfe` Nx target that chains `build` → `bash infrastructure/scripts/deploy-mfe.sh <prefix> <key>`. Mirrors `investor-web:deploy-shell` shape (which chains `nestfolio-host:config + nestfolio-host:build + bash deploy-shell.sh`).

- [ ] **Step 1: Edit `apps/investor-mfe/project.json`**

Find the `targets` object. Add a new `deploy-mfe` target. The placement does not matter; group it with `build` for readability. Insert this target into the `targets` object:

```json
    "deploy-mfe": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "{workspaceRoot}",
        "parallel": false,
        "commands": [
          "pnpm nx run investor-mfe:build",
          "bash infrastructure/scripts/deploy-mfe.sh {args.prefix} investor"
        ]
      }
    },
```

(Note: `investor` is the MFE_CATALOG key, NOT the project name `investor-mfe`. The `deploy-mfe.sh` script appends `-mfe` to derive the dist dir.)

Pay attention to JSON commas when inserting — `targets` must remain valid JSON.

- [ ] **Step 2: Edit `apps/advisory-mfe/project.json`**

Same shape, different key:
```json
    "deploy-mfe": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "{workspaceRoot}",
        "parallel": false,
        "commands": [
          "pnpm nx run advisory-mfe:build",
          "bash infrastructure/scripts/deploy-mfe.sh {args.prefix} advisory"
        ]
      }
    },
```

- [ ] **Step 3: Edit `apps/ledger-mfe/project.json`**

Same shape, key `ledger`:
```json
    "deploy-mfe": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "{workspaceRoot}",
        "parallel": false,
        "commands": [
          "pnpm nx run ledger-mfe:build",
          "bash infrastructure/scripts/deploy-mfe.sh {args.prefix} ledger"
        ]
      }
    },
```

- [ ] **Step 4: Edit `apps/dashboard-mfe/project.json`**

Same shape, key `dashboard`:
```json
    "deploy-mfe": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "{workspaceRoot}",
        "parallel": false,
        "commands": [
          "pnpm nx run dashboard-mfe:build",
          "bash infrastructure/scripts/deploy-mfe.sh {args.prefix} dashboard"
        ]
      }
    },
```

- [ ] **Step 5: Edit `apps/onboarding-mfe/project.json`**

Same shape, key `onboarding`:
```json
    "deploy-mfe": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "{workspaceRoot}",
        "parallel": false,
        "commands": [
          "pnpm nx run onboarding-mfe:build",
          "bash infrastructure/scripts/deploy-mfe.sh {args.prefix} onboarding"
        ]
      }
    },
```

- [ ] **Step 6: Verify all 5 targets are wired correctly**

Run:
```bash
for k in investor advisory ledger dashboard onboarding; do
  echo "=== ${k}-mfe:deploy-mfe ==="
  pnpm nx show project ${k}-mfe --json | jq '.targets["deploy-mfe"]' | head -15
done
```

Expected: each prints a target object with `executor: nx:run-commands`, `options.commands` containing the build + deploy-mfe.sh invocation, and the correct `<key>` for each.

- [ ] **Step 7: Smoke-test one target with `--dry-run`**

Run:
```bash
pnpm nx run investor-mfe:deploy-mfe --prefix=dev --dry-run 2>&1 | tail -15
```

Hmm — `nx:run-commands` doesn't pass arbitrary args through to the chained commands. The `{args.prefix}` interpolation happens correctly, but `--dry-run` won't make it through. To smoke-test, do it manually:

```bash
pnpm nx run investor-mfe:build
bash infrastructure/scripts/deploy-mfe.sh dev investor --dry-run 2>&1 | tail -8
```

Expected: dry-run output for the investor MFE bucket.

- [ ] **Step 8: Commit**

```bash
git add apps/investor-mfe/project.json apps/advisory-mfe/project.json apps/ledger-mfe/project.json apps/dashboard-mfe/project.json apps/onboarding-mfe/project.json
git commit -m "$(cat <<'EOF'
feat(d): add deploy-mfe Nx target to each MFE app

Each MFE gains a deploy-mfe target that chains <mfe>:build →
infrastructure/scripts/deploy-mfe.sh <prefix> <key>. Mirrors the
investor-web:deploy-shell pattern (B4). Per charter §5 row 9b each BFF
owns its MFE's S3 bucket; this is the producer side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `infrastructure/scripts/deploy-mfes.sh` (parallel orchestration)

**Files:**
- Create: `infrastructure/scripts/deploy-mfes.sh`

**Why:** `deploy.sh` Phase 4b needs to deploy all 5 MFEs in parallel. Wrapping that in a script keeps `deploy.sh` itself uncluttered and matches existing patterns (`deploy-shell.sh` is the analog for the shell).

- [ ] **Step 1: Create the script**

Create `infrastructure/scripts/deploy-mfes.sh`:

```bash
#!/usr/bin/env bash
#
# deploy-mfes.sh — Run pnpm nx run <mfe>:deploy-mfe for every entry in
# MFE_CATALOG, in parallel. Fails fast if any one upload fails.
#
# Region scoping is per-iteration via env to avoid leaking
# CDK_DEFAULT_REGION across subprocesses.
#
# Usage:
#   deploy-mfes.sh <prefix> [region]

set -euo pipefail

PREFIX=${1:?Usage: deploy-mfes.sh <prefix> [region]}
REGION_ARG="${2:-}"
REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: MFE batch deploy failed. Prefix: $PREFIX, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CATALOG_SCRIPT="$REPO_ROOT/tools/scripts/list-mfe-catalog.mjs"

CATALOG_JSON=$(node "$CATALOG_SCRIPT")

PIDS=""
KEYS=""
while IFS= read -r entry; do
  KEY=$(echo "$entry" | jq -r '.key')
  echo "  Starting MFE deploy: $KEY"
  ( CDK_DEFAULT_REGION="$REGION" pnpm nx run "${KEY}-mfe:deploy-mfe" --prefix="$PREFIX" ) &
  PIDS="$PIDS $!"
  KEYS="$KEYS $KEY"
done < <(echo "$CATALOG_JSON" | jq -c '.[]')

FAIL=0
for PID in $PIDS; do
  wait "$PID" || FAIL=1
done

if [ "$FAIL" -ne 0 ]; then
  echo "ERROR: One or more MFE deploys failed (keys:$KEYS)." >&2
  exit 1
fi

echo "All MFEs deployed (keys:$KEYS)."
```

Make it executable:
```bash
chmod +x infrastructure/scripts/deploy-mfes.sh
```

- [ ] **Step 2: Run shellcheck**

```bash
shellcheck -x infrastructure/scripts/deploy-mfes.sh 2>&1 || true
```

Expected: clean (or shellcheck not installed).

- [ ] **Step 3: Smoke-test (real run; this actually deploys)**

WARNING: this is not a dry-run because the underlying `deploy-mfe` Nx target chain runs `<mfe>:build` (cached if you already built) then real `aws s3 sync`. Only run if you want all 5 MFEs uploaded to the dev account. To dry-run, skip this step and validate via the `deploy.sh` wiring in Task 7 instead.

Run (deliberate; Leapp must be active):
```bash
bash infrastructure/scripts/deploy-mfes.sh dev 2>&1 | tail -20
```

Expected: 5 parallel uploads, all green; final line `All MFEs deployed (keys: investor advisory ledger dashboard onboarding).`

If you don't want to deploy yet, skip and verify only via the script's structure (manual code review of the bash, confirming the `pnpm nx run ${KEY}-mfe:deploy-mfe` invocation matches the targets created in Task 4).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/scripts/deploy-mfes.sh
git commit -m "$(cat <<'EOF'
feat(d): add deploy-mfes.sh — parallel deploy of all 5 MFE bundles

Reads MFE_CATALOG via list-mfe-catalog.mjs and forks one
pnpm nx run <key>-mfe:deploy-mfe per entry. Region scoping is
per-iteration via subshell env to avoid CDK_DEFAULT_REGION leaking across
deploys. Fail-fast: if any one MFE upload fails, the whole batch is
flagged as failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Make `deploy-shell.sh` swap dev manifest for prod manifest

**Files:**
- Modify: `infrastructure/scripts/deploy-shell.sh`

**Why:** The shell's dist contains the dev `federation.manifest.json` (Angular CLI copies it from `apps/nestfolio-host/public/`). Before `aws s3 sync`, overwrite it with the production manifest emitted by `tools/scripts/build-prod-manifest.mjs`. Also extend the invalidation paths.

- [ ] **Step 1: Read the current `deploy-shell.sh`**

Run:
```bash
cat infrastructure/scripts/deploy-shell.sh
```

Note the existing structure: pre-flight checks, SSM resolution, then `aws s3 sync ... --delete` and `aws cloudfront create-invalidation --paths /index.html /assets/* /remoteEntry.json`.

- [ ] **Step 2: Insert the manifest-swap block**

Find this block (near the end of the script):

```bash
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
```

Replace it with:

```bash
echo "Shell deploy: prefix=$PREFIX region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

# Overwrite the dev federation.manifest.json (committed at
# apps/nestfolio-host/public/assets/federation.manifest.json with
# localhost dev URLs) with the production manifest pointing at
# /mfe/<key>/remoteEntry.json paths served by the unified CloudFront
# distribution. Single source of truth: MFE_CATALOG (read by
# build-prod-manifest.mjs via list-mfe-catalog.mjs).
PROD_MANIFEST="$DIST_DIR/assets/federation.manifest.json"
echo "  Manifest:      $PROD_MANIFEST"
node "$REPO_ROOT/tools/scripts/build-prod-manifest.mjs" --out "$PROD_MANIFEST"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /index.html /assets/* /remoteEntry.json"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"
```

(The invalidation paths are unchanged because `/assets/*` already covers the manifest at `/assets/federation.manifest.json`.)

- [ ] **Step 3: Run shellcheck**

```bash
bash infrastructure/scripts/test-deploy-shell-shellcheck.sh
```

Expected: clean.

- [ ] **Step 4: Smoke-test the manifest swap with `--dry-run`**

This requires the shell to be built first:

```bash
pnpm nx run nestfolio-host:build
bash infrastructure/scripts/deploy-shell.sh dev us-east-1 --dry-run 2>&1 | tail -15
```

Expected output: includes `build-prod-manifest: wrote 5 entries to .../dist/apps/nestfolio-host/browser/assets/federation.manifest.json`. After the dry-run, verify the actual manifest content was rewritten:

```bash
cat dist/apps/nestfolio-host/browser/assets/federation.manifest.json
```

Expected:
```json
{
  "investor-mfe": "/mfe/investor/remoteEntry.json",
  "advisory-mfe": "/mfe/advisory/remoteEntry.json",
  "ledger-mfe": "/mfe/ledger/remoteEntry.json",
  "dashboard-mfe": "/mfe/dashboard/remoteEntry.json",
  "onboarding-mfe": "/mfe/onboarding/remoteEntry.json"
}
```

The committed dev manifest at `apps/nestfolio-host/public/assets/federation.manifest.json` MUST remain unchanged (still localhost ports) — that file is what `nx serve` uses for local dev:

```bash
cat apps/nestfolio-host/public/assets/federation.manifest.json
```

Expected: still has `http://localhost:4201..4205` URLs (untouched by deploy-shell.sh).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/scripts/deploy-shell.sh
git commit -m "$(cat <<'EOF'
feat(d): deploy-shell.sh swaps dev federation manifest for prod manifest

Before aws s3 sync, run tools/scripts/build-prod-manifest.mjs to
overwrite dist/apps/nestfolio-host/browser/assets/federation.manifest.json
with a manifest pointing at /mfe/<key>/remoteEntry.json paths served by
the unified CloudFront distribution (charter §7 R6).

The committed apps/nestfolio-host/public/assets/federation.manifest.json
keeps its localhost dev URLs — used by nx serve for local development —
and is never edited by this script.

Existing /assets/* invalidation already covers the rewritten manifest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire MFE deploys into `infrastructure/scripts/deploy.sh` Phase 4

**Files:**
- Modify: `infrastructure/scripts/deploy.sh`

**Why:** `deploy.sh` currently has Phase 4a (investor-web cold-start re-deploy with `mfeBehaviors=true`) and Phase 4b (shell upload via `nx run investor-web:deploy-shell`). Need to insert MFE bundle uploads BETWEEN them — so the shell, when it serves the prod manifest, references already-populated MFE buckets. Renumber the existing Phase 4b → Phase 4c.

- [ ] **Step 1: Read the current Phase 4 block**

Run:
```bash
grep -n -E "Phase 4[abcd]" infrastructure/scripts/deploy.sh
sed -n '290,350p' infrastructure/scripts/deploy.sh
```

Expected: shows Phase 4a (investor-web cold-start re-deploy) starting around line 297, Phase 4b (shell upload) starting around line 311, and Phase 4 (hub re-deploy) starting around line 334.

- [ ] **Step 2: Insert new "Phase 4b" (MFE uploads) between Phase 4a and the existing shell-upload block**

Find this block:

```bash
  # Phase 4b: Upload shell bundle to investor-web's S3 bucket. Runs after
  # investor-web is in its final state (Phase 2 steady-state OR Phase 4a
  # cold-start re-deploy). Reads bucket name + distribution ID from SSM
  # (web/shellBucketName, web/distributionId).
  if is_service_included "investor-web"; then
    echo ""
    echo "Phase 4b (shell upload):"
```

Insert BEFORE that block:

```bash
  # Phase 4b: Upload all 5 MFE bundles to their per-BFF S3 buckets, in
  # parallel. Each MFE was built by its own deploy-mfe Nx target chain.
  # Runs AFTER Phase 4a (so per-BFF MFE bucket names are in SSM) and
  # BEFORE Phase 4c (so the shell, when it serves the prod federation
  # manifest, references already-populated buckets).
  #
  # Filter: deploy-mfes.sh always runs all 5; the --services filter can
  # only opt the whole batch in or out, since "investor-mfe" is the
  # convention for the *app*, not the bff service. If the user passed
  # --services without any *-mfe app, skip the batch.
  RUN_MFES="false"
  for k in investor advisory ledger dashboard onboarding; do
    if is_service_included "${k}-mfe"; then
      RUN_MFES="true"
      break
    fi
  done
  # If --services was NOT passed at all, also run the batch by default
  # (matches the pre-existing convention for investor-web's deploy-shell
  # which runs unless --services excludes investor-web).
  if [ "$SERVICES_FLAG_PROVIDED" = "false" ]; then RUN_MFES="true"; fi
  if [ "$RUN_MFES" = "true" ]; then
    echo ""
    echo "Phase 4b (MFE bundle uploads):"
    if [ "$DRY_RUN" = "true" ]; then
      echo "  [DRY RUN] Would run: bash infrastructure/scripts/deploy-mfes.sh $PREFIX${TARGET_REGION:+ $TARGET_REGION}"
    else
      bash infrastructure/scripts/deploy-mfes.sh "$PREFIX" "${TARGET_REGION:-}" || {
        echo "ERROR: One or more MFE uploads failed. Tier: $TIER, Prefix: $PREFIX." >&2
        exit 1
      }
    fi
  fi

```

(Note: leave a blank line at the end so the next "Phase 4b (shell upload):" block is visually separated.)

- [ ] **Step 3: Renumber the existing "Phase 4b (shell upload)" to "Phase 4c (shell upload)"**

Find this block (was Phase 4b, becomes Phase 4c):

```bash
  # Phase 4b: Upload shell bundle to investor-web's S3 bucket. Runs after
  # investor-web is in its final state (Phase 2 steady-state OR Phase 4a
  # cold-start re-deploy). Reads bucket name + distribution ID from SSM
  # (web/shellBucketName, web/distributionId).
  if is_service_included "investor-web"; then
    echo ""
    echo "Phase 4b (shell upload):"
```

Replace with:

```bash
  # Phase 4c: Upload shell bundle to investor-web's S3 bucket. Runs after
  # investor-web is in its final state (Phase 2 steady-state OR Phase 4a
  # cold-start re-deploy) AND after Phase 4b (MFE buckets populated, so
  # the shell's rewritten federation manifest references live origins).
  # Reads bucket name + distribution ID from SSM (web/shellBucketName,
  # web/distributionId). The deploy-shell Nx target also rewrites the
  # dev federation.manifest.json into a prod manifest in dist before
  # the s3 sync.
  if is_service_included "investor-web"; then
    echo ""
    echo "Phase 4c (shell upload):"
```

- [ ] **Step 4: Run shellcheck on `deploy.sh`**

```bash
shellcheck -x infrastructure/scripts/deploy.sh 2>&1 | head -20 || true
```

Expected: clean (or pre-existing warnings unrelated to your edit). Any new warning introduced by your edit must be fixed.

- [ ] **Step 5: Smoke-test with `--dry-run`**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web --dry-run 2>&1 | grep -E "Phase 4" | head -10
```

Expected output includes (in this order):
```
Phase 4a (investor-web re-deploy — cold-start MFE wiring):    [conditional]
Phase 4b (MFE bundle uploads):                                 [conditional]
Phase 4c (shell upload):
Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist.
```

(Phase 4a may not appear if `MFE_BOOTSTRAP_NEEDED` is false. Phase 4b appears because `--services=investor-web` includes no `*-mfe`, so `RUN_MFES` is false UNLESS `SERVICES_FLAG_PROVIDED=false`. Verify this: when you pass `--services=investor-web` only, Phase 4b should be SKIPPED — that's correct, the user is targeting only the shell-side. When you pass no `--services` flag, Phase 4b should run.)

Run a second variant to confirm the "no flag" case:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --dry-run 2>&1 | grep -E "Phase 4" | head -10
```

Expected output includes a `Phase 4b (MFE bundle uploads):` line (with `[DRY RUN]`).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/scripts/deploy.sh
git commit -m "$(cat <<'EOF'
feat(d): wire MFE bundle uploads as deploy.sh Phase 4b (renumber shell to 4c)

Phase 4b — new — runs deploy-mfes.sh (parallel deploy-mfe across all 5
MFE_CATALOG entries) AFTER 4a (so per-BFF MFE bucket names are in SSM)
and BEFORE 4c (so the shell, when it serves the prod federation
manifest, references already-populated buckets).

Phase 4c — renamed from 4b — shell upload (no logic change beyond name).

Service-filter handling: --services=*-mfe opts in; --services=investor-web
opts out; no --services at all opts in (matches deploy-shell convention).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Pre-deploy verification gates

**Files:** None (verification only).

- [ ] **Step 1: Full workspace build**

```bash
pnpm nx run-many -t build --projects=nestfolio-host,investor-mfe,advisory-mfe,ledger-mfe,dashboard-mfe,onboarding-mfe
```

Expected: 6/6 green. `assert-shell-html` passes for the shell.

- [ ] **Step 2: Affected test suite**

```bash
pnpm nx run-many -t test --projects=nestfolio-host,shell,frontend-deps,cdk-constructs,investor-web,ui
```

Expected: all green. The Task 1 frontend-deps change has no tests against `frontend-deps` (it's a CJS export-only lib); existing shell + nestfolio-host tests must still pass since they don't depend on `@primeuix/themes/aura` resolution.

- [ ] **Step 3: New unit test (build-prod-manifest)**

```bash
node --test tools/scripts/build-prod-manifest.test.mjs
```

Expected: 3/3 green.

- [ ] **Step 4: Charter-invariants gate**

```bash
pnpm nx run nestfolio-host:check-charter-invariants
```

Expected: `OK (0 hits)`.

- [ ] **Step 5: investor-web synth (verifies CSP + MFE behaviors propagation)**

```bash
rm -rf services/investor/investor-web/cdk.out
pnpm nx run investor-web:synth --prefix=test
grep -c "MfeBucketBehavior\|/mfe/" services/investor/investor-web/cdk.out/test-investor-web.template.json | head -1
```

Expected: green; the template references the per-MFE behaviors.

- [ ] **Step 6: shellcheck on all edited bash**

```bash
shellcheck -x infrastructure/scripts/deploy-mfe.sh infrastructure/scripts/deploy-mfes.sh infrastructure/scripts/deploy-shell.sh infrastructure/scripts/deploy.sh 2>&1 | head -20 || true
```

Expected: clean (or pre-existing warnings only — none introduced by this branch).

- [ ] **Step 7: Branch git log review**

```bash
git log --oneline main..HEAD
```

Expected: 7 commits in this order (newest at top):
```
<hash7> feat(d): wire MFE bundle uploads as deploy.sh Phase 4b (renumber shell to 4c)
<hash6> feat(d): deploy-shell.sh swaps dev federation manifest for prod manifest
<hash5> feat(d): add deploy-mfes.sh — parallel deploy of all 5 MFE bundles
<hash4> feat(d): add deploy-mfe Nx target to each MFE app
<hash3> feat(d): add deploy-mfe.sh — upload one MFE bundle to its BFF bucket
<hash2> feat(d): add build-prod-manifest.mjs to emit production federation.manifest.json
<hash1> fix(frontend-deps): explicit @primeuix/themes/aura entry for federation importmap
```

If any commit is missing or out of order, stop and reconcile.

---

## Task 9: Deploy to `dev` and run `cf-smoke` to confirm graduation

**Files:** None (deploy + smoke only).

- [ ] **Step 1: Confirm Leapp session is active**

```bash
aws sts get-caller-identity --query 'Arn' --output text
```

Expected: `arn:aws:sts::771924376645:assumed-role/AdminRole/...`. If not, start a Leapp session before continuing.

- [ ] **Step 2: Full deploy (no `--services` filter so Phase 4b runs for all 5 MFEs + Phase 4c for shell)**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev 2>&1 | tail -30
```

Expected output ends with:
```
...
Phase 4b (MFE bundle uploads):
  Starting MFE deploy: investor
  Starting MFE deploy: advisory
  Starting MFE deploy: ledger
  Starting MFE deploy: dashboard
  Starting MFE deploy: onboarding
  ... (parallel uploads + invalidations)
All MFEs deployed (keys: investor advisory ledger dashboard onboarding).

Phase 4c (shell upload):
  ... (build-prod-manifest writes 5 entries; aws s3 sync; invalidation)
Shell deployed.

Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist.

Deployment complete. Tier: sandbox, Prefix: dev
```

- [ ] **Step 3: Run cf-smoke**

```bash
pnpm cf-smoke --prefix=dev
```

Expected:
```
cf-smoke: prefix=dev cfUrl=https://d3i9cio23diphs.cloudfront.net
cf-smoke: routes=/investor,/advisory,/ledger,/dashboard,/onboarding

Per-route results:
  [PASS] /investor   status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /advisory   status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /ledger     status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /dashboard  status=200  rendered=true  consoleErrors=0  requestFailures=0
  [PASS] /onboarding status=200  rendered=true  consoleErrors=0  requestFailures=0

cf-smoke: PASS (5/5 routes)
```

Save the full output for the PR description.

If cf-smoke FAILs:
- `Failed to fetch ...localhost:42xx...` → manifest swap didn't work. Verify dist contents post-deploy: `aws s3 cp s3://dev-investor-web-assetsbucket5cb76180-szlooqlmryzh/assets/federation.manifest.json -`. Should show prod paths, not localhost. If localhost still: check Task 6's manifest-swap insertion order.
- `Unable to resolve specifier '@primeuix/themes/aura'` → Task 1's explicit entry didn't propagate. `git grep '@primeuix/themes/aura' libs/frontend-deps/index.js` must find the entry. Re-run `pnpm nx run-many -t build --projects=tag:type=mfe,nestfolio-host` then re-deploy.
- `404 on /mfe/<key>/remoteEntry.json` → MFE bucket(s) empty. Run `aws s3 ls s3://771924376645-dev-nestfolio-mfe-investor/` — must show `remoteEntry.json` and chunks. If empty: Phase 4b didn't actually run; check `--services` filter logic in Task 7.
- New error class → cf-smoke is doing its job. Iterate (this is the iterate-on-smoke loop the Phase C spec described as "by design").

`git bisect run` is mechanical: each of the 7 commits isolates one regression vector.

- [ ] **Step 4: If smoke FAIL, iterate; if smoke PASS, proceed to Task 10**

If smoke FAIL: diagnose per the per-route breakdown; create a fix-up commit on the same branch; re-deploy; re-smoke. Do NOT amend earlier commits — the bisect trail must remain intact.

If smoke PASS: continue.

---

## Task 10: Update memory + open the PR

**Files** (memory; not under git):
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md`
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_shell_render_broken.md`
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`

- [ ] **Step 1: Update memory — graduation flipped from PARTIAL to FULL**

In `project_mfe_charter_migration.md`, find the section starting `**Charter graduation status: PARTIAL** — pillars are correct as code; deploy wiring incomplete.` and rewrite it to:

```markdown
**Charter graduation status: GRADUATED 2026-04-27.** All 5 pillars hold on `main`. Plan D (`docs/superpowers/plans/2026-04-27-mfe-deploy-wiring-and-federation-resolution.md`) shipped 7 commits on branch `feat/d-mfe-deploy-wiring`:

1. `fix(frontend-deps): explicit @primeuix/themes/aura entry` — adds the missing importmap entry that `includeSecondaries: true` does not generate for glob `"./*"` exports.
2. `feat(d): build-prod-manifest.mjs` — emits prod federation manifest from MFE_CATALOG (3 node:test cases).
3. `feat(d): deploy-mfe.sh` — uploads one MFE bundle to its BFF bucket; invalidates `/mfe/<key>/*`.
4. `feat(d): deploy-mfe Nx target` on each of the 5 MFE apps.
5. `feat(d): deploy-mfes.sh` — parallel orchestration over MFE_CATALOG.
6. `feat(d): deploy-shell.sh swaps dev manifest for prod manifest` — overwrites `dist/.../assets/federation.manifest.json` before `aws s3 sync`.
7. `feat(d): wire MFE uploads as deploy.sh Phase 4b` — renumbers shell-upload to 4c.

Verification: `pnpm cf-smoke --prefix=dev` PASSES 5/5 routes. The original 6 cf-smoke-surfaced bugs are all addressed:
- Phase C iter-1: blob: + Angular onload handler hash + 'unsafe-hashes' (commit `f66d0ba9`).
- Phase C iter-2: es-module-shims feature-detect hash + frame-ancestors meta-tag strip (commit `52636638`).
- Plan D: federation.manifest.json prod rewrite + per-BFF MFE bucket population + @primeuix/themes/aura explicit importmap entry.
```

- [ ] **Step 2: Update `project_shell_render_broken.md` — flip status to fully resolved**

Find the section starting `**Status: CSP layer RESOLVED 2026-04-26; federation deploy/resolution layer DEFERRED.**` and rewrite the "Deferred" subsection plus the final status line:

```markdown
**Resolved by Plan D (federation deploy/resolution layer):**
- Deployed `federation.manifest.json` previously contained `http://localhost:4201..4205` URLs — Plan D's `deploy-shell.sh` now overwrites the dist manifest with `tools/scripts/build-prod-manifest.mjs` output (relative `/mfe/<key>/remoteEntry.json` paths) before the `aws s3 sync`. The committed `apps/nestfolio-host/public/assets/federation.manifest.json` keeps its localhost ports for `nx serve`.
- Per-BFF MFE buckets were dormant — Plan D added `deploy-mfe.sh` + per-MFE `deploy-mfe` Nx targets + `deploy-mfes.sh` orchestration + `deploy.sh` Phase 4b, populating all 5 buckets in parallel before the shell uploads.
- `@primeuix/themes/aura` resolution failed because Native Federation's `includeSecondaries: true` does not enumerate glob `"./*"` exports — Plan D added an explicit `'@primeuix/themes/aura': singletonOpts` entry to `libs/frontend-deps/index.js`.

**Status: FULLY RESOLVED 2026-04-27.** `pnpm cf-smoke --prefix=dev` is green; all 5 MFE routes render on the deployed CloudFront distribution. This memory is preserved for historical context (the layered debugging trail across Phase B, Phase C, and Plan D is non-trivial).
```

- [ ] **Step 3: Update `MEMORY.md` index entries**

Find the line starting `- [MFE charter migration]` and replace with:
```markdown
- [MFE charter migration](./project_mfe_charter_migration.md) — GRADUATED 2026-04-27: all 5 pillars hold on main; Phase A + B + C + Plan D all shipped; cf-smoke passes 5/5 routes.
```

Find the line starting `- [Shell render broken]` and replace with:
```markdown
- [Shell render broken](./project_shell_render_broken.md) — FULLY RESOLVED 2026-04-27: 6 layered bugs (CSP + federation + manifest) addressed across Phase C iter-1/2 + Plan D.
```

(Memory updates are not under git; no commit needed.)

- [ ] **Step 4: Push the branch (user-handled if no GitHub creds in agent session)**

```bash
git push -u origin feat/d-mfe-deploy-wiring
```

If credentials are unavailable in the current shell, the operator runs this manually.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "Plan D: MFE deploy wiring + @primeuix/themes/aura federation resolution" --body "$(cat <<'EOF'
## Summary
Closes the two pre-existing bugs surfaced by Phase C's `cf-smoke` probe so charter graduation can be claimed.

- **Bug 1 (federation manifest)**: deployed `federation.manifest.json` had `http://localhost:4201..4205` URLs because no deploy step rewrote it. Per-BFF MFE buckets were empty. Fix: `tools/scripts/build-prod-manifest.mjs` emits prod manifest from `MFE_CATALOG`; `deploy-shell.sh` swaps in the prod manifest before `s3 sync`; new `deploy-mfe.sh` + per-MFE Nx target + `deploy-mfes.sh` populates buckets in parallel; `deploy.sh` Phase 4b runs MFE uploads before the shell-upload phase (renumbered 4c).
- **Bug 2 (`@primeuix/themes/aura`)**: Native Federation `includeSecondaries: true` does not enumerate glob `"./*"` exports. Fix: explicit `'@primeuix/themes/aura': singletonOpts` entry in `libs/frontend-deps/index.js`.

Plan: `docs/superpowers/plans/2026-04-27-mfe-deploy-wiring-and-federation-resolution.md`

## Test plan
- [x] `pnpm nx run-many -t build` green for shell + 5 MFEs (assert-shell-html OK each).
- [x] `pnpm nx run-many -t test` green for nestfolio-host, shell, frontend-deps, cdk-constructs, investor-web, ui.
- [x] `node --test tools/scripts/build-prod-manifest.test.mjs` 3/3 green.
- [x] `pnpm nx run nestfolio-host:check-charter-invariants` OK (0 hits).
- [x] `shellcheck` clean for the 4 edited bash scripts.
- [x] `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev` green; deploys all 5 MFEs in Phase 4b + shell with rewritten manifest in Phase 4c.
- [x] `pnpm cf-smoke --prefix=dev` PASSES 5/5 routes (output below).

```
<paste cf-smoke output here>
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

`gh pr create` returns the PR URL on success — share it with the operator.

---

## Self-review notes

- **Bug coverage:** Bug 1 → Tasks 2 (manifest emitter) + 3 (per-MFE upload) + 4 (Nx targets) + 5 (parallel orchestration) + 6 (deploy-shell swap) + 7 (deploy.sh wiring). Bug 2 → Task 1 (frontend-deps explicit entry).
- **Placeholder scan:** all code blocks complete; no TBD/TODO/"similar to"; the manifest-emitter script and test, deploy-mfe.sh, deploy-mfes.sh, and the deploy.sh insertion are verbatim. The PR body has one runtime placeholder (`<paste cf-smoke output here>`) — that's intentional for human runtime data.
- **Type/name consistency:** `<key>` (MFE_CATALOG.key) and `<key>-mfe` (project name) are used consistently. The `deploy-mfe.sh` script accepts `<key>` (lowercase, no `-mfe` suffix); the Nx target `<project>:deploy-mfe` uses the project name (`investor-mfe` etc.); the manifest emitter outputs `<key>-mfe` keys mapping to `/mfe/<key>/remoteEntry.json` paths. `deploy-mfes.sh` reads `MFE_CATALOG.key` and constructs `${KEY}-mfe:deploy-mfe` for the Nx invocation.
- **Bisect trail:** 7 sequential commits, no amends. Each task = 1 commit. If cf-smoke regresses post-merge, `git bisect` over commits 1–7 isolates the culprit.
- **Known soft spot:** Task 7's service-filter logic (`RUN_MFES`) is the most subtle bash. Manually re-read it after writing — the intent is "run the batch unless `--services` was passed without any `*-mfe` and without omitting it entirely." The dry-run smoke in Step 5 confirms both branches.
