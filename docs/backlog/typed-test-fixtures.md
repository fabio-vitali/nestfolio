---
id: typed-test-fixtures
status: shipped
type: epic
notes: "Type-check every test fixture (unit/integration/e2e) against the producer-owned zod contracts so co-wrong fixtures are COMPILE errors (+ a runtime parse backstop), closing the [[event-subject-contracts]] 'fixture passed, real producer differed' gap workspace-wide. Promoted to active delivery epic 2026-06-16; first member typed-test-fixtures-phase0 in flight. Design: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md. Motivated by two pre-existing co-wrong fixtures surfaced validating compliance-ctrl-mandate-snapshot-parse-subject (Bug A: identity-in-subject integration fixtures; Bug B: e2e RECOMMENDATION_PROPOSED missing required fields)."
done_when: "Mechanism shipped (producer event->schema maps + composed registry + typed putEvent with per-call context override + runtime parse backstop + typed TableAssertions); all ~290 putEvent call-sites across the 4 domains migrated to the typed API; every surfaced co-wrong fixture fixed or its latent contract bug filed; regression gate forbids untyped putEvent in migrated domains. Every core member shipped or dropped."
scope: "Test-layer typing only. 5 core members: Phase 0 (mechanism + compliance-ctrl fixtures, fixes Bug A + Bug B) and 4 domain retrofit waves (Investor, Advisory, Execution, Ledger). Producer-owned typed registry approach (extends the 21 publisher-schemas to event-name level)."
out_of_scope:
  - "Production contract / producer emission / consumer (parseSubject) changes — test layer only; latent contract bugs surfaced by the retrofit are filed separately"
  - "ledger-ctrl-live-tax-lot-missing-order-fields (a real producer/consumer fork; belongs to typed-subject-consumer-contract-gaps)"
  - "dwc-sfn-callback-reason-blockreason-gap behavioral residual (re-homed, separate)"
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: "Epic shipped 2026-06-19. All 12 core members terminal: phase0 (mechanism + compliance-ctrl Bug A/B) → phase1-investor → phase2-advisory → phase3-execution → phase4-ledger → cross-domain-consumer-migration (funding *_SETTLED) → cross-domain-order-events (ORDER_*) → funding-lifecycle-detected-failed (DEPOSIT_DETECTED, last core member, merged 9d6b6340) + the 3 contract-gap fixes (check-typed-fixtures-dynamic-detailtype-gap, onboarding-mandatelevel-contract-gap, operating-mode-authority-e2e-recommendation-fixture) + the consolidated integration/e2e verify. Mechanism shipped: producer event→schema maps + composed EventSubjects registry (89 events) + typed putEvent with per-call context override + runtime parse backstop + typed TableAssertions. Regression gate: check-typed-fixtures green (0 violations, 451 files, 89 registered events) — forbids untyped putEvent in migrated domains. Every surfaced co-wrong fixture fixed or its latent contract bug filed. CAPTURED AUDIT (close ritual): re-tested all 13 open captured members against done_when — NONE load-bearing (the green gate proves the all-sites + gate clauses hold independently; clause 'co-wrong fixture fixed OR latent bug filed' is satisfied by each being filed). dwc-decision-packet-schema-missing-optional-fields was already RESOLVED (Phase 2 Task 1 production+test fix) → marked shipped. The other 12 genuinely-orthogonal captured findings auto-spun-out into the new [[typed-test-fixtures-leftovers]] theme epic (status: parking) for re-clustering by backlog-themes."
---

# Typed test fixtures (workspace-wide)

The test-layer completion of the typed-subject program. Production code is type-safe against
producer-owned zod contracts (`BusEvent<T,S>`, `TableEntry<T,S>`, `parseSubject`), but the test
fixtures (`putEvent({ detail: Record<string, unknown> })`, `TableAssertions` matchers) bypass them —
so a co-wrong fixture compiles and only fails against the real producer ([[event-subject-contracts]]
lesson). This epic types the fixtures so that class of bug is a compile error.

Design + full rationale: `docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md`.

## Members (phases)

- `typed-test-fixtures-phase0` — mechanism + compliance-ctrl retrofit; **fixes Bug A + Bug B**. CORE. ← plan first
- (filed when Phase 0 ships) Phase 1 Investor / Phase 2 Advisory / Phase 3 Execution / Phase 4 Ledger
  retrofit waves — ~290 putEvent sites across 48 files; see spec §4.

Compatibility verified before approval (spec §5): nx boundary `allow` list covers
`@nestfolio/.+/contracts` + `-adpt/domain`; the typed-subject C2 gate excludes test files; the
mechanism reuses the same producer schemas as `parseSubject` (single source of truth).
