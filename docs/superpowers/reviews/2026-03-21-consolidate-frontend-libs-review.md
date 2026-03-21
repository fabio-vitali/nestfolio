# Review: Consolidate Frontend Libs Plan vs Spec

**Date:** 2026-03-21
**Reviewer:** Code Review Agent
**Verdict:** Good plan with several issues to fix before execution

---

## BLOCKERS (must fix before execution)

### B1: Duplicate `Locale` type will cause compilation error

The spec says `Locale` is defined in both `shared-state/models.ts` and `i18n/i18n.service.ts`. The plan's i18n subpath barrel (Task 2 Step 8) re-exports `Locale` from `./i18n.service` while the main barrel (Task 2 Step 6) exports `Locale` from `./models`. After consolidation, the i18n service file still defines its own `Locale` type (`export type Locale = 'en-GB' | 'it-IT'` at line 4 of `i18n.service.ts`). This is a duplicate definition. The spec calls for removing the duplicate from `i18n.service.ts` and having it import from `../models` instead, but the plan has no step for this fix.

**Fix:** Add a step in Task 2 (after Step 3, before Step 8) to edit `libs/shell/src/i18n/i18n.service.ts`: remove the local `Locale` type export and replace with `import { Locale } from '../models';`.

### B2: `@nestfolio/shared-state/testing` not in tsconfig.base.json `paths` (currently)

The actual `tsconfig.base.json` has `@nestfolio/shared-state/testing` but does NOT have a `@nestfolio/shared-state/*` wildcard. The spec's tsconfig removal list (Section 3) says to remove `@nestfolio/shared-state/*` which does not exist. The plan's Task 13 Step 1 must remove `@nestfolio/shared-state/testing` (the explicit path), not the wildcard.

**Fix:** Task 13 Step 1: add `@nestfolio/shared-state/testing` to the removal list (it's currently missing from the plan's list).

### B3: `@nestfolio/investor-events` moduleNameMapper in investor-mfe references nonexistent lib

The plan (Task 7 Step 2) preserves `@nestfolio/investor-events` in investor-mfe's jest config, but `libs/investor-events` does not exist and is not in `tsconfig.base.json`. This mapper will point to a nonexistent path. The executing agent needs guidance: either remove it or verify where investor-events actually lives.

**Fix:** Add a note in Task 7 that the `@nestfolio/investor-events` entry should be verified/removed if the lib does not exist.

### B4: appsync-client tests have `testEnvironment: 'node'` -- plan underestimates migration risk

The appsync-client `jest.config.js` uses `testEnvironment: 'node'` and has NO `setupFilesAfterEnv`, NO `transform`, and NO jest-preset-angular config. The 3 graphql test files were written for a pure Node environment. The plan's shell jest config uses `jest-preset-angular` with `setupZonelessTestEnv()` under jsdom. This is a significant environment change, not just a jsdom-vs-node switch. The plan's Task 4 Step 3 mentions this but treats it as a quick validation step.

**Fix:** Add explicit instructions in Task 3 Step 5 to check whether graphql test files import or mock `@angular/core` and whether they will survive `setupZonelessTestEnv()`. If they break, the fallback (`/** @jest-environment node */` docblock) is correct but the tests may also need a `jest-preset-angular` removal since the Node-env tests likely don't use Angular transforms.

### B5: ui-components test files use relative paths with `src/lib/` -- plan Step 8 is too vague

The actual ui-components test files use relative imports like `from '../../../src/lib/layout/bottom-nav.component'` and `from '../../../../src/lib/shared/empty-state/empty-state.component'`. After flattening to `libs/ui/`, the `lib/` segment must be removed from ALL relative imports. Task 5 Step 8 says "check each test file" but does not list the exact files or the exact sed patterns. There are 12+ test files, each with different relative path depths.

**Fix:** Task 5 Step 8 must enumerate the files and provide exact before/after import paths. The pattern is: `../../../src/lib/` becomes `../../../src/` (for `test/layout/` files) and `../../../../src/lib/` becomes `../../../../src/` (for `test/shared/*/` files).

---

## WARNINGS (should address)

### W1: nestfolio-host jest config has NO `@nestfolio/shared-state/testing` mapper

The plan (Task 6 Step 2) shows a clean 4-entry moduleNameMapper. However, nestfolio-host's current jest config also lacks `shared-state/testing`. This is correct, but the plan should note that nestfolio-host does NOT use `@nestfolio/shared-state/testing` in its tests (confirmed: no test files import it). No action needed, but worth noting for clarity.

### W2: App jest configs have `snapshotSerializers` -- plan doesn't mention preserving them

All 4 MFE app jest configs (dashboard, investor, advisory, ledger) include `snapshotSerializers` arrays. The plan's replacement moduleNameMapper blocks (Tasks 7-10) don't mention these. The executing agent must understand to only replace the `moduleNameMapper` block, not the entire config.

**Fix:** Add a note to Tasks 7-10: "Only replace the `moduleNameMapper` object. Preserve all other config properties (`transform`, `transformIgnorePatterns`, `snapshotSerializers`, etc.)."

