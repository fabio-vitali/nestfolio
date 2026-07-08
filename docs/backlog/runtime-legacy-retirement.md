---
id: runtime-legacy-retirement
status: parking
type: tooling
notes: "P6: user-triggered legacy work-driver retirement — delete flag-off prose bodies, strangler seams, RUNTIME_ENGINE flag; decide parity-oracle disposition. Filed as core + done_when clause (7) per user decision 2026-07-08."
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-operationalization
epic_role: core
---

# P6 — legacy work-driver retirement (user-triggered)

The final act of the strangler migration ([strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md)
§10/§12: "legacy-path deletion is a separate, user-triggered act, never bundled" with the soak gate).
The soak gate closed 2026-07-08 (`runtime-replatform-soak-gate`: 6 fallback-free runtime workstreams,
0 fallbacks, oracle green) — retirement is unblocked. User-directed filing at that ship boundary, as a
**core** member with the epic's `done_when` amended (clause 7) so epic closure literally means the
migration is complete.

**Retirement checklist (the scope):**

- **Legacy prose bodies kept "until P6"** — delete the flag-off legacy bodies: `backlog-next`
  SKILL.md §5a's legacy closing-phase prose, `backlog-next-epic` E4's legacy body, `backlog-add`'s
  prose router ("retained byte-for-byte until P6"), `backlog-lint`'s legacy invocation path. The
  runtime drive subsections become the only body.
- **Strangler seams collapse to runtime-only** — `backlog-gate.mjs`, `next-driver.mjs`,
  `epic-driver.mjs` lose their flag branch; `usesRuntimeEngine` / `RUNTIME_ENGINE` flag removed;
  `path-provenance.mjs` fallback instrumentation (`FALLBACK_RUN_ID`, `PATH_LEGACY_FALLBACK`) retired
  with it (decide: keep `path:runtime` journaling as plain provenance, or drop).
- **verify-structure.sh #1–10** — retire in favor of `scripts/check-service-structure.sh` + the
  runtime gate; reinstall the refactored pre-commit hook (the post-merge reinstall deferred by
  `runtime-check-migration-completion`'s hook footgun).
- **Parity-oracle / bef disposition** — the legacy comparator disappears with the legacy skills;
  decide what survives: archive the oracle (its go/no-go job is done), keep the deterministic
  differential as a runtime-only regression suite, or retire `scripts/benchmark-backlog/` wholesale.
  `soak-observer.mjs`'s purpose also ends here.
- **Doc layer** — CLAUDE.md skill-routing table, `docs/superpowers` references, dossier update.

**Sequencing trigger (why parking):** work AFTER `runtime-operational-surface` ships (the operator
surface replaces the visibility the legacy skill bodies provide) and only on an explicit user
trigger — promotion is the user's act, per the spec's "never bundled" rule.

Topic dossier: `project_runtime_realization.md`.
