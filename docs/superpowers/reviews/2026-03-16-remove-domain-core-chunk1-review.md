# Review: remove-domain-core plan -- Chunk 1 (Tasks 1-3)

**Reviewer:** Code Review Agent
**Date:** 2026-03-16
**Status:** APPROVED with minor suggestions

---

## Overall Assessment

Chunk 1 is well-structured and correct. The errors and schemas code in the plan matches the existing `domain-core` source verbatim (verified against `libs/domain-core/src/shared/errors.ts` and `libs/domain-core/src/shared/types.ts`). The test code for schemas is a faithful port of `libs/domain-core/test/shared/types.test.ts` with updated import paths. File paths are consistent, test commands match, and the barrel exports everything needed.

---

## Checklist Results

### 1. File paths -- correct and consistent

- **PASS.** All source paths (`libs/event-processor/src/domain/errors.ts`, `schemas.ts`, `index.ts`) and test paths (`libs/event-processor/test/domain/errors.test.ts`, `schemas.test.ts`) are consistent with the existing event-processor layout (`src/` for source, `test/` for tests).
- **PASS.** Import paths in tests (`../../src/domain/errors`, `../../src/domain/schemas`) correctly navigate from `test/domain/` to `src/domain/`.

### 2. Code completeness -- no placeholders

- **PASS.** The `errors.ts` code is byte-identical to `libs/domain-core/src/shared/errors.ts` (minus JSDoc comments -- see Suggestion S1 below).
- **PASS.** The `schemas.ts` code is identical to `libs/domain-core/src/shared/types.ts` (minus the inline comments).
- **PASS.** No TODOs, ellipses, or placeholder blocks.

### 3. Test commands match test file paths

- **PASS.** `npx nx test event-processor -- --testPathPattern=domain/errors` will match `test/domain/errors.test.ts`.
- **PASS.** `npx nx test event-processor -- --testPathPattern=domain/schemas` will match `test/domain/schemas.test.ts`.
- **PASS.** `npx nx test event-processor` (Task 3 Step 3) runs the full suite including the new files.

### 4. Missing steps or dependencies

- **PASS.** Task 1 (errors) and Task 2 (schemas) are independent -- no cross-dependency.
- **PASS.** Task 3 (barrel + index) depends on Tasks 1-2 outputs and is correctly sequenced after them.
- **PASS.** `zod` is available as a root workspace dependency -- no package.json changes needed.

### 5. Barrel exports completeness

- **PASS.** The domain barrel (`domain/index.ts`) re-exports all 5 error classes, all 4 schemas, and all 4 types from `schemas.ts`.
- **PASS.** The root barrel addition (`index.ts`) mirrors the domain barrel exactly.

---

## Issues

### Important (should fix)

**I1: JSDoc comments stripped from errors.ts**

The plan says "Copy verbatim" but the code block omits the 4 JSDoc comments present in the original `libs/domain-core/src/shared/errors.ts` (e.g., `/** Base class for all domain-specific errors. */`). Since the plan explicitly instructs "Copy verbatim," the executor may literally copy from the file (preserving comments) or from the code block (losing them). Recommend either:
- (a) Including the JSDoc in the code block, or
- (b) Changing the instruction to "Copy `libs/domain-core/src/shared/errors.ts` verbatim" without an inline code block, so the executor uses the file as source of truth.

The same applies to `schemas.ts` -- the original has inline comments (`// --- Base Bus Event Schema ---`, `// --- Edit Event (JSON Patch audit trail) ---`) that are absent from the plan's code block.

---

## Suggestions (nice to have)

**S1: Test count in Task 2 Step 4 says "11 tests" -- verify**

Counting the test cases in the schemas test: BusEventSchema has 7 `it()` blocks, TenantContextSchema has 2, EditEventSchema has 3. That totals **12 tests**, not 11. The expected count should be corrected to 12.

**S2: Consider `EditOperationSchema` in the barrel comment**

The domain barrel's schema re-export includes `EditOperationSchema`, which is correct. However the root barrel comment says "Domain (shared infrastructure types & errors)" -- the word "schemas" could be added for clarity: "Domain (shared infrastructure errors & schemas)."

---

## What Was Done Well

- The TDD approach (write failing tests first, then implement) is consistently applied in Tasks 1 and 2.
- The plan correctly identifies that Task 3 is a wiring-only task with no new tests needed -- the existing tests from Tasks 1-2 already validate the exports work.
- The commit messages are well-scoped and follow the `feat(event-processor):` convention.
- The `testPathPattern` flags are precise enough to run only the relevant test files without false matches.