### W3: advisory-mfe source test files using `@nestfolio/shared-state/testing`

The advisory-mfe jest config has the `shared-state/testing` mapper, but no source test files were found importing it (only the jest config line). The plan (Task 9 Step 2) doesn't list any test files using `@nestfolio/shared-state/testing`. Verify this is accurate -- if any advisory-mfe test files do import it, they need updating too.

### W4: `@nestfolio/shared-state` wildcard path (`@nestfolio/shared-state/*`) does NOT exist in tsconfig

The spec's "Remove" section lists `@nestfolio/shared-state/*` as a path to remove, but the actual `tsconfig.base.json` only has `@nestfolio/shared-state` and `@nestfolio/shared-state/testing` (no wildcard). The plan inherits this error. Won't break anything (removing a nonexistent key is harmless) but could confuse the agent.

### W5: Plan uses `setupZonelessTestEnv` but original libs use `setupZonelessTestEnv` too

Confirmed both shell and ui test-setup files in the plan use `setupZonelessTestEnv` which matches the existing libs. No issue, just noting consistency is correct.

### W6: Task 12 consumer list matches reality

The spec lists 7 services for agent-core consumers. Verified against codebase: advisory-ctrl, advisory-narrative-ctrl, decision-workflow-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, onboarding-agent-bff -- all confirmed (35 files total). The list is accurate.

### W7: Plan Task 14 Step 5 stale ref check should also scan `*.json` files

The grep patterns only check `*.ts` and `*.js`. Old references could persist in `tsconfig.*.json`, `project.json`, or `jest.config.*` files. Add `--include="*.json"` to the grep patterns.

---

## NOTES (nice to have)

### N1: `@nestfolio/shared-state/testing` barrel also exports `createMockGraphqlService`

The testing barrel exports `createMockGraphqlService` which is not listed in the spec's `@nestfolio/shell/testing` exports. The spec lists `setupComponentTest, createMockI18nService, createMockRouter, createMockGraphqlService` but the plan's barrel file is not shown. Ensure the testing barrel is copied verbatim (Task 3 Step 1 does copy it).

### N2: `cached-query.ts` in appsync-client may have internal imports

The plan doesn't check whether `cached-query.ts` or `appsync.config.ts` import from `@nestfolio/shared-state`. Only `graphql.service.ts` is checked (Task 2 Step 5). Verify the other 2 files have no cross-lib imports.

### N3: No `.eslintrc` or `nx.json` references to old lib names

Confirmed: no eslint config files reference the old lib names, and `nx.json` has zero matches. No cleanup needed there.

### N4: Plan correctly identifies the `jest.config.js` extension (not `.ts`) for lib configs

All existing lib jest configs use `.js` extension. The plan creates `libs/shell/jest.config.js` and `libs/ui/jest.config.js` -- matches the convention.

### N5: The `jest.config.ts` spec reference vs actual `.js` extension inconsistency

The spec says `jest.config.ts` in the file tree but the plan correctly uses `.js`. Minor spec-plan divergence, plan is correct.

---

## Completeness Summary

| Spec Requirement | Plan Coverage | Status |
|---|---|---|
| 5 frontend libs -> shell + ui | Tasks 1-5 | Covered |
| Subpath barrels (auth, i18n, graphql, testing) | Task 2 Steps 7-9, Task 3 Step 1 | Covered |
| graphql.service.ts internal import fix | Task 2 Step 5 | Covered |
| ui-components flatten src/lib/ | Task 5 Step 5 | Covered |
| federation.config.js updates (5 files) | Tasks 6-10 Step 1 | Covered |
| jest moduleNameMapper updates (5 apps) | Tasks 6-10 Step 2 | Covered |
| tsconfig.base.json path updates | Task 4 Step 1, Task 5 Step 9, Task 11 Step 4, Task 13 Step 1 | Covered |
| agent-core -> agent-orchestrator rename | Tasks 11-12 | Covered |
| agent-core scope:domain -> scope:platform | Task 11 Step 2 | Covered |
| Delete old lib directories | Task 13 Step 2 | Covered |
| Full workspace validation | Task 14 | Covered |
| Locale type deduplication | NOT COVERED | **BLOCKER B1** |
| ui-components test import path fixes | Partially covered (vague) | **BLOCKER B5** |
| graphql test environment migration | Partially covered | **BLOCKER B4** |

## Task Ordering Assessment

Task ordering is correct. Dependencies flow properly: scaffold (T1) -> move source (T2) -> move tests (T3) -> validate (T4) -> ui lib (T5) -> rewire apps one by one (T6-T10) -> rename agent-core (T11-T12) -> cleanup (T13) -> full validation (T14). Each chunk can be committed independently.

One minor ordering concern: Task 4 Step 1 adds shell paths to tsconfig.base.json, but the old paths are still present. This dual-mapping period is intentional and correct (allows incremental migration). The old paths are removed in Task 13.
