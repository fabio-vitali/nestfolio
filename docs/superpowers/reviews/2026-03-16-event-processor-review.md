# Code Review: @nestfolio/event-processor

**Reviewer:** Claude Opus 4.6 (Senior Code Reviewer)
**Date:** 2026-03-16
**Scope:** Full library review (SQS + DDB Stream pipelines) + uncommitted changes
**Spec:** `docs/superpowers/specs/2026-03-15-event-processor-design.md`
**Plan:** `docs/superpowers/plans/2026-03-15-event-processor.md`
**Test results:** 22 suites, 129 tests, all passing

---

## What Was Done Well

- **Spec alignment is excellent.** The implementation faithfully follows the design spec's architecture, types, intent system, and processing flow. All six design principles (declarative, convention-over-config, transparent guards, per-record error isolation, store-then-CDC, performant) are implemented.
- **Test coverage is strong.** 22 test suites with 129 tests (exceeding the planned ~71 for SQS alone). Every module has a dedicated test file in the correct `test/` directory convention.
- **Clean separation of concerns.** The engine/intents/pipelines/util/types/testing directory structure matches the spec precisely. Each module has a single responsibility.
- **DDB Stream pipelines delivered ahead of plan.** Chunk 5 was explicitly deferred in the plan, yet the implementation includes `createStreamHandler`, `changeDataCapture`, `replayAndReduce`, `materializeToBucket`, `StreamEngine`, `StreamCollector`, and stream test harnesses -- all with tests. This is a beneficial deviation.
- **asyncPool is admirably minimal.** ~8 lines wrapping p-limit. No Highland, no RxJS. Exactly what the spec called for.
- **Intent executor uses correct DDB patterns.** `record` uses `attribute_not_exists(pk)` for idempotent puts; `accumulate` delegates to `guardedWrite` for transactional dedup; `project` uses unconditional upsert. All correct per spec.

---

## Plan Alignment Analysis

| Planned Item | Status | Notes |
|---|---|---|
| Chunk 1: Scaffolding + Types + Intents (Tasks 1-3) | COMPLETE | All intent helpers implemented with dual mode (inline + mapper) |
| Chunk 2: Concurrency Utilities (Tasks 4-7) | COMPLETE | asyncPool, groupBy, forkMerge, csvSerializer all present |
| Chunk 3: Engine Core (Tasks 8-11) | COMPLETE | normalizeHandler, errorCollector, intentExecutor, batchEngine |
| Chunk 4: Pipelines + Testing (Tasks 12-14) | COMPLETE | createEventHandler, materializeToTable, test harness |
| Chunk 5: DDB Stream (deferred) | IMPLEMENTED | Beneficial deviation -- delivered with full test coverage |

**Deviation:** The plan explicitly deferred Chunk 5, stating "DDB Stream pipelines will be planned separately after the SQS framework is validated in 2-3 services." However, the implementation includes all stream pipelines. This is a **beneficial deviation** -- it means the library is feature-complete and services can adopt both SQS and DDB Stream pipelines immediately. No issues with this approach.

---

## Issues

### Critical (Must Fix)

None identified. The library is architecturally sound and all tests pass.

### Important (Should Fix)

**I1: Uncommitted changes span multiple libraries outside event-processor scope**

The working tree has uncommitted modifications to:
- `libs/platform-core/src/errors.ts` -- removes `handleErrors` (Highland error handler) and its JSDoc
- `libs/platform-core/src/validation.ts` -- removes `withSchemaValidation` (Highland stream operator)
- `libs/platform-core/src/index.ts` -- removes `handleErrors` and `withSchemaValidation` exports
- `libs/platform-core/tsconfig.lib.json` -- changes
- `libs/platform-core/test/errors.test.ts` -- removes tests for `handleErrors`
- `libs/lambda-utils/src/middleware/apply-middleware.ts` -- relaxes `Middleware` type to use `any[]`
- `libs/lambda-utils/src/sqs-parser.ts` -- adds `as Record<string, unknown>` cast
- `libs/shared-state/src/features/with-devtools.ts` -- changes

These are cleanup changes (removing Highland remnants, fixing type casts), but they should be committed separately from the event-processor work with a clear commit message like `refactor: remove Highland.js remnants from platform-core` so the change history is traceable.

**Risk:** Removing `handleErrors` and `withSchemaValidation` from platform-core's public API is a **breaking change**. If any service still imports these, builds will fail. Verify no consumers remain before committing.

**I2: Middleware type relaxed to `any[]` without explanation**

