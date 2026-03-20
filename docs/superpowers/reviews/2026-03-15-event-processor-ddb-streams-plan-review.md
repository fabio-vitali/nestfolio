# Plan Review: Event Processor DDB Stream Pipelines

**Plan:** `docs/superpowers/plans/2026-03-15-event-processor-ddb-streams.md`
**Spec:** `docs/superpowers/specs/2026-03-15-event-processor-ddb-streams-design.md`
**Reviewer:** Claude Opus 4.6 (1M context)
**Date:** 2026-03-15

---

## Chunk 1: Shared Infrastructure (Tasks 1-2)

### Task 1: Extract BaseCollector — APPROVED

- **Spec alignment:** Matches spec's `BaseCollector` design exactly (abstract class, `recordSuccess`, `recordError`, `getErrors`, `getMetrics`, `incrementMetric`).
- **TDD order:** Correct (test first, implement, then refactor ErrorCollector).
- **Test coverage:** 5 tests cover initialization, success, retryable/non-retryable classification, mixed batch. Sufficient.
- **Dependencies:** None — first task, clean starting point.
- **Code correctness:** Sound. The `recordSuccess` method is a no-op in base — documented that subclasses call `incrementMetric`. Acceptable pattern.

**Issues:**

1. **BLOCKER — ErrorCollector refactor breaks existing `recordError` signature.** The current `ErrorCollector.recordError` signature is `(messageId, eventType, error, retryable)` — four positional args where arg 2 is a string. The plan introduces overloaded signatures using `args[1] instanceof Error` to disambiguate. However, `BatchEngine` calls `collector.recordError(messageId, 'UNKNOWN', err, retryable)` — this matches the *legacy* overload. The plan's Step 5 says "existing tests must still pass" but does not update the BatchEngine call site. The overload dispatch (`args[1] instanceof Error`) will correctly route `'UNKNOWN'` (string) to the legacy path, so this actually works at runtime. **Downgraded to SUGGESTION**: add a test in Task 1 Step 6 that explicitly covers the legacy call path `recordError(id, eventType, error, retryable)` to prove the overload routing.

2. **SUGGESTION — `droppedErrors` type changed.** The current `CollectorResults.droppedErrors` is `Array<{ messageId; eventType; error }>`. The plan adds `causedBy?: unknown` to it. This is backward-compatible (optional field), but should be noted in the commit message as a type extension.

### Task 2: ErrorEventPublisher + SQS backfill — APPROVED

- **Spec alignment:** Matches spec's `ErrorEventPublisher` (fire-and-forget, per-error try/catch, `causedBy` field).
- **TDD order:** Correct.
- **Test coverage:** 5 tests — happy path, groupKey, swallowed failures, continues on partial failure, empty array. Sufficient.
- **Code correctness:** Sound.

**Issues:**

3. **BLOCKER — BatchEngine backfill catch block is a no-op diff.** Lines 411-416 and 419-424 in the plan show identical "before" and "after" code for the catch block. The plan says to "pass `causedBy` (the parsed event payload)" but the actual code change is missing. The catch block should be modified to capture the parsed event body and pass it through to `collector.recordError`. Currently `recordError(messageId, 'UNKNOWN', err, retryable)` does not pass `causedBy`. Fix: show the actual diff that adds `causedBy` to the error collector call, e.g., storing the parsed `uow.event` before the try block and passing it in the catch.

4. **SUGGESTION — Test count arithmetic.** Plan says "67 + 5 + 5 = 77 tests" but Task 1 adds 5 (BaseCollector) and Task 2 adds 5 (ErrorEventPublisher) = 10 new, total 77. The math is correct.

---

## Chunk 2: StreamEngine Core (Tasks 3-5)

### Task 3: unmarshalStream — APPROVED

- **Spec alignment:** Exact match to spec's `unmarshalStream` utility (image selection, null guard, context fields).
- **TDD order:** Correct.
- **Test coverage:** 6 tests — INSERT, REMOVE (OldImage), MODIFY (both images), null image, serviceName, raw record preservation. Sufficient.
- **Code correctness:** Sound.

**Issues:**

5. **SUGGESTION — Double unmarshall for REMOVE.** For `REMOVE` events, `image` is `OldImage` and `oldImageRaw` is also `OldImage`, so `unmarshall` is called twice on the same data. Minor perf issue, not a bug. Could cache the result.

### Task 4: StreamCollector — APPROVED

