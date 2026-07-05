---
id: runtime-item-schema-reconciliation
status: active
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Reconcile runtime/engine/schema/item.schema.ts with the real docs/backlog frontmatter (done_criteria→done_when, relax .strict/migrate legacy keys) and wire validateItem into the read path — today ItemSchema has no production importer."
references: []
out_of_scope:
  - "Migrating backlog-lint's 11 invariants into content-ring checks — that is the P4 check-migration member; this workstream reconciles only the schema + read path."
  - "The parity-oracle regression harness — separate P3 member."
  - "Re-designing ring-1 contracts beyond the reconciliation delta; the delta re-freezes into SPEC 1 §10 within this workstream, per the epic's out_of_scope."
  - "Changing docs/backlog frontmatter data to fit the schema — the schema moves to the data, never the data to the schema (docs/backlog stays the one item store)."
  - "Forward-edge intake/planner behavior changes beyond field-name alignment."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Reconcile the runtime item schema with docs/backlog

> **Promoted 2026-07-05** (parking → queued, user-approved): the probes-first roadmap places this member
> in P3; its implicit trigger ("after P2 moat") fired when `runtime-redteam-hardening` shipped via PR #31
> on 2026-07-05 — P2 is complete, P3 (parity oracle + item schema) is the current phase.

`runtime/engine/schema/item.schema.ts` is an idealized abstract contract not wired to the real store:
- It **requires `done_criteria`** — 0 of 402 backlog files have it; 53 use `done_when`.
- It is `.strict()` — rejects the legacy `spec`/`plan`/`topic_memory`/`validation_gate`/`closed`/`notes` keys
  every backlog file carries.
- It has **no production importer** — the engine reads `docs/backlog` frontmatter raw via
  `scope-gate.mjs readItems()`; `plan-next.mjs` operates on an injected array. Neither validates.

Reconcile: rename `done_criteria`→`done_when` (or map), relax/extend the schema for the real keys, then wire
`validateItem` into the read path (scope-gate's `readItems`) so `docs/backlog` IS a validated runtime item
store. This is what lets the forward edge (intake/planner) trust its inputs.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-05
- **Decision:** Named --auto target runtime-item-schema-reconciliation was status: parking (member of parking theme epic runtime-operationalization) — Step-1 dispatch refuses parking items; how to proceed
- **Options:** Promote to queued (rank 4) and proceed standalone | Abort and run /backlog-next-epic runtime-operationalization | Stop, leave in parking
- **Chosen:** Promote to queued (rank 4) and proceed standalone — USER-APPROVED via AskUserQuestion (not auto-resolved)
- **Rationale:** The implicit trigger fired: P2 moat completed with runtime-redteam-hardening PR #31 (2026-07-05); P3 = parity oracle + item schema is the current phase. The epic is explicitly designed for standalone member drain (each member its own /backlog-next PR, as make-it-fire, backward-edge-live, redteam-hardening were).
- **Rejected:** Epic orchestrator would promote the whole theme epic to active and bind all remaining core members to one branch/PR — heavier than the established one-member-one-PR drain pattern. Stopping would leave a fired-trigger item parked.
