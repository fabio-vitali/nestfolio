---
id: runtime-replatform-lint
status: queued
rank: 4
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-2 (spec §8): re-platform backlog-lint onto the registry gates. The 11 rules are already migrated via check-migration; this wires the flag so preflight/postflight call run-gate/run-watch, adds the rule-3 anchor-resolution evaluator (a module: check — the one rule with no scheme), and leaves renderIndex/syncDossiers as the untouched --fix side-car. Promoted 2026-07-07 (standalone member per epic D1): the block trigger fired — runtime-replatform-prereqs shipped 2026-07-06 (RUNTIME_ENGINE flag + path-provenance, soak-observer.mjs, the parity-oracle extension mechanism, and the 3 parity-hole fixes), verified status: shipped / closed: 2026-07-06. Sibling WS-1 (runtime-replatform-add) promoted+shipped the same way 2026-07-07."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
out_of_scope:
  - "The flag/observer/parity-hole mechanism — that is runtime-replatform-prereqs."
  - "renderIndex / syncDossiers doc-store materialization — stays a side-car by design (spec §2)."
  - "Deleting the legacy lint.mjs rule bodies (P6, user-triggered)."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# WS-2 — re-platform `backlog-lint` onto registry gates

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-2).
The rule atoms are already checks; this member wires `preflight`/`postflight` through `run-gate`/`run-watch`
behind the flag and adds the missing rule-3 anchor evaluator. Index/dossier regen stays a side-car.

**Unblocked 2026-07-07:** `runtime-replatform-prereqs` shipped 2026-07-06 — it landed the
`RUNTIME_ENGINE` flag + path-provenance journal, `scripts/parity-oracle/soak-observer.mjs`, the
parity-oracle extension mechanism (the 42 `unmapped:'P5'` scenarios + `path:runtime` grade
assertion), and the 3 parity-hole fixes. Promoted to the active workstream as a standalone member
PR (epic decision D1), mirroring how sibling WS-1 (`runtime-replatform-add`) was promoted+shipped
2026-07-07.