- **Spec alignment:** Matches spec's `StreamCollector` (extends `BaseCollector`, `hasRetryableErrors`, stream-specific metric names).
- **TDD order:** Correct.
- **Test coverage:** 7 tests. Sufficient.
- **Code correctness:** Sound. `setBatchDuration` uses `incrementMetric` which adds to the initial 0 — correct for single-call-per-batch usage.

No issues.

### Task 5: StreamEngine — APPROVED

- **Spec alignment:** Matches spec's processing flow (unmarshal, filter, group, process, classify, throw/no-throw).
- **TDD order:** Correct.
- **Test coverage:** 8 tests — per-record, filter, groupBy, pick:last, success, retryable throw, non-retryable resolve, null image skip. Sufficient.

**Issues:**

6. **BLOCKER — `groupBy` with `pick: 'last'` returns `Map<string, T>` (single item), but StreamEngine treats items as arrays.** Looking at `group-by.ts`, when `pick` is `'first'` or `'last'`, `groupBy` returns `Map<string, T>` (not `T[]`). The StreamEngine code does `const records = Array.isArray(items) ? items : [items]` — this handles both overloads correctly. **Not a blocker after all.** The code is correct, the `Array.isArray` check properly handles the union return type.

7. **SUGGESTION — Missing `pick: 'first'` test.** Only `pick: 'last'` is tested. Add one test for `pick: 'first'` to verify the first record is kept.

8. **SUGGESTION — Metrics not emitted.** The spec says "Single `putMetricData` call" post-batch, but the StreamEngine implementation collects metrics in StreamCollector without actually calling CloudWatch. The spec's metrics section lists 7 metrics. This is acceptable if metric publishing is deferred to a later task or handled at the pipeline level, but should be explicitly noted. The plan's Task 14 test count won't catch this gap.

---

## Chunk 3: Stream Pipelines (Tasks 6-8)

### Task 6: createStreamHandler — APPROVED

- **Spec alignment:** Matches spec (thin wrapper, auto-creates clients from env).
- **TDD order:** Correct.
- **Test coverage:** 3 tests — returns handler, processRecord, processGroup. Sufficient for a thin wrapper.
- **Code correctness:** Sound.

No issues.

### Task 7: EventBridgePublisher — APPROVED

- **Spec alignment:** Matches spec (batch of 10, per-chunk retry, retryable vs non-retryable codes, max 2 retries).
- **TDD order:** Correct.
- **Test coverage:** 5 tests — batch split, retry, NotRetryableError, exhausted retries, empty. Sufficient.
- **Code correctness:** Sound.

No issues.

### Task 8: changeDataCapture — APPROVED with issues

- **Spec alignment:** Matches spec's CDC flow (eventTypeMap, filter by typename:eventName, groupBy with pick, transform, EventBridgePublisher).
- **TDD order:** Correct.
- **Test coverage:** 5 tests — matching, skipping, function resolver, transform, dedup with pick:last. Sufficient.

**Issues:**

9. **BLOCKER — CDC filter is a no-op (`return true`).** The `filter` variable is defined but never used — it's not passed to the `StreamEngine` config. The plan has a comment saying "For now, accept all — the actual eventTypeMap check happens during processing." This means ALL records are unmarshalled and passed to `processRecord`, which then checks eventTypeMap and returns early. This works correctly but wastes cycles. More importantly, the `filter` variable is dead code. Fix: either remove the dead `filter` variable or pass `filter` to StreamEngine (the latter would require access to `ctx.eventName` which isn't available in the filter callback). The current approach (check in processRecord) is actually the correct pattern per the spec — just remove the dead `filter` variable.

10. **BLOCKER — `processGroup` uses `ctx.eventName` but ctx comes from first record.** When using `groupBy`, `processGroup` receives `(groupKey, records, ctx)` where `ctx` is from the first record in the group. But `resolveEventType(record, ctx.eventName, ...)` uses that single `ctx.eventName` for ALL records in the group. If a group contains mixed event names (INSERT + MODIFY), records after the first will get the wrong eventName. Fix: the CDC `processGroup` should derive eventName per-record from each record's own context. Since `StreamRecord` doesn't carry `eventName`, the implementation needs to either (a) add eventName to StreamRecord, or (b) carry a per-record ctx Map. The simplest fix: store the eventName on the StreamRecord during unmarshal (add `eventName` field to StreamRecord type).

11. **SUGGESTION — Unused engineConfig variable.** Lines 1547-1554 define `engineConfig` with a complex conditional type that is never used — the code creates `StreamEngine` inline twice (with/without groupBy). This dead code should be removed.

---

## Chunk 4: replayAndReduce (Task 9)

### Task 9: replayAndReduce — APPROVED with issues

