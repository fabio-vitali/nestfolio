---
id: runtime-replatform-lint
status: parking
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-2 (spec §8): re-platform backlog-lint onto the registry gates. The 11 rules are already migrated via check-migration; this wires the flag so preflight/postflight call run-gate/run-watch, adds the rule-3 anchor-resolution evaluator (a module: check — the one rule with no scheme), and leaves renderIndex/syncDossiers as the untouched --fix side-car. Promote once runtime-replatform-prereqs ships."
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

**Blocked on:** `runtime-replatform-prereqs`. Promote once that ships.
