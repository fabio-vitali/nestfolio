---
id: runtime-judgment-governance-gaps
status: parking
type: feature
notes: "Deferred from runtime-check-migration-judgment-tier (SHIPPED 2026-07-06, spec §8). Migrate the 3 backlog/epic-governance judgment verdicts into runtime `judgment` CheckEntries driven by the live judge binding: (1) the epicCapturedAudit load-bearing verdict, (2) the core-vs-captured epic_role classification, (3) the ship-time captured promote/spin-out verdict. The judgment tier wrapped the 4 EXISTING audit-* skills; these 3 gaps have NO existing skill and need net-new judge procedures (and possibly new skills) — which is why they were deferred, and they border the epic's 'no net-new checks' out_of_scope. NB: the LINT-level enforcement of these already shipped in backlog-epic-captured-misroute-fix (predicate routing + atomicity invariant + ship-time captured audit in lint.mjs), so this item is only about ALSO surfacing them as RUNTIME judgment checks. Promote when extending the runtime judgment tier beyond the audit-* skills; DROP as redundant if the shipped lint-level enforcement is judged sufficient."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-judgment-tier-maturation
epic_role: core
---

# runtime-judgment-governance-gaps

Deferred follow-up from the judgment-tier ship (spec §8). See `notes` for the promote/drop trigger.
