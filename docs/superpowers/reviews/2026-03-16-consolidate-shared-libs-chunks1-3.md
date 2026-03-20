# Plan Review: Consolidate Shared Libs -- Chunks 1-3 (Tasks 1-16)

**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-16
**Plan:** `docs/superpowers/plans/2026-03-16-consolidate-shared-libs.md`

---

## Chunk 1: Platform Modules (Tasks 1-9) -- PASS with issues

### Task 1 (core types) -- PASS
Verbatim copy of `platform-core/src/core.ts`. Self-contained, no issues.

**Note:** `internal/core.ts` already exports `getUUID` and `getTime` (identical implementations). After Task 9, both `platform/core.ts` and `internal/core.ts` will export these. The main barrel in Task 9 re-exports from `platform/` -- but `internal/` also re-exports them via the existing `event-processor/src/index.ts` line 2: `export { getUUID, getTime } from './core'` (which points to `internal/core`). This creates **duplicate export names** in the final barrel.

> **CRITICAL:** Task 9 appends platform exports to `index.ts` but does NOT remove the existing `export { getUUID, getTime }` from internal. TypeScript will error: `Module has already exported a member named 'getUUID'`. The plan must include removing overlapping exports from the existing barrel.

### Task 2 (errors) -- PASS with note
Correctly adds only `handleClientError` + `ErrorEvent` and re-exports `NotRetryableError`/`isRetryable` from internal. Good separation.

### Task 3 (bus) -- PASS
Drops `@log()` decorator -- documented and justified. Uses `logger` from internal (but only has `console.error` in the code, not `logger`). The `logger` import on line 229 is unused in the provided code snippet.

> **SUGGESTION:** Remove the unused `import { logger }` or add structured logging to replace the `console.error` call.

### Task 4 (log decorator + validation) -- PASS
Correctly wires to internal logger singleton.

### Task 5 (FP) -- PASS
Verbatim copy, self-contained.

### Task 6 (branded types) -- PASS
Verbatim copy, self-contained.

### Task 7 (repositories) -- PASS with note
The plan says "change the `log` import" but shows identical before/after paths (`import { log } from '../logger'`). This is correct since the relative path from `platform/repositories/` to `platform/logger.ts` mirrors the original structure. The confusing diff is harmless but could mislead an implementer.

### Task 8 (market-data) -- PASS
Verbatim copy, self-contained. Correct that these have no platform-core imports.

### Task 9 (platform barrel) -- FAIL

> **CRITICAL -- Duplicate exports in main barrel.** The existing `event-processor/src/index.ts` already exports these symbols from `internal/`:
> - `NotRetryableError`, `isRetryable` (line 1)
> - `getUUID`, `getTime` (line 2)
> - `logger` (line 3)
> - `tracer` (line 4)
> - `parseRecord` (line 5)
> - `traceEvent` (line 6)
> - `extractTenantId` (line 7)
> - `guardedWrite` (line 8)
> - `applyMiddleware`, `withLambdaContext`, `withTiming` (line 9)
> - `Middleware` type (line 10)
>
> The platform barrel re-exports: `NotRetryableError`, `isRetryable`, `getUUID`, `getTime`, `logger`, `tracer`.
> Task 13's lambda barrel re-exports: `applyMiddleware`, `withLambdaContext`, `withTiming`, `Middleware`.
>
> **All 12 of these will collide** with the existing barrel exports. The plan must add a step to replace the existing 10 lines of `index.ts` with the new platform + lambda re-exports. Without this, TypeScript compilation will fail.

---

## Chunk 2: Lambda Modules (Tasks 10-13) -- PASS with issues

### Task 10 (lambda utilities) -- PASS with note
Step 6 (`publish-error-event.ts`) has a self-correction in the plan showing wrong import then fixing it. The final version is correct: `ErrorEvent` from `../platform/errors`, `Bus` from `../platform/bus`, `getUUID`/`getTime` from `../platform/core`.

### Task 11 (middleware) -- PASS
Correct cross-references to `../../platform/bus` and `../../internal`.

### Task 12 (event-publisher + test-utils) -- PASS

### Task 13 (lambda barrel) -- FAIL (same root cause as Task 9)

> **CRITICAL -- Same duplicate export issue.** The lambda barrel re-exports `applyMiddleware`, `withLambdaContext`, `withTiming`, `Middleware` from `../internal`. These are already exported by the existing `event-processor/src/index.ts`. See Task 9 analysis.

**Additional concern:** `EVENT_PUBLISHER_ENTRY` uses `join(__dirname, 'event-publisher.ts')`. This path resolves at runtime to the compiled JS output directory, not the source `.ts` file. This matches the existing lambda-utils pattern, so it should work -- but only if the CDK bundler (esbuild) resolves `.ts` entry points. Confirm this matches the existing behavior in `lambda-utils/src/index.ts` (it does -- identical pattern).

**Missing from lambda barrel:** `parseRecord`, `guardedWrite`, `extractTenantId`, `traceEvent` are currently exported from `event-processor/src/index.ts` via `internal/`. The lambda barrel does NOT re-export these. This is intentional (they stay as internal re-exports in the main barrel), but the plan does not clarify how these survive after the main barrel is rewritten. They need to remain.

---

## Chunk 3: Domain Infrastructure (Tasks 14-16) -- PASS with issues

### Task 14 (domain errors) -- PASS
Verbatim copy. Tests are well-structured and cover all 5 error classes.

### Task 15 (domain schemas) -- PASS
Verbatim copy from `domain-core/src/shared/types.ts`. Note: the test file reference says "Copy `libs/domain-core/test/shared/types.test.ts`" -- verify this test file exists.

### Task 16 (domain barrel) -- PASS with note

> **IMPORTANT:** The `BusEvent` type alias to `BusEventType` is correctly identified as needed to avoid collision with the generic `BusEvent<T,S>` from `platform/bus.ts`. However, downstream consumers currently import `BusEvent` from `@nestfolio/domain-core` as a Zod-inferred type. The migration chunks (4+) must update ALL consumer imports from `BusEvent` to `BusEventType`. The plan acknowledges this but the rename will be a breaking change that needs careful grep-and-replace across consumers.

---

## Summary

| Chunk | Verdict | Issues |
|-------|---------|--------|
| Chunk 1 (Tasks 1-9) | FAIL | 1 Critical (duplicate barrel exports) |
| Chunk 2 (Tasks 10-13) | FAIL | 1 Critical (same duplicate exports), 1 Important (orphaned internal re-exports) |
| Chunk 3 (Tasks 14-16) | PASS | 1 Suggestion (BusEventType rename tracking) |

### Critical Fix Required

**Before Task 9 Step 2**, add a step: "Replace the existing 10 export lines in `libs/event-processor/src/index.ts` (lines 1-10, the internal re-exports) with the new platform + lambda re-exports." The final `index.ts` should have:

1. Existing pipeline/engine/intent/testing/util exports (lines 1-61 of current file)
2. **No direct internal/ re-exports** (remove lines currently re-exporting from `./internal` and `./core` etc.)
3. New `platform/` re-exports (Task 9)
4. New `lambda/` re-exports (Task 13) -- which themselves re-export the overlapping internal symbols
5. New `domain/` re-exports (Task 16)

The `parseRecord`, `guardedWrite`, `extractTenantId`, `traceEvent` symbols currently re-exported from internal must either:
- (a) Be added to the `lambda/` barrel (they are Lambda-runtime utilities), or
- (b) Remain as direct internal re-exports in the main barrel (but then the plan must explicitly keep those 4 lines).

Recommendation: option (a) -- move them into the lambda barrel alongside the other Lambda utilities.
