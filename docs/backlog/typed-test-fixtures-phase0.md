---
id: typed-test-fixtures-phase0
status: active
epic: typed-test-fixtures
epic_role: core
type: feature
requires_deploy: true
notes: "Phase 0 of the typed-test-fixtures epic: build the reusable mechanism AND retrofit compliance-ctrl's fixtures as the proof, fixing the two pre-existing co-wrong fixtures that motivated the program. Mechanism (spec §3): producer-owned event->schema maps (extend publisher-schemas to event-name level), a composed registry lib (libs/test-contracts), a generic typed putEvent({ detailType, subject: SubjectOf<K>, context? }) with a runtime parse backstop, and typed TableAssertions matchers. Proof: migrate compliance-ctrl integration + e2e fixtures to the typed API. Bug A (integration mandate fixtures put per-test userId in the subject; handler keys by ctx.userId) becomes a compile error fixed via the typed context param. Bug B (update-operating-mode e2e RECOMMENDATION_PROPOSED omits isInitialBuild/riskCategory required by RecommendationProposedSchema) becomes a missing-field compile error. If Bug B's fields are also absent from the REAL decision-workflow-ctrl emission, file that as a separate latent contract bug (spec §7 triage)."
done_when: "Mechanism shipped + unit-tested (a fixture omitting a required subject field fails to compile — pinned with @ts-expect-error; runtime parse throw-path unit-tested). compliance-ctrl integration suite GREEN against deployed dev (Bug A fixed). update-operating-mode e2e GREEN end-to-end (Bug B fixed; real-producer emission of isInitialBuild/riskCategory confirmed or the gap filed). Regression gate forbids untyped putEvent in compliance-ctrl fixtures."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
out_of_scope:
  - "Retrofitting other services' fixtures (Phases 1-4)"
  - "Production contract/producer/consumer changes (test layer only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Phase 0 — mechanism + compliance-ctrl retrofit (fixes Bug A + Bug B)

Builds the reusable typed-fixture mechanism (spec §3) and proves it by retrofitting compliance-ctrl's
integration + e2e fixtures, which turns the two motivating pre-existing co-wrong fixtures into
compile-then-corrected errors:

- **Bug A** — compliance-ctrl integration mandate fixtures place a per-test `userId` in the event
  subject and poll by it, but the handler keys `MandateSnapshot` by `ctx.userId` (DRY identity). Fixed
  by the typed `context` param (per-test identity in context; subject typed DRY so identity-in-subject
  is an excess-property error). Suite has been red since `c043f043`.
- **Bug B** — `update-operating-mode` e2e's synthetic `RECOMMENDATION_PROPOSED` omits `isInitialBuild`
  + `riskCategory`, required by `RecommendationProposedSchema` since WS-3 `6ea8b86b` → `parseSubject`
  throws. Fixed by typing the subject (missing-field compile error). **Verify** whether the real
  decision-workflow-ctrl emission carries those fields; if not, file the real producer-contract bug.

Validated by: the mechanism's type-tests + the compliance-ctrl integration suite and the
update-operating-mode e2e going green against deployed dev.
