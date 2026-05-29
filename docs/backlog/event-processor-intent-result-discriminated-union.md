---
id: event-processor-intent-result-discriminated-union
status: parking
type: refactor
notes: "IntentResult._tag is `string`, not a discriminated union like WriteIntent — executor returns lose downstream narrowing."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_processor.md]
validation_gate: null
---

# event-processor IntentResult should be a discriminated union

`libs/event-processor/src/types/result-types.ts` declares `IntentResult` with
`readonly _tag: string` (generic). Every executor method in
`libs/event-processor/src/engine/intent-executor.ts`
(`executeRecord`/`executeProject`/`executeProjectVersioned`/`executeAccumulate`/
`executeUpdate`/`executeStore`) returns a literal `_tag` (`'record'`,
`'projectVersioned'`, …) plus `success` and optional `deduplicated`, but the
widened `_tag: string` means callers cannot narrow on the result tag the way they
can on `WriteIntent._tag` (which IS a proper discriminated union in
`types/write-intent.ts`).

**Cheapest next step:** mirror the `WriteIntent` pattern — give each executor a
per-tag result interface and union them as `IntentResult` so `_tag` is a literal
discriminant. Pure type-level; no runtime change.

**Provenance:** surfaced as a Minor in the final review of
`bff-readmodel-w0-event-processor-foundation` (2026-05-29). Pre-existing pattern,
not introduced by w0. Low priority; not e2e-blocking → parking. See
[[project_event_processor]].
