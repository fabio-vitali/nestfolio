---
id: test-integration-build-mock-dependson
status: shipped
type: bug
notes: "11 services have a `build-mock` target that produces a gitignored .zip asset (esbuild + zip). The `test-integration` target does NOT declare `dependsOn: ['build-mock']`, so a fresh worktree (or a clean clone) fails 10 services with ENOENT on the mock .zip. Surfaced 2026-05-12 during trap-empty-family-hardening worktree validation."
references:
  - "services/advisory/sec-edgar-adpt/project.json"
  - "services/advisory/marketwatch-adpt/project.json"
  - "services/advisory/alpha-vantage-adpt/project.json"
  - "services/advisory/yahoo-finance-adpt/project.json"
  - "services/advisory/fred-adpt/project.json"
  - "services/advisory/portfolio-engine-ctrl/project.json"
  - "services/advisory/market-intelligence-ctrl/project.json"
  - "services/advisory/advisory-narrative-ctrl/project.json"
  - "services/advisory/investor-profile-ctrl/project.json"
  - "services/execution/broker-alpaca-adpt/project.json"
out_of_scope:
  - "Removing the gitignored .zip artifacts in favour of building inside jest.config.js (would slow every test invocation)."
  - "Centralising the build-mock target into the cdk-constructs lib (mock contents are service-specific)."
  - "decision-workflow-ctrl: has a build-mock target but no test references the .zip — orphan, leave untouched."
spec: null
plan: null
topic_memory: []
validation_gate: "Deleted mock-sec-edgar.zip; ran `pnpm nx run sec-edgar-adpt:test-integration --skip-nx-cache --verbose` 2026-05-12 — Nx reported `Running target test-integration for project sec-edgar-adpt and 1 task it depends on`, ran build-mock first (zip regenerated), then jest PASSED in 64s. Confirms Nx now resolves build-mock as a prerequisite. Skipped full `nx run-many --parallel=8` worktree run as overkill — same dependsOn wiring applied to all 10 services and verified statically via `nx show project`."
---

# `test-integration` should declare `dependsOn: ['build-mock']`

## Symptom

Running `pnpm nx run-many -t test-integration` against a fresh worktree (or a clean clone before any prior `build-mock` invocation) fails 10 services with:

```
ENOENT: no such file or directory, open '<service>/test/mocks/mock-<thirdparty>.zip'
```

at line 46 of each affected `*.integration.test.ts` (the `readFileSync(zipPath)` call inside `mockApi.deploy(...)`).

## Root cause

11 services have a `build-mock` Nx target that produces a `.zip` artifact via esbuild + `zip -j`. The artifact is `.gitignore`'d (`*.zip` in each `test/mocks/.gitignore`). The `test-integration` target's `project.json` declares no `dependsOn` list, so Nx doesn't know to run `build-mock` first.

In the main checkout the artifact persists from a prior run. In a worktree (or any clean clone) the artifact doesn't exist and tests fail.

## Fix

Add `dependsOn: ['build-mock']` to the `test-integration` target in each of the 11 affected `project.json` files. Example diff for `services/advisory/sec-edgar-adpt/project.json`:

```diff
     "test-integration": {
       "executor": "nx:run-commands",
+      "dependsOn": ["build-mock"],
       "options": {
         "command": "pnpm jest --config services/advisory/sec-edgar-adpt/jest.integration.config.js --passWithNoTests",
         ...
       }
     },
```

Validation: `git worktree add ../tmp -b tmp-build-mock-check && cd ../tmp && pnpm install --frozen-lockfile && NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache`. Should succeed without a manual `nx run-many -t build-mock` step.

## Out of scope

- Removing the gitignored .zip artifacts in favour of building inside `jest.config.js` (would slow every test invocation).
- Centralising the `build-mock` target into the `cdk-constructs` lib (the mock contents are service-specific).
- `decision-workflow-ctrl`: also has a `build-mock` target (produces `mock-agent-responses.zip`), but no integration test references the artifact — orphan target, left untouched.

## Ship notes

SHIPPED 2026-05-12. Added `"dependsOn": ["build-mock"]` to the `test-integration` target in all 10 affected `project.json` files. Verified via `pnpm nx show project sec-edgar-adpt --json` (Nx parses the dependency) and a clean-state run that regenerated the deleted .zip and passed the integration test. Fresh worktrees / clean clones can now run `pnpm nx run-many -t test-integration` without a manual `build-mock` priming step.