In `libs/lambda-utils/src/middleware/apply-middleware.ts`, the `Middleware` type changed from:
```typescript
type Middleware = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => Promise<R>;
```
to:
```typescript
type Middleware = <R>(fn: (...args: any[]) => Promise<R>) => (...args: any[]) => Promise<R>;
```

This loses type safety on middleware argument types. The original generic `A extends unknown[]` preserved argument types through the middleware chain. The `any[]` version allows middleware to silently accept incorrect argument shapes.

**Recommendation:** Either revert to the original type or document why the relaxation was necessary (likely a TypeScript inference issue with deeply nested generics). If it was needed for event-processor integration, consider a more targeted fix.

**I3: IntentExecutor throws on `s3-put` instead of returning a failure result**

```typescript
case 's3-put': throw new NotRetryableError('S3 intents require an S3 executor...');
```

This is inconsistent with the error isolation principle. All other intent failures are caught and returned as `IntentResult`, but `s3-put` throws. While this is a programming error (misconfiguration), it would be more consistent to return `{ _tag: 's3-put', success: false }` or handle it in the batch engine's per-record catch. Currently the catch in batch-engine will handle it, so this is safe but surprising.

**I4: `sqs-parser.ts` type cast is a symptom, not a fix**

The change `(event.context as Record<string, unknown>)?.tenantId` suggests the `BusEvent.context` type is `unknown` or loosely typed. The cast appears in both `sqs-parser.ts` and `batch-engine.ts`. Consider adding a proper type guard or typing `context` more precisely in the `BusEvent` type to avoid scattering casts.

### Suggestions (Nice to Have)

**S1: Missing `src/types/index.ts` barrel file**

All other directories (`intents/`, `pipelines/`, `util/`, `testing/`) have barrel files, but `types/` does not. The main `index.ts` imports directly from `./types/write-intent`, `./types/handler-config`, etc. A barrel would be consistent.

**S2: `createStreamHandler` does not use the `table` config parameter**

`StreamHandlerConfig` accepts `table?: string | { name: string; client: DynamoDBDocumentClient }` but `createStreamHandler` only extracts `busName` and ignores `table` entirely. Either use it or remove it from the config interface to avoid confusing consumers.

**S3: Consider documenting the `_` prefix convention for unused parameters**

The uncommitted changes add `_id`, `_eventType`, `_messageId` prefixes to unused parameters. This is good practice and follows TypeScript convention, but the changes should be in a dedicated commit (not mixed with import changes).

**S4: `ErrorEventPublisher` import moved from `lambda-utils` to `platform-core`**

The change `import { logger, getUUID, getTime } from '@nestfolio/platform-core'` (was `lambda-utils`) suggests these utilities live in platform-core. Verify this is the canonical import path -- if both libs re-export these, consumers may use inconsistent imports.

**S5: Stream test harness log output in test runs**

The test output shows INFO-level log lines from `replayAndReduce` tests ("Snapshot updated", "No new events to reduce"). Consider mocking the logger in tests to keep test output clean, or setting log level to ERROR in test config.

---

## Architecture Assessment

The library follows SOLID principles well:
- **Single Responsibility:** Each module has one job (asyncPool = concurrency, IntentExecutor = DDB writes, ErrorCollector = error classification)
- **Open/Closed:** New intent types can be added without modifying existing helpers; new pipelines compose existing engines
- **Dependency Inversion:** IntentExecutor depends on `DynamoDBDocumentClient` interface, not concrete implementations

The **store-then-CDC** principle is correctly enforced: SQS handlers only produce `WriteIntent` objects (DDB/S3 writes), and event publishing happens exclusively through `changeDataCapture` on DDB Streams.

The **BaseCollector** abstract class with SQS-specific `ErrorCollector` and Stream-specific `StreamCollector` subclasses is a clean hierarchy that avoids duplication while allowing domain-specific behavior.

---

## Summary

| Category | Count |
|---|---|
| Critical | 0 |
| Important | 4 |
| Suggestions | 5 |

The `@nestfolio/event-processor` library is well-implemented, closely aligned with its design spec, and exceeds the original plan by delivering DDB Stream pipelines ahead of schedule. The main concerns are around the uncommitted changes that span multiple libraries (particularly the breaking API removals in platform-core and the type safety regression in lambda-utils middleware). These should be reviewed, verified against consumers, and committed as separate, well-documented changesets.

**Verdict:** Ready to ship after addressing I1 (commit hygiene) and I2 (middleware type safety). I3 and I4 are improvement opportunities for a follow-up.
