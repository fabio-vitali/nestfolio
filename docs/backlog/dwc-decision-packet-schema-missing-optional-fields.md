---
id: dwc-decision-packet-schema-missing-optional-fields
status: parking
type: bug
notes: "DecisionPacketSchema was missing taskToken/confirmedAt/rejectedAt; publisher-schemas.ts stripped them from the CDC subject, breaking confirm/reject flow"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# DecisionPacketSchema missing optional fields (taskToken, confirmedAt, rejectedAt)

## Evidence

- `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts` — `DecisionPacketSchema` did not include `taskToken`, `confirmedAt`, or `rejectedAt`.
- `services/advisory/decision-workflow-ctrl/src/handlers/publisher-schemas.ts` — `subjectSchemas.DecisionPacket = DecisionPacketSchema`; the CDC pipeline calls `schema.parse(record)` which STRIPS any key not in the schema.
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:275` — SF direct-DDB write sets `taskToken` on the `DecisionPacket` row when entering `AWAITING_CONFIRMATION`.
- `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts:123,147` — `sfn-callback` writes `confirmedAt` / `rejectedAt` onto the `DecisionPacket` row via `update()` intents.
- `services/advisory/advisory-bff/src/transforms/decision-snapshot.ts` — reads `p.taskToken`, `p.confirmedAt`, `p.rejectedAt` from the CDC subject; they were always `undefined` due to stripping.

## Impact

- `taskToken` stripped → advisory-bff `DecisionReadModel` row never had `taskToken` → `confirmDecision` JS resolver's readback lifted an undefined token → `UserConfirmation` row carried `taskToken: undefined` → SF callback receive an empty token → confirm/reject flow silent-failed in production.
- `confirmedAt` / `rejectedAt` stripped → `DecisionReadModel` never showed confirmed/rejected timestamps even after the terminal update arrived via CDC.

## Fix applied in typed-test-fixtures Phase 2 Task 1

Added `taskToken: z.string().optional()`, `confirmedAt: z.string().optional()`, `rejectedAt: z.string().optional()` to `DecisionPacketSchema`. This is a production fix (publisher-schemas.ts now passes these fields through) AND a test-layer fix (fixtures can now supply them in the typed subject). Surfaced as a `(b)` latent contract bug during the typed-fixtures migration.

## Next step

Validate the confirm/reject flow end-to-end in the deployed dev environment (covered by `typed-test-fixtures-consolidated-integration-e2e-verify`).