- **Spec alignment:** Matches spec (load snapshot, convention query, sort, reduce, optimistic save, daily checkpoint, ConditionalCheckFailedException as retryable).
- **TDD order:** Correct.
- **Test coverage:** 8 tests — returns handler, full flow (no snapshot), delta on existing, skip on no events, ConditionalCheckFailed, filter, queryEvents override, daily checkpoint. Sufficient.

**Issues:**

12. **BLOCKER — `conventionQuery` signature differs from spec.** The spec passes `groupKey` as the first parameter; the plan's implementation drops `groupKey` from the signature: `conventionQuery(lastSequence, typename, pk, clients)`. This is fine because the convention query doesn't use groupKey, but the plan's `processGroup` calls it without groupKey — consistent. However, the spec's `queryEvents` override receives `groupKey` as param 1. The plan's implementation correctly passes `groupKey` to `config.queryEvents`. **Not actually a blocker** — the internal function is free to differ from the external interface. Downgraded.

13. **BLOCKER — ConditionalCheckFailedException test mocking.** The test creates `const condError = new Error('ConditionalCheckFailedException'); condError.name = 'ConditionalCheckFailedException'` and expects the handler to throw `StreamBatchError`. But `replayAndReduce`'s processGroup does NOT catch `ConditionalCheckFailedException` — it just lets it propagate as a regular error. The StreamEngine catch block then classifies it via `isRetryable(err)`. For this to work, `isRetryable` from `@nestfolio/lambda-utils` must return `true` for errors named `ConditionalCheckFailedException`. **Verify** that `isRetryable` handles this error name. If it doesn't, the error will be classified as non-retryable and published to EventBridge instead of causing a retry. Fix: either (a) confirm `isRetryable` handles this, or (b) add explicit catch in processGroup that rethrows as a retryable Error (not NotRetryableError).

14. **SUGGESTION — `maxSeq` calculation ignores `lastSeq`.** Line 1921-1924: `const maxSeq = events.reduce((max, e) => Math.max(max, ...), 0)`. The initial accumulator is `0`, not `lastSeq`. If events have sequenceNo 0 (edge case), maxSeq would incorrectly be 0 when it should be `lastSeq`. Should be `events.reduce(..., lastSeq)`.

15. **SUGGESTION — Snapshot state extraction.** Line 1888-1889: `const currentState: S = existing ? (existing as unknown as S) : ...`. This casts the raw DDB item (which includes `pk`, `sk`, `version`, `lastEventSequence`, `updatedAt`) directly to `S`. The reducer's state type `S` likely doesn't have these DDB bookkeeping fields. The initial state won't have them. This means on first reduce: state = `{ total: 0 }`, then events reduce to `{ total: 300 }`, snapshot saved as `{ pk, sk, total: 300, version: 1, ... }`. On second invocation: state = `{ pk, sk, total: 300, version: 1, ... }` (raw DDB item). Then reduce adds to that — the extra fields (`pk`, `sk`, `version`) leak into the state. Fix: strip DDB bookkeeping fields before casting to `S`, or restructure the snapshot to wrap state in a `state` field.

---

## Chunk 5: materializeToBucket, Harnesses, Exports (Tasks 10-14)

### Task 10: materializeToBucket — APPROVED

- **Spec alignment:** Matches spec (thin wrapper over createEventHandler with s3 bucket config).
- **TDD order:** Step 1 modifies type first (not test-first), but this is a type-only change. Acceptable.
- **Test coverage:** 3 tests. Light but appropriate for a thin wrapper.

**Issues:**

16. **BLOCKER — `EventHandlerConfig` may not have `s3` field.** The plan notes "The `createEventHandler` config may need an `s3` field added" and casts `as EventHandlerConfig`. This is incomplete — the plan should explicitly show the `EventHandlerConfig` modification or confirm the field exists. Without `s3` in the config, the `IntentExecutor` won't know which bucket to use for S3 intents.

17. **SUGGESTION — `defaultFormat` not wired.** The spec says `materializeToBucket` should apply `config.defaultFormat` to override `s3Put()`'s default. The implementation doesn't pass `defaultFormat` through. This means `defaultFormat` in the config is unused dead weight.

### Task 11: Enhance fakeDdbStreamRecord — APPROVED

- **Spec alignment:** Matches spec's enhanced signature.
- **Test coverage:** No new dedicated tests — relies on existing tests passing and new usage in Tasks 3-9. Acceptable since opts are optional.
- **Code correctness:** Sound.

No issues.

### Task 12: Stream test harnesses — APPROVED with issues

