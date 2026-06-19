---
id: ledger-ctrl-decision-packet-fixture-thin-shape
status: parking
type: bug
notes: "ledger-ctrl integration fixtures sent { decisionPacketId, proposedTrades } for DECISION_PACKET_CREATED — a thin shape that never matched DecisionPacketSchema"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures-leftovers
epic_role: core
---

# ledger-ctrl DECISION_PACKET_CREATED fixture sent thin non-matching shape

## Evidence

- `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts:328,379,424` — fixtures sent `{ decisionPacketId, proposedTrades }` for `DECISION_PACKET_CREATED`.
- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts:155-161` — handler calls `parseSubject(payload, DecisionPacketSchema)` then reads `proposedTrades` only; `decisionId` is derived from `ctx.eventId` (the SF callback workaround comment at line 157 confirms `decisionPacketId` was always absent from the real schema and always fell back to `ctx.eventId`).
- `DecisionPacketSchema` requires `decisionId`, `trigger`, `triggerEventId`, `executionArn` (nullable), `explanation`, `status`, `__version`, etc. — none of which the old fixture provided.

## Impact

The old fixtures bypassed schema validation entirely (legacy `detail:` path). The handler worked because it only reads `proposedTrades` and derives `decisionPacketId` from `ctx.eventId`, so the missing fields had no observable effect at runtime. The mismatch was invisible until the typed migration forced schema conformance.

## Fix applied in typed-test-fixtures Phase 2 Task 1

Migrated all three fixtures to the typed `subject:` form, adding the required `DecisionPacketSchema` fields (`decisionId`, `trigger`, `triggerEventId`, `executionArn: null`, `explanation`, `status`, `__version`, nullable fields). Classified (a) for the mechanical schema additions; (b) for the `decisionPacketId` → `ctx.eventId` identity mismatch already documented in the handler comment.

## Next step

No production fix needed — the handler's `decisionId` derivation from `ctx.eventId` is intentional and pre-dated this migration. Covered by the handler comment at event-listener.ts:157.
