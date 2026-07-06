---
id: runtime-judgment-flake-calibration
status: parking
type: feature
notes: "Deferred from runtime-check-migration-judgment-tier (SHIPPED 2026-07-06, spec §8). Build the REAL flake-contract calibration mechanics (SPEC 2 §eval): the judgment eval corpus with good/bad fixtures + n-run calibration that turns a check's flake_contract (allowed_flake_rate / calibration / min_confidence) into an enforced regression, instead of a declared target. TODAY every judgment eval_scenario is an existence-only STUB — the template's (integration-test-completeness) and the 4 new audit-* ones landed by this workstream. Blocked-by nothing in code; it is net-new eval infra the epic excluded. Promote when judgment checks need real flake-regression teeth (e.g. before relying on an audit check as a hard gate rather than an advisory cadence artifact)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# runtime-judgment-flake-calibration

Deferred follow-up from the judgment-tier ship (spec §8). See `notes` for the promote trigger.
