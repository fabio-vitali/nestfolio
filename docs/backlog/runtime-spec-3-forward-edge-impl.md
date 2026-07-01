---
id: runtime-spec-3-forward-edge-impl
status: parking
rank: null
type: feature
epic: runtime-realization
epic_role: core
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
out_of_scope:
  - "SPEC 1 (registry/atom) and SPEC 2 (backward edge) — separate slices of runtime-realization."
  - "A second host adapter / full 34-surface content-ring migration — beyond this slice's proof scope."
spec: docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
plan: null
topic_memory: []
notes: "Slice 3 of runtime-realization — forward edge & capability seams: watch/intake/planner/execution + the scope-gate, the six capability interfaces + the <<HARNESS-PAUSE>> sentinel, the journal idempotency contract, three-rings/two-seams, the no-lost-value equivalence map (migrates surfaces into content-ring YAML), the eval harness, the starter library + on-ramp, the operational surface. PARKING until SPECs 1 AND 2 ship — its plan is authored INLINE at MAX effort against their MERGED contracts. Promote parking→active via /backlog-next once SPEC 2 ships (remove this trigger sentence on promotion)."
---

# SPEC 3 — forward edge & capability seams — build

Slice 3 of `runtime-realization`. Builds the watch→intake→planner→execution forward edge, the six
capability interfaces (the harness seam), the journal idempotency contract, and the no-lost-value
equivalence map that migrates the reference checks into the content ring. Depends on merged SPEC 1
(+ SPEC 2); planned + built only after slices 1–2 ship. See the epic `runtime-realization`.
