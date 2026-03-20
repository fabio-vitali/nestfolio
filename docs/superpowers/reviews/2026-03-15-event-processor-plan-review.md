# Plan Review: @nestfolio/event-processor

**Spec:** `docs/superpowers/specs/2026-03-15-event-processor-design.md`
**Plan:** `docs/superpowers/plans/2026-03-15-event-processor.md`
**Reviewer:** Code Review Agent
**Date:** 2026-03-15

---

## Overall Assessment

The plan is well-structured, follows TDD discipline consistently, and covers the core SQS processing framework thoroughly. The decision to defer DDB Stream pipelines (Chunk 5) to a follow-up plan is sound. However, there are several issues ranging from critical to minor that should be addressed before execution.

---

## Critical Issues (must fix)

### C1. IntentExecutor duplicates guardedWrite instead of reusing it

The plan's `IntentExecutor.executeAccumulate()` (Task 10, line ~1577) re-implements the entire `guardedWrite` transactional pattern inline with raw `TransactWriteCommand`. The existing `guardedWrite()` utility at `libs/lambda-utils/src/guarded-write.ts` already does exactly this. The spec explicitly says the framework depends on `@nestfolio/lambda-utils`, which exports `guardedWrite`.

**Recommendation:** Import and call `guardedWrite(docClient, tableName, guardKey, transactItems, ttlSeconds)` from `@nestfolio/lambda-utils` instead of duplicating the logic. This keeps the accumulate executor at ~10 lines and avoids divergent deduplication logic.

### C2. Missing `moduleNameMapper` for `@nestfolio/lambda-utils` in jest.config.js

The `command-core` jest.config.js maps `@nestfolio/platform-core` because Jest does not resolve tsconfig paths. The plan's jest.config.js (Task 1, Step 5) has no `moduleNameMapper` for `@nestfolio/lambda-utils`, which is imported by `batch-engine.ts`, `create-event-handler.ts`, and test mocks. Without this, tests that don't mock lambda-utils will fail to resolve the import.

While several tests use `jest.mock('@nestfolio/lambda-utils', ...)`, the `moduleNameMapper` is still needed as a fallback for any test file that imports without mocking.

**Recommendation:** Add to jest.config.js:
```js
moduleNameMapper: {
  '^@nestfolio/lambda-utils$': '<rootDir>/../lambda-utils/src/index.ts',
  '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../lambda-utils/src/$1',
},
```

### C3. project.json missing `passWithNoTests` — inconsistent with command-core

The plan's `project.json` (Task 1, Step 1) includes `"passWithNoTests": true`, but the reference `command-core/project.json` does NOT have this field. This is actually fine for scaffolding (Step 9 runs before tests exist), but it should be removed after Task 3 adds real tests to stay consistent with the workspace convention.

**Severity downgrade:** This is actually minor — leaving `passWithNoTests` won't cause failures, but it masks missing test files silently.

---

## Important Issues (should fix)

### I1. tsconfig.spec.json diverges from command-core pattern

The plan's `tsconfig.spec.json` (Task 1, Step 4) includes `"jest.config.js"` in the `include` array, but the reference `command-core/tsconfig.spec.json` includes `"jest.config.ts"`, `"test/**/*.test.ts"`, and `"test/**/*.spec.ts"`. The plan puts tests under `src/**/__tests__/` (not `test/`), so the `test/` globs are unnecessary, but the inconsistency with the rest of the workspace could confuse contributors.

**Recommendation:** Match the `command-core` pattern exactly (include both `jest.config.ts` and `jest.config.js`, include `test/**` globs even if unused).

### I2. Spec's `HandlerEntry` type allows `WriteIntent` in arrays, but plan's type is stricter

The spec (line 316) says: "the engine accepts both `HandlerFn` and `WriteIntent` elements" in arrays. The plan's `handler-config.ts` (Task 2, Step 2) correctly types this as `Array<HandlerFn | WriteIntent>`. However, the `normalizeHandler` tests (Task 8) only test the mixed case with `record` mapper + `accumulate` inline. Missing test: an array containing a raw `ProjectIntent` data object (not returned from a helper) to verify the `isWriteIntent` check works with arbitrary objects.

### I3. BatchEngine mock of parseRecord doesn't match actual return type

The batch-engine test (Task 11) mocks `parseRecord` to return `{ event: body.detail, payload: {}, record: sqsRecord }`. The actual `parseRecord` from `lambda-utils` returns a `UnitOfWork` which has `event` with `.type`, `.id`, `.subject`, `.context`, `.timestamp` fields. The mock accesses `uow.event.type`, `uow.event.id`, `uow.event.subject`, `uow.event.context`, `uow.event.timestamp` — but the mock returns `body.detail` directly as `event`.

The mock structure works IF the test's `makeSqsEvent` body.detail contains those exact fields. It does (`type`, `id`, `timestamp`, `subject`, `context`). So this is functionally correct but fragile — if `parseRecord`'s actual return shape changes, the mock won't catch it.

**Recommendation:** Add a comment in the mock noting it mirrors the UnitOfWork shape, or import the actual type for reference.

### I4. Spec's `BatchDuration` metric is missing from ErrorCollector

The spec lists `BatchDuration` (line 929) as a metric, but the `ErrorCollector` (Task 9) only tracks `BatchSize`, not `BatchDuration`. The batch engine should measure and record duration separately. This is not the ErrorCollector's job, but the plan doesn't show where `BatchDuration` gets published.

**Recommendation:** Add `BatchDuration` measurement to `BatchEngine.process()` (wrap the asyncPool call with timing, add to metrics before returning).

