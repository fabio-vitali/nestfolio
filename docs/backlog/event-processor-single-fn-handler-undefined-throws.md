---
id: event-processor-single-fn-handler-undefined-throws
status: queued
rank: 8
type: bug
notes: "Single-function handler returning undefined yields [undefined] → TypeError in the engine instead of a clean drop; affects all nullable single-fn transforms."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_processor.md, project_read_model_redesign.md]
validation_gate: null
---

# event-processor single-function handler: undefined throws instead of dropping

Surfaced during w4 ([[bff-readmodel-w4-investor-bff]]) code review of the
dashboard-bff `investor-snapshot.ts` migration.

When a handler is wired as a **bare single function** (e.g.
`[EVENT]: (payload, ctx) => someTransform(toUow(payload, ctx))`) and the
transform returns `undefined` (the documented "drop, don't write" path), the
engine throws instead of dropping:

- `libs/event-processor/src/engine/normalize-handler.ts` single-`HandlerFn`
  branch (~L33-36): `toArray(undefined)` → `[undefined]`. Unlike the **array**
  branch (~L17-29) it does NOT filter via `isWriteIntent`.
- That `[undefined]` reaches `ingestion-engine.ts` (~L91) where
  `intents.map((i) => i._tag)` → `TypeError: Cannot read properties of undefined`.
  → retryable error → SQS redrive → DLQ, NOT a clean drop.

Shared by every nullable single-fn transform wired this way in
`services/investor/dashboard-bff/src/handlers/event-listener.ts`:
`investor-snapshot.ts` (w4), `advisory-status.ts` (w3, shipped `da39c9ac`), and
the `RECONCILIATION_COMPLETED → portfolio-summary` entry. **Pre-existing** — w4
did not introduce it; it inherits the advisory-status wiring shape.

Live probability is LOW: post-w4/w3 the producers always stamp `__version`, so
the undefined path is only hit by genuinely legacy/transitional events (none in
disposable dev). But the failure mode is wrong (error+retry vs drop).

Cheapest fix (root, hardens repo-wide): in the single-fn branch of
`normalize-handler.ts`, `return toArray(result).filter(isWriteIntent);`. Add a
handler-level test asserting an undefined-producing event yields zero intents,
not a throw.
