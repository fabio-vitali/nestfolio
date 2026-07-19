---
id: flow-spec-documentation-drift
status: parking
type: epic
notes: "flows/*.flow.yaml has no gate tying it to code, so flow specs go missing (undocumented hops) or stale (claims that no longer match code). Theme epic, 3 members."
done_when: "Each in-scope flow-spec gap is closed — a missing hop gets a documented step, a stale claim is corrected or removed — and each passes validate-flow; all members shipped or dropped."
scope: "Flow-spec documentation drift with no enforcing gate: (a) a real mutation/event hop with no corresponding flows/*.flow.yaml step; (b) a flows/*.flow.yaml step that claims an emission/wiring that no longer exists in code."
out_of_scope:
  - "Adapter-forwarding hops that ARE documented but stale in a different way — cross-domain event registry omissions (event-name-integrity case b) — a code-side contract gap, not a doc-side gap"
  - "Architecture-doc generator coverage gaps for C4/flow-doc rendering (diagram-generator-gaps) — a generator capability gap, not hand-written flow-spec accuracy"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Flow-spec documentation drift

Root cause: `flows/*.flow.yaml` files are hand-authored and hand-maintained with no automated gate tying their claims to the actual code — so they drift in both directions. Missing-hop drift: a real mutation produces/consumes an event with no flow-spec step documenting it (five investor-bff mutations; one advisory-bff telemetry-only write). Stale-claim drift: a flow spec asserts an emission that was deliberately removed from code and never updated (`advisory-cycle.flow.yaml`'s stale `AUDIT_ARTIFACT` CDC claim, removed 2026-06-11). Same shape as the already-shipped `investor-domain-missing-flow-specs-adapter-hops` precedent (a prior batch of missing investor-domain flow-spec hops) and the periodic `audit-system-arch-docs` item-4 check that keeps re-surfacing this class. Fix pattern: for missing hops, add the step; for stale claims, correct or remove them; consider whether a lint-style check against `service.stack.ts` Egress/CDC + BFF resolvers could catch this class going forward (see `diagram-generator-gaps` for the parallel generator-coverage theme, a distinct root cause).

Members (derived from `epic:` pointers):
- `advisory-bff-record-explanation-view-no-flow-spec`
- `advisory-cycle-flow-audit-artifact-stale-cdc-claim`
- `investor-bff-missing-flow-specs-mutations`
