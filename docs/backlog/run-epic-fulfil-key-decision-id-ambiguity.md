---
id: run-epic-fulfil-key-decision-id-ambiguity
status: queued
rank: 4
type: bug
epic: runtime-operationalization
epic_role: core
notes: "run-epic --fulfil advances only on the STEP key (member.<id>) but pending prints decision execute:<id> too — fulfil-by-decision-id journals an orphan step and thrashes; SKILL wording ambiguous."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# run-epic.mjs production fulfil-key ambiguity (step key vs decision id)

The epic spine parks members under journal step key `member.<id>` with decision id `execute:<id>`
(`runtime/engine/loop/orchestrator.mjs:24` vs the worker's coinciding keys at
`runtime/engine/loop/worker.mjs:29`). `run-epic.mjs --fulfil <key>` only advances when given the
STEP key — `journal.fulfil` appends by key and `journal.step` replays only its own key
(`runtime/engine/lib/journal.mjs:49,65`). But the pending record prints both, and the
`backlog-next-epic` SKILL-style wording says "fulfil the printed decision key" — a real session
fulfilling by decision id (`execute:m1`) journals an orphan step and thrashes. This is exactly the
trap the oracle operator hit (fixed for the ORACLE in `parity-oracle-bne-live-red-fixes` via the
`OPERATOR_PROMPT` rewording); the production adapter + SKILL wording remain exposed.

**Fix candidates:** (a) `run-epic.mjs` (and `run-next.mjs` for symmetry) accept a fulfil key that
matches a pending step's `decision.id` and translate it to that step's key — adapter-ring
robustness, engine untouched; (b) one-line SKILL wording fix ("the pending key, exactly as
printed"). Discovered 2026-07-08 while fixing the two red bne parity pairs.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named /backlog-next target run-epic-fulfil-key-decision-id-ambiguity was status: parking (member of parking theme epic runtime-operationalization; no trigger language). Promote and work now, or stop?
- **Options:** Promote to queued (rank 4) and work it now | Stop, leave it parking
- **Chosen:** Promote to queued (rank 4) and work it now
- **Rationale:** User-resolved via AskUserQuestion (parking refusal is a floor stop in --auto, never silently promoted). No unmet trigger language blocks it; theme-epic members drain as standalone PRs; working it via the runtime engine counts toward the soak-gate >=5-workstream clause.
- **Rejected:** Stop, leave it parking — user explicitly named the item; a dead-stop forcing a hand-edit + re-run adds friction without protecting any invariant.
