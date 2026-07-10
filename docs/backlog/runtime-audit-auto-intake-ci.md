---
id: runtime-audit-auto-intake-ci
status: parking
type: feature
notes: "Deferred from runtime-check-migration-judgment-tier (SHIPPED 2026-07-06, spec §8). Make the weekly runtime-audit cadence job ALSO route its findings into backlog items automatically — bind the intake `execute` capability to a headless runner so run-intake's selectRoute judgment resolves in-CI instead of parking for a human. TODAY the cadence dispatcher (run-audit.mjs) only PRODUCES findings (stdout + gitignored runtime/.audit-findings/<runId>.json artifact); intake is human-driven (run-intake.mjs --finding … then --fulfil per a session route decision), as demonstrated by the acceptance run. Promote when the audit cadence should be fully autonomous (findings → filed backlog items with zero human step); needs a headless execute binding + a route-classification prompt/guardrails so it does not mis-file."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-judgment-tier-maturation
epic_role: core
---

# runtime-audit-auto-intake-ci

Deferred follow-up from the judgment-tier ship (spec §8). See `notes` for the promote trigger.
