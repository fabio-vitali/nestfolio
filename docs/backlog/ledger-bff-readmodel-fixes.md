---
id: ledger-bff-readmodel-fixes
status: queued
rank: 6
type: bug
notes: "ledger-bff read-model residuals: (A) ledger-entry-recorded P2 rows (HistoryEntry/Checkpoint) read top-level fields the real LEDGER_ENTRY_RECORDED producer never emits — degrade in prod; (B) ~18 latent tsc --noEmit errors blocking a clean service-wide typecheck. Merges ledger-entry-recorded-producer-shape-mismatch + ledger-bff-latent-tsc-errors."
references: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "ledger-ctrl's own latent tsc errors (ledger-ctrl-2-latent-tsc-errors) — separate file; the TableEntry timestamp fix likely shares a root cause, coordinate but don't bundle."
validation_gate: null
---

# ledger-bff read-model fixes

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Two ledger-bff residuals from `bff-readmodel-w1-ledger-bff`, done together (same
service). Merges two formerly-separate items.

## A. `ledger-entry-recorded` P2 rows read fields the producer never emits

`services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts` builds its P2
append-logs (`HistoryEntry`, `Checkpoint`) from **top-level** payload fields:
`payload.eventId`, `eventType`, `sequenceNo`, `timestamp`, `cashBalanceCents`,
`positions`.

But the real producer — `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`
`LedgerEntryEvent` (→ `LEDGER_ENTRY_RECORDED`) — emits only
`{ tenantId, streamType, lastEventSequence, snapshot: { positions, cashBalanceCents, lastEventSequence } }`.

Consequences in production (not in integration tests, which inject synthetic
top-level payloads):
- `HistoryEntry` sk `Entry#${payload.sequenceNo}` → `Entry#undefined`; `eventId`/`eventType` blank.
- `Checkpoint` gate `payload.sequenceNo % 100 === 0` with `sequenceNo` undefined →
  never fires; even if it did, `cashBalanceCents`/`positions` would be 0/{}.

Same structural-zero / producer-consumer-shape rot the read-model program targets,
but for the P2 append-logs rather than the P1 projections w1 migrated (w1
deliberately left these reading top-level to keep the reference migration minimal).
**Coupling note:** WS-B (`read-model-ownership-w-b-version-carriage`) touches the same
`LEDGER_ENTRY_RECORDED` producer to add `__version`; settle the canonical event
contract once. **Cheapest next step:** either (a) ledger-ctrl carries
`eventId/eventType/sequenceNo` + a usable history payload top-level, or (b)
re-source HistoryEntry/Checkpoint from `payload.snapshot.*` + the ledger sequence.
Align the integration fixtures to the real producer shape so the gap becomes
test-visible.

## B. ~18 latent `tsc --noEmit` errors

`npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json` reports ~18 errors
in `src` plus more in legacy test files. Not a deploy/test blocker (esbuild strips
types; ts-jest lenient) but blocks a clean service-wide `typecheck` target (needed
for the WS-D enforcement gate). Representative:
- `src/handlers/event-listener.ts` — `UnitOfWork<BusEvent<…, …>>` not assignable to
  `UnitOfWork<BusEvent<…>>` (generic variance on transform handler signatures).
- `src/repositories/portfolio.repository.ts` (:78, :98, :118, :144, :162) —
  `'timestamp' does not exist in type 'TableEntry'` (same `TableEntry` excess-property
  issue as `ledger-ctrl-2-latent-tsc-errors`).
- Legacy `test/unit/transforms/*.test.ts` — `as Record<string, unknown>[]` casts that
  error under tsc.

**Cheapest next step:** fix the `event-listener.ts` `UnitOfWork` generic widening
(align `toUow` generic args) + the `TableEntry` `timestamp` shape; then add a
`typecheck` target. See [[project_read_model_redesign]].