### I5. No S3 intent executor test — s3-put returns stub result

The `IntentExecutor` (Task 10) handles `s3-put` with a stub: `return { _tag: 's3-put', success: true }` and a comment "handled by S3 executor (separate)". But there is no S3 executor anywhere in the plan, and no test verifies this behavior. The `materializeToBucket` pipeline is deferred to Chunk 5, but if someone uses `s3Put()` with `createEventHandler` before Chunk 5 ships, it silently does nothing.

**Recommendation:** At minimum, throw `NotRetryableError('S3 intent executor not yet implemented')` instead of silently succeeding. Add a test for this.

### I6. `traceEvent` called with 2 args but lambda-utils signature may need 3

The batch engine calls `traceEvent(eventType, uow.event.id)` but the existing event listener pattern shows `traceEvent(eventType, uow.event.id)` too. However, after the Phase 5 Wave 3 changes, `traceEvent()` was updated to accept 3 args: `traceEvent(eventType, eventId, tenantId)`. The plan's batch-engine (Task 11) calls it with only 2 args at line ~1846 but also has `tenantId` available. This should use 3 args.

**Recommendation:** Change to `traceEvent(eventType, uow.event.id, tenantId)`.

---

## Suggestions (nice to have)

### S1. Missing coverage threshold in jest.config.js

The `command-core` jest.config.js sets `coverageThreshold` at 90% for all metrics. The plan's jest.config.js has no coverage threshold.

### S2. `accumulate` config type should be exported

The plan defines `AccumulateConfig` as a local interface in `accumulate.ts` but does not export it. Consumers writing inline handlers may want to type their config objects.

### S3. Test count estimate may be low

The plan estimates ~71 tests. Counting the actual test cases in the plan:
- Task 3 intents: 12 tests
- Task 4 asyncPool: 5 tests
- Task 5 groupBy: 5 tests
- Task 6 forkMerge: 4 tests
- Task 7 csvSerializer: 5 tests
- Task 8 normalizeHandler: 4 tests
- Task 9 errorCollector: 8 tests
- Task 10 intentExecutor: 8 tests
- Task 11 batchEngine: 5 tests
- Task 12 createEventHandler: 2 tests
- Task 13 testHarness: 8 + 3 fakeSqsRecord = 11 tests
**Actual total: ~69 tests** (close to estimate, slightly under)

### S4. Spec mentions `EventDropped` published to bus — plan doesn't implement it

The spec's batch engine flow (step 8) says non-retryable errors should publish an error event to the bus. The plan's `BatchEngine` collects dropped errors via `ErrorCollector.droppedErrors` but never calls `publishErrorEvent` for them. The post-batch phase should iterate `droppedErrors` and publish each to the bus.

### S5. Missing edge case test: handler returning `skip()` intent

The intent executor has a `skip` case that returns success, but no batch-engine-level test verifies that a handler returning `skip()` is treated as success (not deduplicated, not failed).

---

## Completeness Check (Spec vs Plan)

| Spec Component | In Plan? | Notes |
|---|---|---|
| WriteIntent types | Yes | All 5 intent types match spec |
| Intent helpers (overloaded) | Yes | record, project dual-mode; accumulate inline-only |
| EventContext | Yes | Matches spec exactly |
| StreamRecord / StreamContext | Yes (types only) | No stream engine implementation (deferred) |
| EventPayload | Yes | Matches spec |
| HandlerFn / HandlerEntry | Yes | Matches spec including mixed arrays |
| asyncPool | Yes | Matches spec |
| groupBy (overloaded) | Yes | Matches spec |
| forkMerge | Yes | Matches spec |
| csvSerializer | Yes | Named `toCsv` in plan (spec says "csv-serializer") |
| BatchEngine | Yes | Core loop matches spec flow |
| StreamEngine | Deferred | Explicitly deferred to Chunk 5 |
| IntentExecutor | Yes | See C1 re: guardedWrite duplication |
| ErrorCollector | Yes | Missing BatchDuration (see I4) |
| createEventHandler | Yes | Matches spec |
| materializeToTable | Yes | Matches spec |
| materializeToBucket | Deferred | Explicitly deferred |
| createStreamHandler | Deferred | Explicitly deferred |
| changeDataCapture | Deferred | Explicitly deferred |
| replayAndReduce | Deferred | Explicitly deferred |
| Test harness | Yes | Matches spec |
| Fake record builders | Yes | Both SQS and DDB stream |
| Metrics (7 types) | Partial | Missing BatchDuration (see I4) |

---

## TDD Discipline

Every task follows: write test -> verify fail -> implement -> verify pass -> commit. This is consistent across all 14 tasks. Task 1 (scaffolding) and Task 2 (types-only) appropriately skip the test-first step since they contain no testable logic.

## File Paths

All file paths are consistent with the declared file structure. No mismatches found between the structure diagram and the actual task file references.

## Build/Run Commands

All test commands use `npx nx test event-processor --skip-nx-cache` which is correct for this Nx workspace. The `--testPathPattern` flag usage is correct for targeting specific test files.

## Task Ordering

Dependencies are properly respected: types (T2) before intents (T3), utils (T4-7) before engine (T8-11), engine before pipelines (T12-14). Each task can be implemented and committed independently.

---

## Summary

**Verdict:** Plan is ready for execution with fixes for C1 and C2. The remaining issues (I1-I6, S1-S5) are improvements that can be addressed during implementation or in a follow-up.

| Category | Count |
|---|---|
| Critical | 3 (C1 guardedWrite duplication, C2 missing moduleNameMapper, C3 minor) |
| Important | 6 |
| Suggestions | 5 |
