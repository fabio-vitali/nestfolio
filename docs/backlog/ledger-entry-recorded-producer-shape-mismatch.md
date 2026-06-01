---
id: ledger-entry-recorded-producer-shape-mismatch
status: queued
rank: 3
type: bug
notes: "ledger-bff ledger-entry-recorded reads top-level eventId/eventType/sequenceNo/cashBalanceCents/positions, but the real LedgerEntryEvent producer emits only tenantId/streamType/lastEventSequence/snapshot — HistoryEntry sk + Checkpoint degrade in prod."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# ledger-entry-recorded P2 rows read fields the real producer never emits

Surfaced 2026-05-29 during the final review of `bff-readmodel-w1-ledger-bff`.

`services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts` builds its P2
append-logs (`HistoryEntry`, `Checkpoint`) from **top-level** payload fields:
`payload.eventId`, `payload.eventType`, `payload.sequenceNo`, `payload.timestamp`,
`payload.cashBalanceCents`, `payload.positions`.

But the real producer — `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`
`LedgerEntryEvent` (→ `LEDGER_ENTRY_RECORDED`) — emits only:
`{ tenantId, streamType, lastEventSequence, snapshot: { positions, cashBalanceCents, lastEventSequence } }`.

Consequences in production (NOT in integration tests, which inject synthetic
top-level payloads):
- `HistoryEntry` sk = `Entry#${payload.sequenceNo}` → `Entry#undefined`; `eventId`/`eventType` blank.
- `Checkpoint` gate `payload.sequenceNo % 100 === 0` with `sequenceNo` undefined →
  `undefined > 0` is false → **Checkpoint never fires in production**.
- Even if it fired, `cashBalanceCents`/`positions` would be 0/{} from top-level.

This is the same structural-zero / producer-consumer-shape rot the read-model
program ([[project_read_model_redesign]]) targets, but for the P2 append-logs
rather than the P1 projections w1 migrated. w1 deliberately left HistoryEntry and
Checkpoint reading top-level (their pre-existing state) to keep the reference
migration minimal; only the user-approved **simulated-path** (Simulation/
SimulationPosition) snapshot fix landed in w1.

**Why parking (not queued):** no e2e/integration suite asserts these fields today
(integration injects synthetic top-level payloads so HistoryEntry passes; no test
reads Checkpoint data fields). Purely latent. Promote if a feature starts relying
on HistoryEntry/Checkpoint content, or fold into a later read-model workstream.

**Cheapest next step:** decide the canonical `LEDGER_ENTRY_RECORDED` contract — either
(a) have ledger-ctrl carry `eventId/eventType/sequenceNo` + a usable history payload
top-level, or (b) re-source HistoryEntry/Checkpoint from `payload.snapshot.*` and the
ledger sequence. Align the integration fixtures to the real producer shape so the
gap becomes test-visible.
