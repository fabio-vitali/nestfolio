---
id: typed-test-fixtures-cross-domain-order-events
status: active
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Surfaced 2026-06-19 by the consolidated-verify (typed-test-fixtures-consolidated-integration-e2e-verify) integration sweep: the cross-domain ORDER_* lifecycle events (ORDER_FILLED / ORDER_PARTIALLY_FILLED / ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED — produced by broker-ctrl, consumed cross-domain by ledger-ctrl + investor-ctrl + decision-workflow-ctrl) were never registered in @nestfolio/test-contracts and never migrated to the typed putEvent API. They were the deferred family captured under typed-test-fixtures-execution-deferred-cross-domain. The co-wrong UNTYPED fixtures sent executionMode: 'paper' (the producer enum is ['simulation','live']) and omitted required timestamp, so the REAL deployed handlers ZodError'd → 17 of 22 integration failures (ledger-ctrl 12, investor-ctrl 5) in the consolidated sweep — undetected because the static gate had ORDER_* unregistered. Fix: register ORDER_* → NormalizedOrderEventSchema in the producer-owned brokerCtrlEventSubjects (auto-composes into EventSubjects; also sync test-contracts registry.test EXPECTED + tools/typed-fixture-registered-events.json), then migrate every ORDER_* putEvent fixture to the typed subject:/context: API (ledger-ctrl 7, investor-ctrl 6, decision-workflow-ctrl 3, e2e accept-decision + investor-contract-emission). Gate now enforces ORDER_* typing (88 registered events). Migrating SURFACED a class-(b) latent production money bug (ledger-ctrl RecordFill / tax-lot reducer reads symbol/side/quantity/fillPrice that broker-ctrl drops) — FILED (extends ledger-ctrl-live-tax-lot-missing-order-fields), not fixed here per spec §2/§7."
done_when: "ORDER_* registered in the producer-owned brokerCtrlEventSubjects + composed EventSubjects (registry.test EXPECTED + typed-fixture-registered-events.json synced — test-contracts registry test green); every ORDER_* putEvent fixture across ledger-ctrl / investor-ctrl / decision-workflow-ctrl / e2e migrated to the typed subject:/context: API (check-typed-fixtures green at 88 events; tsc introduces no new errors); the class-(b) ledger RecordFill reducer bug FILED (not fixed here); ledger-ctrl + investor-ctrl + decision-workflow-ctrl integration existence/dedup/SF-trigger tests green against deployed dev; balance-value + portfolio-reflects-fill assertions that depend on the filed class-(b) bug attributed to it (not fixture regressions)."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - docs/backlog/ledger-ctrl-live-tax-lot-missing-order-fields.md
  - services/execution/broker-ctrl/src/domain/contracts.ts
  - tools/check-typed-fixtures.mjs
out_of_scope:
  - "Fixing the class-(b) ledger-ctrl RecordFill / tax-lot reducer bug — production change (broker-ctrl must emit symbol/side/quantity/fillPrice on ORDER_FILLED); filed under ledger-ctrl-live-tax-lot-missing-order-fields"
  - "Running the full e2e suite (gated at the consolidated-verify e2e checkpoint)"
  - "The 3 investor-ctrl circuit-breaker straggler failures + execution-ctrl USER_CONFIRMED + dashboard-bff DECISION_BLOCKED stragglers (separate triage)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# typed-test-fixtures — cross-domain ORDER_* registration + fixture migration

The deferred ORDER_*/NormalizedOrderEvent family (see [[typed-test-fixtures-execution-deferred-cross-domain]])
finally typed. The consolidated runtime verification ([[typed-test-fixtures-consolidated-integration-e2e-verify]])
proved the deferral had left co-wrong untyped fixtures that the **real deployed handlers reject** —
exactly the "validate vs the real producer, not fixtures" lesson the typed-subject program rests on.

## What the migration did
- Registered `ORDER_FILLED / ORDER_PARTIALLY_FILLED / ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED`
  → `NormalizedOrderEventSchema` in `brokerCtrlEventSubjects` (producer-owned), composed into `EventSubjects`.
- Synced the gate's name-sources: `libs/test-contracts/test/registry.test.ts` `EXPECTED` + `tools/typed-fixture-registered-events.json`.
- Migrated every ORDER_* `putEvent` fixture to the typed `subject:`/`context:` overload, dropping the
  fabricated `symbol/side/quantity/fillPrice/filledAt/decisionId` fields the producer contract does not carry.

## The class-(b) bug it surfaced
`ledger-ctrl/account.reducer.ts` `RecordFill` (and the live tax-lot path) read `symbol/side/quantity/fillPrice`
from the ORDER_FILLED subject, but `NormalizedOrderEventSchema` (the producer contract, what broker-ctrl actually
emits) carries none of them → **order fills do not update ledger cash balance or positions in production.** Filed
under [[ledger-ctrl-live-tax-lot-missing-order-fields]] (extended from tax-lots to the core balance reducer). The
`accept-decision` e2e's "portfolio reflects the fill" assertion exercises this broken path end-to-end and is the
e2e proof of impact; it will not pass until the producer contract is extended.
