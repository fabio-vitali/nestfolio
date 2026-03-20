# Review: @nestfolio/event-processor DDB Stream Pipelines Design

**Spec under review:** `docs/superpowers/specs/2026-03-15-event-processor-ddb-streams-design.md`
**Parent spec:** `docs/superpowers/specs/2026-03-15-event-processor-design.md`
**Reviewer:** Claude Opus 4.6 (1M context)
**Date:** 2026-03-15

---

## BLOCKER Issues

### B1. `createStreamHandler` return type contradicts between parent spec and DDB spec (lines 144-157 vs parent lines 414-430)

The **parent spec** defines `createStreamHandler.processRecord` as returning `Promise<WriteIntent | WriteIntent[]>` (lines 416-418), implying stream handlers return intents like SQS handlers. The **DDB spec** (Decision #6, line 14) explicitly states "Void + own I/O" and the `processRecord` signature at lines 144-157 returns `Promise<void>`.

This is a direct contradiction. The DDB spec's `void` return is internally consistent (CDC publishes to EventBridge, reducer writes snapshots), but the parent spec was never updated to match.

**Fix:** Update the parent spec's `createStreamHandler` interface (lines 414-428) to match the DDB spec's `void` return type.

### B2. `replayAndReduce` — parent spec says "delta reduction" but DDB spec says "query-since-checkpoint" (parent lines 482-497 vs DDB lines 265-345)

The parent spec (lines 482-497) describes a **delta reducer** that applies only the batch records on top of the snapshot: "The DDB Stream batch contains only the new records that triggered the stream" and "Applies reducer sequentially for each batch record (delta only)."

The DDB spec (Decision #1, line 9) explicitly chooses **query-since-checkpoint**: "Stream batch is a trigger; query all entries since last snapshot sequence." Step 2 of the per-group flow (line 332) confirms: "Query events since checkpoint."

These are fundamentally different approaches. The query-since-checkpoint approach is more resilient (handles out-of-order delivery, shard splits) but the parent spec describes the simpler delta approach.

**Fix:** Update the parent spec's replayAndReduce section to describe the query-since-checkpoint approach, not the delta approach.

### B3. `replayAndReduce` config missing `queryEvents` in parent spec (parent lines 462-479 vs DDB lines 269-291)

The DDB spec adds `queryEvents` as an optional override for non-standard DDB schemas (line 282-285). The parent spec's `ReplayAndReduceConfig` (lines 462-479) does not include this field. An implementer reading only the parent spec would not know this escape hatch exists.

**Fix:** Add `queryEvents` to the parent spec's `ReplayAndReduceConfig`.

---

## SUGGESTION Issues

### S1. `unmarshalStream` — REMOVE events with missing OldImage (DDB spec lines 102-134)

The unmarshal utility uses `OldImage` for REMOVE events (line 108-110). If the DDB table's `StreamViewType` is `NEW_IMAGE` (not `NEW_AND_OLD_IMAGES`), OldImage is absent for REMOVE events, and `image` will be undefined. The code will crash at `unmarshall(undefined)`.

The spec says records with "no image (malformed) -> skip with warning" (line 70), but `unmarshalStream` itself does not show this guard — it assumes the image exists.

**Recommendation:** Add an explicit guard at the top of `unmarshalStream` that returns `null` when neither NewImage nor OldImage is present, and document that stream tables MUST use `NEW_AND_OLD_IMAGES` StreamViewType.

### S2. Daily checkpoint condition expression may be wrong (DDB spec line 347)

Line 347 uses: `attribute_not_exists(pk) AND attribute_not_exists(sk)`. On a DDB table, `pk` is the partition key and always exists on any item. The condition `attribute_not_exists(pk)` checks whether the **item** exists (since the pk attribute is always present on existing items, this effectively means "item doesn't exist"). However, combining it with `AND attribute_not_exists(sk)` is redundant — if the item doesn't exist (pk doesn't exist), sk also doesn't exist. The standard pattern is just `attribute_not_exists(pk)`.

**Recommendation:** Simplify to `attribute_not_exists(pk)` for clarity, or add a comment explaining the intent.

### S3. `EventBridgePublisher` retry behavior for partial failures (DDB spec lines 213-229)

When `putEvents` returns with some `FailedEntryCount > 0` but the call itself succeeds (HTTP 200), the spec doesn't describe how partial failures within a batch of 10 are handled. Are failed entries retried? Or only full `ThrottlingException` responses?

**Recommendation:** Specify whether the publisher retries individual failed entries from `putEvents` response or only retries on SDK-level exceptions.

### S4. `materializeToBucket` — `defaultFormat` passthrough mechanism unclear (DDB spec lines 400-416)

Line 415 states: "The `defaultFormat` is passed as fallback when an `s3Put()` intent doesn't specify format." However, the existing `S3PutIntent` type (parent spec line 118) has `format` as a required field (`format: 'json' | 'csv'`), not optional. Either the intent type needs to make `format` optional, or the `defaultFormat` config is dead code.

**Recommendation:** Clarify whether `S3PutIntent.format` becomes optional when used with `materializeToBucket`, and show the type change.

### S5. CDC event envelope — `record.eventId` and `record.timestamp` are not on `StreamRecord` (DDB spec lines 196-204)

The event envelope at line 199 references `record.eventId` and `record.timestamp`. The `StreamRecord` type (parent spec lines 193-200, and implemented in `stream-types.ts`) does not include `eventId` or `timestamp` — those are on the raw `DynamoDBRecord` (as `eventID`), not the unmarshalled `StreamRecord`. The spec should use `ctx.record.eventID` or add these to `StreamRecord`.

**Recommendation:** Either access `eventId` from `StreamContext.record.eventID` (and note the casing difference), or extend `StreamRecord` with these fields during unmarshalling.

### S6. Test harness `seedEvents` lacks groupKey scoping (DDB spec lines 510-513)

`createReducerTestHarness.seedEvents()` takes a flat array of events with no indication of which group they belong to. When testing multiple groups in a single test, there's no way to seed different events for different groups.

**Recommendation:** Add a `groupKey` parameter: `seedEvents(groupKey: string, events: Record<string, unknown>[])`, or use the convention query's pk/typename matching to route seeded events to groups.

---

## QUESTION Issues

### Q1. Error event bus for stream handlers — where does it come from?

`StreamEngineConfig` has `busName` (line 58) and `StreamHandlerConfig` has `bus` (line 152), but `ReplayAndReduceConfig` does not have a `bus` field (lines 269-288). How does the reducer publish error events? Does it inherit from `StreamEngine` defaults? If so, what's the default — `process.env.BUS_NAME`?

### Q2. Snapshot `version` field — initial value?

When no snapshot exists (line 331), `initialState` is used. What is the initial `version` value — 0 or 1? The conditional write (line 341) checks `version = :expectedVersion`, and the snapshot includes `version: nextVersion`. If `initialState` has no version, is it implicitly 0, and `nextVersion` = 1?

### Q3. Convention query `typename` derivation with mixed types in a group

The convention query (line 302) uses `typename` from "the filtered records' `__typename`." If a group contains records with different `__typename` values (e.g., after `groupBy` groups by `tenantId` across multiple entity types), which typename is used for the `begins_with` prefix? The first? All of them with multiple queries?

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 3     |
| SUGGESTION | 6   |
| QUESTION | 3     |

**Verdict:** NOT APPROVED — 3 blockers must be resolved. All three blockers are parent-spec inconsistencies where the parent spec was not updated to reflect DDB-spec design decisions. The DDB spec itself is internally consistent and well-structured. Fix the parent spec alignment and clarify the questions before implementation.