- **Spec alignment:** Matches spec's three harness types.
- **TDD order:** Correct.
- **Test coverage:** 7 tests across three harnesses. Sufficient for the harness logic.

**Issues:**

18. **SUGGESTION — CdcTestHarness groupBy logic differs from actual CDC.** The harness `groupBy` implementation flattens groups to the last item, but the actual CDC `processGroup` publishes ALL records in the group (not just last). With `pick: 'last'` the `groupBy` utility returns `Map<string, T>` (single item), so the actual CDC's `processGroup` receives a single-element array. The harness mimics this. OK.

19. **SUGGESTION — ReducerTestHarness always uses seeded events, ignoring convention query.** The real `replayAndReduce` queries DDB for events since checkpoint. The harness uses `seedEvents` as a substitute. This is the correct testing pattern, but should be documented as "harness substitutes DDB query with seeded events."

### Task 13: Update index.ts exports — APPROVED

- **Spec alignment:** All new types and functions exported.
- **Code correctness:** Sound.

**Issues:**

20. **SUGGESTION — Missing `ErrorEventPublisher` export.** The plan exports `BaseCollector` and `StreamCollector` but not `ErrorEventPublisher`. The spec lists it as shared infrastructure. If consumers need to test error publishing behavior, they'd need access. Consider exporting it.

21. **SUGGESTION — Missing `EventBridgePublisher` export.** Spec says it's "internal, used by CDC" — keeping it unexported is correct per the spec. No action needed.

### Task 14: Final verification — APPROVED

- **Test count:** Plan estimates ~127 tests. Actual: 67 existing + 5 (BaseCollector) + 5 (ErrorEventPublisher) + 6 (unmarshalStream) + 7 (StreamCollector) + 8 (StreamEngine) + 3 (createStreamHandler) + 5 (EventBridgePublisher) + 5 (CDC) + 8 (replayAndReduce) + 3 (materializeToBucket) + 7 (stream harnesses) = 129. Close enough.

No issues.

---

## Summary

| Chunk | Verdict | Blockers | Suggestions |
|-------|---------|----------|-------------|
| 1 (Tasks 1-2) | **APPROVED** | 1 (B3: BatchEngine backfill diff is no-op) | 2 |
| 2 (Tasks 3-5) | **APPROVED** | 0 | 3 |
| 3 (Tasks 6-8) | **APPROVED** | 2 (B9: dead filter code, B10: ctx.eventName per-record in CDC processGroup) | 1 |
| 4 (Task 9) | **APPROVED** | 1 (B13: isRetryable + ConditionalCheckFailed) | 2 |
| 5 (Tasks 10-14) | **APPROVED** | 1 (B16: EventHandlerConfig missing s3 field) | 4 |

### Blockers to fix before implementation:

1. **B3 (Task 2):** Show the actual BatchEngine catch block diff that adds `causedBy` to the `recordError` call. The current plan shows identical before/after code.

2. **B10 (Task 8):** CDC `processGroup` uses `ctx.eventName` from the first record for all records in the group. Either add `eventName` to `StreamRecord` type (in `stream-types.ts`) so each record carries its own event name, or restructure CDC to carry per-record context.

3. **B13 (Task 9):** Verify that `isRetryable()` from `@nestfolio/lambda-utils` classifies `ConditionalCheckFailedException` as retryable. If not, add explicit catch in `replayAndReduce`'s `processGroup`.

4. **B16 (Task 10):** Show the `EventHandlerConfig` modification to add the `s3` field, or confirm it already exists.

### Key note on B9:
The dead `filter` variable in `changeDataCapture` (lines 1519-1523) should be removed. It's confusing but not functionally broken.

### Spec completeness check:
- All spec items covered: BaseCollector, ErrorEventPublisher, StreamEngine, unmarshalStream, createStreamHandler, changeDataCapture, replayAndReduce, materializeToBucket, test harnesses, fake records, exports.
- **Missing from plan:** The spec's Metrics section describes 7 CloudWatch metrics (`StreamRecordProcessed`, `StreamRecordFailed`, `StreamBatchSize`, `StreamBatchDuration`, `SnapshotUpdated`, `SnapshotConflict`, `EventsPublished`). The StreamCollector tracks the first 4, but `SnapshotUpdated`, `SnapshotConflict`, and `EventsPublished` are never emitted anywhere in the plan. This is a **SUGGESTION** — these could be added in `replayAndReduce` and `changeDataCapture` respectively, or deferred.
- **Missing from plan:** The spec's "Circular Error Event Prevention" section (lines 119-129) is an architectural note, not an implementation task. No action needed.
